import { supabase } from './supabaseClient'

// Calls a Supabase Edge Function and returns its JSON response. On failure it
// throws an Error whose message is the function's own { error } text, so the
// page can show exactly what went wrong.
export async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (!error) return data

  if (error.name === 'FunctionsHttpError') {
    const response = error.context
    let payload = null
    try {
      payload = await response.json()
    } catch {
      // not JSON
    }
    if (payload?.error) throw new Error(payload.error)
    if (response.status === 404) {
      throw new Error(`The "${name}" server function is not deployed yet (see test.txt for the deploy steps).`)
    }
    if (response.status === 401) {
      throw new Error('Your session has expired. Please sign out and sign in again.')
    }
    throw new Error(`The server returned an error (${response.status}${payload?.message ? `: ${payload.message}` : ''}).`)
  }

  if (error.name === 'FunctionsFetchError') {
    throw new Error(
      `Couldn't reach the "${name}" server function. Check your internet connection and that the function is deployed.`,
    )
  }
  throw new Error(`The "${name}" server function failed (${error.message}).`)
}
