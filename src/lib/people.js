// Helpers for rows that carry first_name / middle_name / last_name.

export function fullName(person) {
  if (!person) return ''
  return [person.first_name, person.middle_name, person.last_name].filter(Boolean).join(' ')
}

// Sort by last name, then first name (the usual order for registers).
export function byName(a, b) {
  return (
    (a.last_name ?? '').localeCompare(b.last_name ?? '') || (a.first_name ?? '').localeCompare(b.first_name ?? '')
  )
}

// Same rule as account creation (and the database): first and last name are
// required. Returns a message, or null if the names are fine.
export function nameProblem({ first_name, last_name }) {
  return (first_name ?? '').trim() && (last_name ?? '').trim() ? null : 'Please enter both a first name and a last name.'
}

// student_subject_usage() row -> '1 score, 3 attendance marks and 1 submission'
// ('' when there is nothing recorded).
export function describeUsage(usage) {
  if (!usage) return ''
  const parts = [
    [Number(usage.scores), 'score', 'scores'],
    [Number(usage.attendance), 'attendance mark', 'attendance marks'],
    [Number(usage.submissions), 'assignment submission', 'assignment submissions'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// Why an ADMIN account can't be deactivated right now, or null if it can.
// Mirrors the database rails (migration 042), so the Staff page can explain
// instead of failing: nobody deactivates their own account, and the last
// active super admin always stays. `admins`: every admin (a super admin sees
// them all). Reactivating is always allowed.
export function adminDeactivationBlocker(admin, admins, myUserId) {
  if (!admin.is_active) return null
  if (admin.id === myUserId) return "You can't deactivate your own account."
  const otherActiveSuper = admins.some((a) => a.id !== admin.id && a.is_active && a.admin_level === 'super_admin')
  if (admin.admin_level === 'super_admin' && !otherActiveSuper) return "This is the last active super admin, so it can't be deactivated."
  return null
}
