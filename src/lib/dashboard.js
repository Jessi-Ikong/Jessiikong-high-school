import { toIsoDate } from './dates'

// Pure helpers for the dashboards (no database access, so they can be tested
// on their own). The data itself is loaded in dashboardData.js.

// Students (and sections) under this attendance rate this term are flagged.
export const LOW_ATTENDANCE_THRESHOLD = 80

// Attendance rate, as in the database (migration 37): present + late count as
// attending; excused absences count neither for nor against.
// null when nothing countable has been marked.
export function attendanceRate({ records = 0, present = 0, late = 0, excused = 0 }) {
  const counted = Number(records) - Number(excused)
  if (counted <= 0) return null
  return Math.round((1000 * (Number(present) + Number(late))) / counted) / 10
}

// Adds up attendance_by_section rows (bigint counts may arrive as strings).
export function sumAttendance(rows) {
  const total = { records: 0, present: 0, late: 0, absent: 0, excused: 0 }
  for (const r of rows ?? []) for (const k of Object.keys(total)) total[k] += Number(r[k] ?? 0)
  return total
}

// 87.5 -> '87.5%', 100 -> '100%', null -> '—'
export function formatPercent(value) {
  return value === null || value === undefined ? '—' : `${Number(value)}%`
}

export function isLow(rate, threshold = LOW_ATTENDANCE_THRESHOLD) {
  return rate !== null && rate !== undefined && Number(rate) < threshold
}

// Monday of the week `today` is in (Saturday/Sunday -> the Monday just gone).
export function weekStartIso(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return toIsoDate(d)
}

// The part of the term that has happened so far: { from, to }, or null if the
// term hasn't started yet.
export function termSoFar(term, todayIso) {
  if (!term || todayIso < term.start_date) return null
  return { from: term.start_date, to: todayIso < term.end_date ? todayIso : term.end_date }
}

// Ungraded submissions ([{ assignment_id }]) -> one entry per assignment,
// most waiting first: [{ assignment, count }].
export function pendingByAssignment(submissions, assignments) {
  const counts = new Map()
  for (const s of submissions) counts.set(s.assignment_id, (counts.get(s.assignment_id) ?? 0) + 1)
  return assignments
    .filter((a) => counts.has(a.id))
    .map((a) => ({ assignment: a, count: counts.get(a.id) }))
    .sort((a, b) => b.count - a.count || (a.assignment.due_at ?? '').localeCompare(b.assignment.due_at ?? ''))
}

// Assignments due from now on, soonest first.
export function upcomingByDue(assignments, now = new Date(), limit = 5) {
  return assignments
    .filter((a) => a.due_at && new Date(a.due_at) >= now)
    .sort((a, b) => a.due_at.localeCompare(b.due_at))
    .slice(0, limit)
}

// Scores and graded assignments merged into one "recent grades" list, newest
// first: [{ key, subject, label, mark, max, at }].
export function recentGrades(scores, gradedSubmissions, limit = 5) {
  const items = [
    ...scores.map((s) => ({
      key: `score:${s.id}`,
      studentId: s.student_id,
      subject: s.subjects?.name ?? '',
      label: s.assessment_components?.name ?? 'Score',
      mark: s.score_obtained,
      max: s.assessment_components?.max_score ?? null,
      at: s.updated_at ?? s.created_at,
    })),
    ...gradedSubmissions.map((s) => ({
      key: `submission:${s.id}`,
      studentId: s.student_id,
      subject: s.assignments?.subjects?.name ?? '',
      label: s.assignments?.title ?? 'Assignment',
      mark: s.score,
      max: s.assignments?.max_score ?? null,
      at: s.graded_at,
    })),
  ].filter((g) => g.mark !== null && g.mark !== undefined)
  return items.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, limit)
}

// Unpaid / part-paid / overdue invoices, earliest due date first (no date last).
export function outstandingInvoices(invoices) {
  return invoices
    .filter((i) => i.status !== 'paid')
    .map((i) => ({ ...i, balance: Math.max(Number(i.amount_due) - Number(i.amount_paid), 0) }))
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
}

// Groups rows by row[field]: { [id]: rows[] } (keeps the rows' order).
export function groupBy(rows, field) {
  const out = {}
  for (const r of rows) (out[r[field]] ??= []).push(r)
  return out
}
