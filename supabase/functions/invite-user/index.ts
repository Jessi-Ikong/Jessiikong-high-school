// invite-user: lets an admin create a teacher / student / parent (or, for
// super admins, another admin) account and email them an invite.
//
// Runs server-side on Supabase. The service role key is only available here
// (Supabase injects SUPABASE_SERVICE_ROLE_KEY into Edge Functions); it is
// never sent to the browser.
//
// Flow:
//   1. Check the caller is a signed-in, active admin (limited admins may not
//      create admins).
//   2. Validate the request.
//   3. admin_create_account() creates all database rows in one transaction
//      (for students: admission number, enrollment and subjects too). It also
//      rejects a student email that belongs to a parent account.
//   4. Send the Supabase Auth invite, then link the new login to the profile.
//   5. If step 4 fails, admin_discard_account() removes the rows from step 3.
//
// Responses are JSON: { ok: true, ... } or { error: "plain-language message" }.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Role = 'admin' | 'teacher' | 'student' | 'parent'

interface InviteRequest {
  role: Role
  full_name: string
  email: string
  admin_level?: 'super_admin' | 'limited_admin'
  staff_id?: string
  department?: string
  date_of_birth?: string | null
  gender?: 'male' | 'female' | null
  session_id?: string
  class_id?: string
  section_id?: string
  subject_ids?: string[]
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// "Ada Grace Okafor" -> first "Ada", middle "Grace", last "Okafor"
function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) {
    throw new HttpError(400, 'Please enter both a first name and a last name.')
  }
  return {
    first: parts[0],
    middle: parts.slice(1, -1).join(' ') || null,
    last: parts[parts.length - 1],
  }
}

function validate(body: InviteRequest) {
  const roles: Role[] = ['admin', 'teacher', 'student', 'parent']
  if (!roles.includes(body.role)) throw new HttpError(400, 'Choose a valid account type.')
  if (typeof body.full_name !== 'string') throw new HttpError(400, 'Full name is required.')

  const email = (body.email ?? '').trim().toLowerCase()
  if (!email) throw new HttpError(400, 'An email address is required.')
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'That email address does not look right.')

  if (body.role === 'admin' && !['super_admin', 'limited_admin'].includes(body.admin_level ?? '')) {
    throw new HttpError(400, 'Choose the admin level (super admin or limited admin).')
  }
  if (body.role === 'teacher' && !body.staff_id?.trim()) {
    throw new HttpError(400, 'A staff ID is required for teachers.')
  }
  if (body.role === 'student') {
    for (const field of ['session_id', 'class_id', 'section_id'] as const) {
      if (!UUID_RE.test(body[field] ?? '')) throw new HttpError(400, 'Choose a session, class and section.')
    }
    if (body.gender && !['male', 'female'].includes(body.gender)) throw new HttpError(400, 'Choose a valid gender.')
    if (body.date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(body.date_of_birth)) {
      throw new HttpError(400, 'Date of birth is not a valid date.')
    }
    if (body.subject_ids && !(Array.isArray(body.subject_ids) && body.subject_ids.every((id) => UUID_RE.test(id)))) {
      throw new HttpError(400, 'The subject list is not valid.')
    }
  }
  return { email, name: splitName(body.full_name) }
}

// Turn database errors from admin_create_account() into plain language.
function dbErrorMessage(error: { code?: string; message?: string; details?: string }) {
  const text = `${error.message ?? ''} ${error.details ?? ''}`
  if (error.code === '23505') {
    if (text.includes('users_email_unique_idx')) return 'Someone in the system already uses that email address.'
    if (text.includes('staff_id')) return 'Another teacher already has that staff ID.'
    return 'An account with some of these details already exists.'
  }
  if (error.code === '23503') {
    if (text.includes('section_id_class_id')) return 'That section does not belong to the chosen class.'
    return 'The chosen session, class, section or subject no longer exists. Refresh the page and try again.'
  }
  if (error.code === '23514') return 'Some details are not allowed (check the gender and dates).'
  if (error.code === '22023') return error.message ?? 'Some required details are missing.'
  return null
}

