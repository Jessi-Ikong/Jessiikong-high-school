import { toIsoDate } from './dates'

export const STATUSES = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'late', label: 'Late' },
  { value: 'excused', label: 'Excused' },
]

// Teachers can only record or change attendance this many days back (the
// database enforces the same rule; admins are exempt). Older dates are view-only.
export const EDIT_WINDOW_DAYS = 7

export function isEditable(isoDate, today = new Date()) {
  const earliest = new Date(today)
  earliest.setDate(earliest.getDate() - EDIT_WINDOW_DAYS)
  return isoDate >= toIsoDate(earliest)
}
