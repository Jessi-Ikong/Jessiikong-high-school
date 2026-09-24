// paystack-webhook: Paystack calls this when a transaction changes (e.g.
// charge.success).
//
// PUBLIC endpoint: deployed with verify_jwt = false (see supabase/config.toml),
// because Paystack sends no Supabase token. Security comes from:
//   1. The X-Paystack-Signature header: HMAC-SHA512 of the RAW body with
//      PAYSTACK_SECRET_KEY. Anything that doesn't match is rejected (401).
//   2. Not trusting the payload: processPaystackReference() asks Paystack's
//      Verify Transaction API itself and only marks the payment 'successful'
//      if Paystack says success AND the amount (kobo), currency and reference
//      match our payment row. (Shared with verify-payment.)
//
// IDEMPOTENT: a payment already 'successful' is never touched again, so a
// repeated / retried webhook can't double-count. The database trigger
// (refresh_invoice_paid) then recalculates the invoice.
//
// Every request writes ONE log line ("paystack-webhook: ...") saying what
// happened: bad signature, unknown reference, or the verification outcome.
//
// Response codes: 200 = handled or deliberately ignored (Paystack stops
// retrying); 401 = bad signature; 500 = temporary problem (Paystack retries).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasValidPaystackSignature } from '../_shared/paystack.ts'
import { processPaystackReference } from '../_shared/processPayment.ts'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function log(details: Record<string, unknown>) {
  console.log(`paystack-webhook: ${JSON.stringify(details)}`)
}

// Everything: setup, signature, processing. Any error thrown in here is turned
// into a JSON 500 by the wrapper at the bottom (Paystack then retries).
async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  // trim(): a key pasted with a trailing space/newline would still work for
  // API calls (headers are trimmed) but silently break the signature check.
  const paystackKey = Deno.env.get('PAYSTACK_SECRET_KEY')?.trim()
  if (!supabaseUrl || !serviceKey || !paystackKey) {
    console.error('paystack-webhook: missing SUPABASE_URL, service role key or PAYSTACK_SECRET_KEY')
    return json({ error: 'not configured' }, 500)
  }

  // 1) Signature over the RAW body (read it once, as text, before parsing).
  const rawBody = await req.text()
  const signature = req.headers.get('x-paystack-signature')
  const valid = await hasValidPaystackSignature(rawBody, signature, paystackKey)
  if (!valid) {
    log({
      result: 'REJECTED: invalid signature',
      has_signature_header: Boolean(signature),
      key_mode: paystackKey.startsWith('sk_test_') ? 'test' : paystackKey.startsWith('sk_live_') ? 'live' : 'unrecognised',
    })
    return json({ error: 'invalid signature' }, 401)
  }

  let event: { event?: string; data?: { reference?: string } }
  try {
    event = JSON.parse(rawBody)
  } catch {
    log({ result: 'REJECTED: body is not JSON' })
    return json({ error: 'invalid JSON' }, 400)
  }
  const reference = event.data?.reference
  if (!reference) {
    log({ result: 'ignored: no reference', event: event.event })
    return json({ ok: true, ignored: 'no reference' })
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const result = await processPaystackReference(admin, paystackKey, reference, 'webhook')
    log({ event: event.event, reference, ...result })
    return json({ ok: true, ...result })
  } catch (err) {
    console.error(`paystack-webhook: processing FAILED for ${reference} (Paystack will retry)`, err)
    return json({ error: 'temporary failure' }, 500)
  }
}

Deno.serve(async (req) => {
  // Catch-all: even an unexpected crash (e.g. reading the body, the crypto
  // check, creating the client) returns a clear JSON error that shows up in
  // the function logs, instead of a bare failure.
  try {
    return await handle(req)
  } catch (err) {
    console.error('paystack-webhook: unhandled error', err)
    return json({ error: 'unexpected error' }, 500)
  }
})
