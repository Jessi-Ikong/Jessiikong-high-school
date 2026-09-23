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
