// Which colour a status uses everywhere in the dashboards, so the same word
// always looks the same (e.g. "overdue" is always red, "graded" always green).
// Tones: success | warning | danger | info | neutral  (styles/app.css .ds-badge-*)
export const STATUS_TONES = {
  // grading & assignments
  graded: 'success',
  submitted: 'info',
  late: 'warning',
  overdue: 'danger',
  locked: 'neutral',
  'not-submitted': 'neutral',
  // attendance
  present: 'success',
  absent: 'danger',
  excused: 'info',
  // fees & payments
  paid: 'success',
  partial: 'warning',
  unpaid: 'neutral',
  successful: 'success',
  pending: 'warning',
  failed: 'danger',
  // accounts & enrollments
  active: 'success',
  deactivated: 'neutral',
  withdrawn: 'neutral',
  promoted: 'info',
  graduated: 'info',
  // website & inbox
  new: 'warning',
  contacted: 'info',
  replied: 'info',
  enrolled: 'success',
  declined: 'neutral',
  closed: 'neutral',
  draft: 'neutral',
  scheduled: 'info',
  published: 'success',
}

export function toneFor(status) {
  return STATUS_TONES[String(status ?? '').toLowerCase()] ?? 'neutral'
}
