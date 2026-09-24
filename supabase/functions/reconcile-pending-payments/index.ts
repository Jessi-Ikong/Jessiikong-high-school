// reconcile-pending-payments: the scheduled sweep for Paystack payments stuck
// in 'pending' (e.g. the webhook never arrived). Called every 15 minutes by
// the pg_cron job "reconcile-pending-payments" (migration 029) through pg_net.
//
// Protection: deployed with verify_jwt = false (the database job has no user
// login). Instead every call must carry the header x-cron-secret matching the
// RECONCILE_CRON_SECRET function secret; the database job reads the same
// value from Vault (secret "reconcile_cron_secret"). Anything else gets 401.
// Even a caller with the secret can only make us ASK Paystack: nothing is
// marked paid unless Paystack confirms it (processPaystackReference).
//
// Body (all optional; the cron job sends them so they're easy to change):
//   { "min_age_minutes": 15, "expire_after_hours": 48, "limit": 50 }
//   expire_after_hours = 0 turns the automatic "expired -> failed" off.
// Response: { ok, settings, checked, successful, failed, expired, still_pending, errors }

import { createClient } from 'npm:@supabase/supabase-js@2'
import { readSettings, reconcilePendingPayments } from '../_shared/reconcile.ts'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const paystackKey = Deno.env.get('PAYSTACK_SECRET_KEY')?.trim()
  const cronSecret = Deno.env.get('RECONCILE_CRON_SECRET')?.trim()
  if (!supabaseUrl || !serviceKey || !paystackKey || !cronSecret) {
    console.error('reconcile: missing SUPABASE_URL, service role key, PAYSTACK_SECRET_KEY or RECONCILE_CRON_SECRET')
    return json({ error: 'not configured' }, 500)
  }

  const given = req.headers.get('x-cron-secret')?.trim() ?? ''
  if (!given || !sameSecret(given, cronSecret)) {
    console.warn('reconcile: rejected a call without the right x-cron-secret')
    return json({ error: 'unauthorized' }, 401)
  }

  let body: Record<string, unknown> | null = null
  try {
    body = await req.json()
  } catch {
    body = null // no / invalid body: use the defaults
  }
  const settings = readSettings(body)

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const summary = await reconcilePendingPayments(admin, paystackKey, settings)
  console.log(`reconcile: ${JSON.stringify({ settings, ...summary })}`)
  return json({ ok: true, settings, ...summary })
}

Deno.serve(async (req) => {
  try {
    return await handle(req)
  } catch (err) {
    console.error('reconcile: unhandled error', err)
    return json({ error: 'unexpected error' }, 500)
  }
})
