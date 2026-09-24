import { supabase } from './supabaseClient'

// Runs a Supabase query and returns its data, throwing its error instead.
export async function run(query) {
  const { data, error } = await query
  if (error) throw error
  return data
}

// For update/delete queries ending in .select(): RLS doesn't raise an error
// when it blocks an update or delete, it just affects 0 rows. Treat that as
// a failure rather than silently doing nothing.
export async function runWrite(query) {
  const rows = await run(query)
  if (!rows || rows.length === 0) {
    const error = new Error('No rows were changed')
    error.code = 'NO_ROWS_CHANGED'
    throw error
  }
  return rows
}

// Turns a Supabase/Postgres error into plain language.
// `messages` can override the text for specific cases, e.g. { unique: '...' }.
export function friendlyDbError(error, messages = {}) {
  if (!error) return null
  if (error.message?.includes('Failed to fetch')) {
    return "We couldn't reach the server. Check your internet connection and try again."
  }
  switch (error.code) {
    case '23505': // unique_violation
      return messages.unique ?? 'Something with those details already exists.'
    case '23P01': // exclusion_violation (e.g. overlapping ranges)
      return messages.exclusion ?? 'Some of these ranges overlap.'
    case '23514': // check_violation
      return messages.check ?? 'Some of the values are not allowed. Check the dates and numbers.'
    case '23503': // foreign_key_violation
      return messages.foreignKey ?? 'This is still used by other records, so it cannot be removed.'
    case 'P0001': // raised by our own database rules, already plain language
      return error.message
    case '42501': // insufficient_privilege (RLS)
    case 'NO_ROWS_CHANGED':
      return "Nothing was saved: your account isn't allowed to do this, or the item no longer exists. Refresh the page and try again."
    default:
      return 'Something went wrong. Please try again.'
  }
}

// Counts rows in other tables that point at a record, e.g. before deleting it.
// checks: [{ table, column, value, label: ['enrollment', 'enrollments'] }]
// Returns only the non-zero ones: [{ count, text: '3 enrollments' }]
export async function findDependents(checks) {
  const counts = await Promise.all(
    checks.map(async ({ table, column, value }) => {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq(column, value)
      if (error) throw error
      return count ?? 0
    }),
  )
  return checks
    .map((check, i) => ({ count: counts[i], text: `${counts[i]} ${counts[i] === 1 ? check.label[0] : check.label[1]}` }))
    .filter((d) => d.count > 0)
}
