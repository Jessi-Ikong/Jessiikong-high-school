// verify-card: the public ID card check (the /verify/<token> page).
//
// PUBLIC: deployed with verify_jwt = false (visitors scanning a QR code aren't
// signed in). It only ever accepts { token } - the random code from the QR -
// and returns that card's display-safe fields plus a 2-minute signed link to
// ITS photo, only if the card is valid. It can't be asked for any other photo.
// See _shared/verifyCard.ts.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { verifyCard } from '../_shared/verifyCard.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    console.error('verify-card: missing SUPABASE_URL or service role key')
    return json({ error: 'The card check is not available right now.' }, 500)
  }
  let body: { token?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return json({ valid: false })
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return json(await verifyCard(admin, body.token))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders })
  try {
    return await handle(req)
  } catch (err) {
    console.error('verify-card: unhandled error', err)
    return json({ error: 'The card check is not available right now.' }, 500)
  }
})
