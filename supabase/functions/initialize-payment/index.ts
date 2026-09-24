// initialize-payment: starts a Paystack payment for one invoice.
//
// Runs server-side on Supabase. PAYSTACK_SECRET_KEY (an Edge Function secret)
// and the service role key never reach the browser.
//
// Flow:
//   1. The caller must be a signed-in, active PARENT.
//   2. The invoice must belong to one of THEIR children (parent_students).
//   3. It must still have something to pay. The amount charged is the whole
//      outstanding balance (amount_due - amount_paid); parents don't choose
//      an amount (see test.txt for why).
//   4. Create the 'pending' payment row (unique reference), then call
//      Paystack's Initialize Transaction API (amount in kobo).
//   5. Return Paystack's authorization_url; the page sends the browser there.
//      Paystack sends the parent back to APP_URL/parent/payment-callback.
//
// The payment only becomes 'successful' in paystack-webhook, after Paystack
// confirms it. Responses are JSON: { authorization_url, reference } or
// { error: "plain-language message" }.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { paystackRequest, toKobo } from '../_shared/paystack.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const paystackKey = Deno.env.get('PAYSTACK_SECRET_KEY')?.trim()
  const appUrl = Deno.env.get('APP_URL')
  if (!supabaseUrl || !serviceKey || !paystackKey || !appUrl) {
    console.error('Missing SUPABASE_URL, service role key, PAYSTACK_SECRET_KEY or APP_URL')
    return json({ error: 'Online payments are not set up yet (missing PAYSTACK_SECRET_KEY or APP_URL secret).' }, 500)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1) Signed-in, active parent.
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'You need to be signed in.')
  const { data: authData, error: authError } = await admin.auth.getUser(token)
  if (authError || !authData.user) throw new HttpError(401, 'Your session has expired. Please sign in again.')

  const { data: caller, error: callerError } = await admin
    .from('users')
    .select('id, role, email, is_active')
    .eq('auth_id', authData.user.id)
    .maybeSingle()
  if (callerError) throw callerError
  const { data: parent, error: parentError } = caller
    ? await admin.from('parents').select('id').eq('user_id', caller.id).maybeSingle()
    : { data: null, error: null }
  if (parentError) throw parentError
  const parentId = parent?.id
  if (!caller || caller.role !== 'parent' || !caller.is_active || !parentId) {
    throw new HttpError(403, 'Only parents can pay fees online.')
  }
  const email = caller.email ?? authData.user.email
  if (!email) throw new HttpError(400, 'Your account has no email address, which Paystack needs. Please contact the school.')

  // 2) The invoice, and that it's for one of their children.
  let body: { invoice_id?: string }
  try {
    body = await req.json()
  } catch {
    throw new HttpError(400, 'The request was not valid JSON.')
  }
  if (!UUID_RE.test(body.invoice_id ?? '')) throw new HttpError(400, 'Choose an invoice to pay.')

  const { data: invoice, error: invoiceError } = await admin
    .from('invoices')
    .select('id, student_id, amount_due, amount_paid, fee_structures(name)')
    .eq('id', body.invoice_id)
    .maybeSingle()
  if (invoiceError) throw invoiceError

  const { data: link, error: linkError } = invoice
    ? await admin
        .from('parent_students')
        .select('student_id')
        .eq('parent_id', parentId)
        .eq('student_id', invoice.student_id)
        .maybeSingle()
    : { data: null, error: null }
  if (linkError) throw linkError
  // Same answer whether the invoice doesn't exist or isn't theirs.
  if (!invoice || !link) throw new HttpError(403, 'You can only pay fees for your own children.')

  // 3) Outstanding balance.
  const outstanding = Math.round((Number(invoice.amount_due) - Number(invoice.amount_paid)) * 100) / 100
  if (!(outstanding > 0)) throw new HttpError(409, 'This invoice is already fully paid.')

  // 4) Pending payment row, then Paystack.
  const reference = `JHS-${crypto.randomUUID()}`
  const { data: payment, error: paymentError } = await admin
    .from('payments')
    .insert({
      invoice_id: invoice.id,
      amount: outstanding,
      provider: 'paystack',
      provider_ref: reference,
      status: 'pending',
      paid_by: caller.id,
    })
    .select('id')
    .single()
  if (paymentError) throw paymentError

  let authorizationUrl: string
  try {
    const result = await paystackRequest(paystackKey, '/transaction/initialize', {
      method: 'POST',
      body: {
        email,
        amount: toKobo(outstanding),
        currency: 'NGN',
        reference,
        callback_url: `${appUrl.replace(/\/$/, '')}/parent/payment-callback`,
        metadata: {
          invoice_id: invoice.id,
          payment_id: payment.id,
          fee: (invoice.fee_structures as { name: string } | null)?.name ?? null,
        },
      },
    })
    authorizationUrl = result.data.authorization_url
  } catch (err) {
    // Paystack refused or couldn't be reached: this attempt can never be paid.
    await admin
      .from('payments')
      .update({ status: 'failed', provider_response: { error: String((err as Error).message ?? err) } })
      .eq('id', payment.id)
    console.error('Paystack initialize failed', err)
    throw new HttpError(502, "We couldn't start the payment with Paystack. Please try again in a moment.")
  }

  return json({ authorization_url: authorizationUrl, reference })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }
  try {
    return await handle(req)
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    console.error('Unhandled error in initialize-payment', err)
    return json({ error: 'Something went wrong while starting the payment. You have not been charged. Please try again.' }, 500)
  }
})
