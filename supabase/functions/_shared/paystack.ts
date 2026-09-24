// Paystack helpers shared by initialize-payment and paystack-webhook.
// Plain Web APIs only (fetch, Web Crypto), so they run on Supabase's Edge
// runtime and can also be unit-tested with Node.

export const PAYSTACK_API = 'https://api.paystack.co'

// Naira -> kobo (Paystack amounts are in the smallest currency unit).
export function toKobo(naira: number | string): number {
  return Math.round(Number(naira) * 100)
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')
}

// Compares two strings in constant time (for the same length), so the check
// doesn't leak how many leading characters matched.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Paystack signs every webhook: X-Paystack-Signature is the HMAC-SHA512 (hex)
// of the RAW request body, keyed with the secret key.
export async function hasValidPaystackSignature(
  rawBody: string,
  signature: string | null,
  secretKey: string,
): Promise<boolean> {
  if (!signature || !secretKey) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const expected = toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)))
  return timingSafeEqual(expected, signature.trim().toLowerCase())
}

// Calls the Paystack API with the secret key. Returns Paystack's JSON; throws
// if Paystack can't be reached or says the request failed.
export async function paystackRequest(
  secretKey: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<any> {
  const response = await fetch(`${PAYSTACK_API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  let payload: any = null
  try {
    payload = await response.json()
  } catch {
    // not JSON
  }
  if (!response.ok || !payload?.status) {
    const message = payload?.message ?? `HTTP ${response.status}`
    throw new Error(`Paystack ${path.split('/').slice(0, 3).join('/')} failed: ${message}`)
  }
  return payload
}

// What a verified Paystack transaction means for our payment row.
//   'successful' - paid, and the amount / currency / reference all match
//   'mismatch'   - Paystack says success but the details don't match ours
//   'failed'     - failed or reversed
//   'pending'    - not finished yet (leave the payment pending). This
//                  includes 'abandoned': Paystack also reports a checkout the
//                  parent hasn't completed YET as abandoned, so it isn't final.
export function classifyVerifiedTransaction(
  transaction: { status?: string; amount?: number; currency?: string; reference?: string },
  expected: { amountKobo: number; reference: string; currency?: string },
): 'successful' | 'mismatch' | 'failed' | 'pending' {
  const status = transaction.status
  if (status === 'success') {
    const matches =
      transaction.reference === expected.reference &&
      Number(transaction.amount) === expected.amountKobo &&
      (transaction.currency ?? 'NGN') === (expected.currency ?? 'NGN')
    return matches ? 'successful' : 'mismatch'
  }
  if (status === 'failed' || status === 'reversed') return 'failed'
  return 'pending'
}
