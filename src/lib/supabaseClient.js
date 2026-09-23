import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local, then restart the dev server.',
  )
}

// When an invite or password-reset link is bad (expired, already used), Supabase
// sends the user back with the error in the URL and then clears the URL while
// starting up. Read it first so the Set Password page can explain what happened.
function readAuthLinkError() {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search)
  const code = params.get('error_code') || params.get('error')
  return code ? { code, description: params.get('error_description') } : null
}

export const authLinkError = readAuthLinkError()

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
