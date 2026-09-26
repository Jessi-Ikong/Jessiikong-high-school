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
  // setup & grading configuration
  complete: 'success',
  incomplete: 'warning',
  'not set up': 'neutral',
  current: 'success',
  editing: 'info',
  break: 'neutral',
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
  hidden: 'neutral',
  // audit log & ID cards
  created: 'success',
  updated: 'info',
  deleted: 'danger',
  corrected: 'warning',
  revoked: 'danger',
  // messages
  unread: 'warning',
  read: 'neutral',
  // dashboards
  marked: 'success',
  'not marked': 'warning',
  'to grade': 'warning',
  'no hand-in': 'neutral',
  low: 'warning',
  due: 'neutral',
}

export function toneFor(status) {
  return STATUS_TONES[String(status ?? '').toLowerCase()] ?? 'neutral'
}