async function requireAdmin(req: Request, admin: SupabaseClient) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'You need to be signed in.')

  const { data: authData, error: authError } = await admin.auth.getUser(token)
  if (authError || !authData.user) throw new HttpError(401, 'Your session has expired. Please sign in again.')

  const { data: caller, error } = await admin
    .from('users')
    .select('id, role, admin_level, is_active')
    .eq('auth_id', authData.user.id)
    .maybeSingle()
  if (error) throw error
  if (!caller || caller.role !== 'admin' || !caller.is_active) {
    throw new HttpError(403, 'Only admins can create accounts.')
  }
  return { authId: authData.user.id, adminLevel: caller.admin_level as string }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  // SERVICE_ROLE_KEY can be set by hand with `supabase secrets set`; otherwise
  // use the key Supabase injects automatically.
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const appUrl = Deno.env.get('APP_URL')
  if (!supabaseUrl || !serviceKey || !appUrl) {
    console.error('Missing SUPABASE_URL, service role key or APP_URL')
    return json({ error: 'The invite service is not configured yet (missing APP_URL secret or service key).' }, 500)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let createdUserId: string | null = null

  try {
    const caller = await requireAdmin(req, admin)

    let body: InviteRequest
    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'The request was not valid JSON.')
    }
    const { email, name } = validate(body)

    if (body.role === 'admin' && caller.adminLevel !== 'super_admin') {
      throw new HttpError(403, 'Only a super admin can create admin accounts.')
    }

    // 1) All database rows, in one transaction.
    const { data: created, error: createError } = await admin.rpc('admin_create_account', {
      p_actor_auth_id: caller.authId,
      p_role: body.role,
      p_first_name: name.first,
      p_middle_name: name.middle,
      p_last_name: name.last,
      p_email: email,
      p_admin_level: body.role === 'admin' ? body.admin_level : null,
      p_staff_id: body.role === 'teacher' ? body.staff_id : null,
      p_department: body.role === 'teacher' ? (body.department ?? null) : null,
      p_date_of_birth: body.role === 'student' ? (body.date_of_birth || null) : null,
      p_gender: body.role === 'student' ? (body.gender || null) : null,
      p_session_id: body.role === 'student' ? body.session_id : null,
      p_class_id: body.role === 'student' ? body.class_id : null,
      p_section_id: body.role === 'student' ? body.section_id : null,
      p_subject_ids: body.role === 'student' ? (body.subject_ids ?? []) : [],
    })
    if (createError) {
      const message = dbErrorMessage(createError)
      if (message) throw new HttpError(400, message)
      throw createError
    }
    createdUserId = created.user_id

    // 2) Invite by email. full_name and role go into the Auth user metadata.
    const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: body.full_name.trim(), role: body.role },
      redirectTo: `${appUrl.replace(/\/$/, '')}/set-password`,
    })
    if (inviteError || !invite.user) {
      const msg = inviteError?.message ?? ''
      if (inviteError?.code === 'email_exists' || /already been registered/i.test(msg)) {
        throw new HttpError(409, 'A login with that email address already exists, so it cannot be invited again.')
      }
      if (inviteError?.status === 429 || /rate limit/i.test(msg)) {
        throw new HttpError(429, 'Too many invite emails were sent recently. Wait a while and try again.')
      }
      throw new HttpError(502, `The invite email could not be sent (${msg || 'unknown error'}).`)
    }

    // 3) Link the new login to the profile.
    const { error: linkError } = await admin.from('users').update({ auth_id: invite.user.id }).eq('id', created.user_id)
    if (linkError) {
      await admin.auth.admin.deleteUser(invite.user.id)
      throw linkError
    }

    createdUserId = null // success: nothing to undo
    return json({
      ok: true,
      user_id: created.user_id,
      admission_number: created.admission_number,
    })
  } catch (err) {
    if (createdUserId) {
      const { error: undoError } = await admin.rpc('admin_discard_account', { p_user_id: createdUserId })
      if (undoError) console.error('Could not undo account creation', createdUserId, undoError)
    }
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    console.error(err)
    return json({ error: 'Something went wrong on the server while creating the account. Nothing was saved.' }, 500)
  }
})
