// verify-payment: re-checks ONE Paystack payment with Paystack, on request.
//
// Why: Paystack's webhook is the normal way a payment gets confirmed, but a
// webhook can be delayed, misconfigured or lost. The payment callback page
// calls this as soon as the parent returns from Paystack, and an admin can
// call it to rescue a payment stuck in 'pending'.
//
// It goes through EXACTLY the same verification as the webhook
// (processPaystackReference: Paystack Verify API + amount/currency/reference
// match + never touching an already-successful payment). It can never mark a
// payment paid unless Paystack itself confirms it.
//
// Who may call it: a signed-in, active PARENT of the invoice's student, or an
// ADMIN. Body: { reference }. Response: { status, outcome, paystack_status }
// or { error }.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { processPaystackReference } from '../_shared/processPayment.ts'

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

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const paystackKey = Deno.env.get('PAYSTACK_SECRET_KEY')?.trim()
  if (!supabaseUrl || !serviceKey || !paystackKey) {
    console.error('verify-payment: missing SUPABASE_URL, service role key or PAYSTACK_SECRET_KEY')
    return json({ error: 'Online payments are not set up yet (missing PAYSTACK_SECRET_KEY).' }, 500)
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Signed-in user.
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'You need to be signed in.')
  const { data: authData, error: authError } = await admin.auth.getUser(token)
  if (authError || !authData.user) throw new HttpError(401, 'Your session has expired. Please sign in again.')
  const { data: caller, error: callerError } = await admin
    .from('users')
    .select('id, role, is_active')
    .eq('auth_id', authData.user.id)
    .maybeSingle()
  if (callerError) throw callerError
  if (!caller || !caller.is_active || !['parent', 'admin'].includes(caller.role)) {
    throw new HttpError(403, 'Only parents and admins can check payments.')
  }

  let body: { reference?: string }
  try {
    body = await req.json()
  } catch {
    throw new HttpError(400, 'The request was not valid JSON.')
  }
  const reference = (body.reference ?? '').trim()
  if (!/^[A-Za-z0-9._=-]{6,100}$/.test(reference)) throw new HttpError(400, 'A valid payment reference is required.')

  // The payment, and (for parents) that it's for one of their children.
  const { data: payment, error: paymentError } = await admin
    .from('payments')
    .select('id, invoices(student_id)')
    .eq('provider', 'paystack')
    .eq('provider_ref', reference)
    .maybeSingle()
  if (paymentError) throw paymentError
  let allowed = Boolean(payment) && caller.role === 'admin'
  if (payment && caller.role === 'parent') {
    const studentId = (payment.invoices as { student_id: string } | null)?.student_id
    const { data: parent } = await admin.from('parents').select('id').eq('user_id', caller.id).maybeSingle()
    const { data: link } = parent && studentId
      ? await admin.from('parent_students').select('student_id').eq('parent_id', parent.id).eq('student_id', studentId).maybeSingle()
      : { data: null }
    allowed = Boolean(link)
  }
  // Same answer whether it doesn't exist or isn't theirs.
  if (!allowed) throw new HttpError(404, 'No payment with that reference was found on your account.')

  let result
  try {
    result = await processPaystackReference(admin, paystackKey, reference, 'verify-payment')
  } catch (err) {
    console.error(`verify-payment: checking ${reference} with Paystack FAILED`, err)
    throw new HttpError(502, "We couldn't reach Paystack to confirm this payment. Please try again in a moment.")
  }
  console.log(`verify-payment: ${JSON.stringify({ reference, by: caller.role, ...result })}`)

  const { data: after } = await admin.from('payments').select('status').eq('id', payment!.id).maybeSingle()
  return json({ status: after?.status ?? null, outcome: result.outcome, paystack_status: result.paystackStatus ?? null })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }
  try {
    return await handle(req)
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    console.error('verify-payment: unhandled error', err)
    return json({ error: 'Something went wrong while checking the payment. Please try again.' }, 500)
  }
})
