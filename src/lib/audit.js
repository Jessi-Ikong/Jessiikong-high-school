import { supabase } from './supabaseClient'
import { run } from './db'

// Human labels for each table: [singular, plural].
export const ENTITY_LABELS = {
  admissions_inquiries: ['admissions inquiry', 'admissions inquiries'],
  announcements: ['announcement', 'announcements'],
  assessment_components: ['assessment component', 'assessment components'],
  assignments: ['assignment', 'assignments'],
  attendance_records: ['attendance record', 'attendance records'],
  classes: ['class', 'classes'],
  enrollments: ['enrollment', 'enrollments'],
  fee_structures: ['fee item', 'fee items'],
  gallery_photos: ['gallery photo', 'gallery photos'],
  grading_scale: ['grade band', 'grade scale'],
  id_cards: ['ID card', 'ID cards'],
  invoices: ['invoice', 'invoices'],
  message_threads: ['message thread', 'message threads'],
  messages: ['message', 'messages'],
  news_posts: ['news post', 'news posts'],
  parent_students: ['parent–student link', 'parent–student links'],
  parents: ['parent', 'parents'],
  payments: ['payment', 'payments'],
  periods: ['period', 'periods'],
  scores: ['score', 'scores'],
  sections: ['section', 'sections'],
  sessions: ['session', 'sessions'],
  student_subjects: ['student subject', 'student subjects'],
  students: ['student', 'students'],
  subjects: ['subject', 'subjects'],
  submissions: ['submission', 'submissions'],
  teachers: ['teacher', 'teachers'],
  terms: ['term', 'terms'],
  timetable_slots: ['timetable slot', 'timetable slots'],
  users: ['user account', 'user accounts'],
}

const FIELD_LABELS = {
  score_obtained: 'Score',
  is_current: 'Current',
  is_active: 'Active',
  is_break: 'Break',
  marked_by: 'Marked by',
  entered_by: 'Entered by',
  created_by: 'Created by',
  graded_by: 'Graded by',
  issued_by: 'Issued by',
  paid_by: 'Paid by',
  uploaded_by: 'Uploaded by',
  internal_notes: 'Internal notes',
  sender_id: 'Sender',
  author_id: 'Author',
  auth_id: 'Login',
  admission_session_id: 'Admission session',
  timetable_slot_id: 'Class (timetable slot)',
  component_id: 'Component',
  day_of_week: 'Day',
  max_score: 'Max score',
  min_score: 'From',
  amount_due: 'Amount due',
  amount_paid: 'Amount paid',
  provider_ref: 'Reference',
  original_marked_by_name: 'Originally marked by',
}

// Columns that point at another record, and which lookup map resolves them.
const REF_FIELDS = {
  user_id: 'users', marked_by: 'users', entered_by: 'users', created_by: 'users', graded_by: 'users',
  issued_by: 'users', paid_by: 'users', uploaded_by: 'users', sender_id: 'users', author_id: 'users', original_marked_by: 'users',
  student_id: 'students', teacher_id: 'teachers', parent_id: 'parents', class_id: 'classes', section_id: 'sections',
  subject_id: 'subjects', session_id: 'sessions', admission_session_id: 'sessions', term_id: 'terms',
  period_id: 'periods', timetable_slot_id: 'timetable_slots', component_id: 'assessment_components',
  enrollment_id: 'enrollments', fee_structure_id: 'fee_structures',
}
const HIDDEN_FIELDS = new Set(['id', 'created_at', 'updated_at', 'user_role', 'auth_id', 'original_marked_by'])
// Tables whose row, for an UPDATE, we look up to find the student it concerns.
const STUDENT_ROW_TABLES = { scores: 'student_id', invoices: 'student_id', submissions: 'student_id', enrollments: 'student_id', attendance_records: 'enrollment_id' }

export function describeAction(entry) {
  if (entry.action === 'correct_attendance') return { verb: 'Corrected', noun: 'attendance record' }
  const op = entry.action.split('_')[0]
  const verb = { insert: 'Created', update: 'Updated', delete: 'Deleted' }[op] ?? entry.action
  return { verb, noun: ENTITY_LABELS[entry.entity]?.[0] ?? entry.entity }
}

export function fieldLabel(key) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key]
  const text = key.replace(/_id$/, '').replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const shortId = (id) => `#${String(id).slice(0, 8)}`
const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)

export function formatValue(key, value, names) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  const ref = REF_FIELDS[key]
  if (ref && isUuid(value)) return names[ref]?.[value] ?? shortId(value)
  if (isUuid(value)) return shortId(value)
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string' && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value))) return dateTime.format(new Date(value))
  const text = String(value)
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

// The full row we know for an entry (insert/delete: the row; update: none).
function rowOf(entry) {
  const op = entry.action.split('_')[0]
  return op === 'insert' || op === 'delete' || entry.action === 'insert' || entry.action === 'delete' ? entry.changes ?? {} : null
}

// A readable name for the record an entry is about.
export function targetLabel(entry, names, rowsByEntity) {
  const e = entry.entity
  const id = entry.entity_id
  const direct = names[e]?.[id]
  if (direct) return direct
  const row = rowOf(entry) ?? rowsByEntity[e]?.[id] ?? {}
  const studentRef = row.student_id ? names.students?.[row.student_id] : row.enrollment_id ? names.enrollments?.[row.enrollment_id] : null
  switch (e) {
    case 'scores':
      return [studentRef, names.assessment_components?.[row.component_id]].filter(Boolean).join(' — ') || shortId(id)
    case 'attendance_records':
      return [studentRef, row.date].filter(Boolean).join(', ') || shortId(id)
    case 'invoices':
    case 'submissions':
    case 'enrollments':
      return studentRef ?? shortId(id)
    case 'parent_students': {
      const [parentId, studentId] = String(id).split(':')
      return `${names.parents?.[parentId] ?? shortId(parentId)} → ${names.students?.[studentId] ?? shortId(studentId)}`
    }
    case 'student_subjects': {
      const [enrollmentId, subjectId] = String(id).split(':')
      return `${names.enrollments?.[enrollmentId] ?? shortId(enrollmentId)}: ${names.subjects?.[subjectId] ?? shortId(subjectId)}`
    }
    case 'gallery_photos':
      return row.caption ?? row.image_url ?? shortId(id)
    case 'admissions_inquiries':
      return row.parent_name ? `${row.parent_name} (for ${row.child_name})` : shortId(id)
    case 'messages':
      return `from ${names.users?.[row.sender_id] ?? 'someone'}`
    case 'timetable_slots':
      // deleted slots can't be looked up any more; describe them from the old row
      return row.subject_id
        ? `${names.subjects?.[row.subject_id] ?? shortId(row.subject_id)} — ${names.sections?.[row.section_id] ?? shortId(row.section_id)}, ${row.day_of_week} ${names.periods?.[row.period_id] ?? ''}`.trim()
        : shortId(id)
    default: {
      const person = row.first_name ? [row.first_name, row.last_name].filter(Boolean).join(' ') : null
      return row.name ?? row.title ?? row.grade ?? person ?? row.admission_number ?? row.staff_id ?? (id ? shortId(id) : '—')
    }
  }
}

// Readable change lines: ["Name: JSS1 → JSS 1", ...]
export function changeLines(entry, names) {
  const c = entry.changes ?? {}
  if (entry.action === 'correct_attendance') {
    const lines = [`Status: ${c.status?.old ?? '—'} → ${c.status?.new ?? '—'}`]
    if (c.original_marked_by_name) lines.push(`Originally marked by ${c.original_marked_by_name}`)
    for (const [k, v] of Object.entries(c.other_changes ?? {})) lines.push(`${fieldLabel(k)}: ${formatValue(k, v.old, names)} → ${formatValue(k, v.new, names)}`)
    return lines
  }
  const op = entry.action.split('_')[0]
  if (op === 'update' || entry.action === 'update') {
    return Object.entries(c)
      .filter(([k]) => !HIDDEN_FIELDS.has(k) || k === 'auth_id')
      .map(([k, v]) =>
        k === 'auth_id'
          ? `Login ${v.new ? 'linked' : 'removed'}`
          : `${fieldLabel(k)}: ${formatValue(k, v?.old, names)} → ${formatValue(k, v?.new, names)}`,
      )
  }
  return Object.entries(c)
    .filter(([k, v]) => !HIDDEN_FIELDS.has(k) && v !== null && v !== '')
    .map(([k, v]) => `${fieldLabel(k)}: ${formatValue(k, v, names)}`)
}

// Look up readable names for every record referenced on a page of entries.
export async function resolveNames(entries) {
  const want = {}
  const add = (table, id) => {
    if (!table || !isUuid(id)) return
    ;(want[table] ??= new Set()).add(id)
  }
  const scanRow = (row) => {
    for (const [k, v] of Object.entries(row ?? {})) {
      if (REF_FIELDS[k]) add(REF_FIELDS[k], v && typeof v === 'object' ? null : v)
      if (v && typeof v === 'object' && REF_FIELDS[k]) {
        add(REF_FIELDS[k], v.old)
        add(REF_FIELDS[k], v.new)
      }
    }
  }
  const rowNeeded = {}
  for (const e of entries) {
    add(e.entity === 'grading_scale' ? null : e.entity, e.entity_id)
    if (e.entity === 'parent_students' || e.entity === 'student_subjects') {
      const [a, b] = String(e.entity_id).split(':')
      if (e.entity === 'parent_students') { add('parents', a); add('students', b) }
      else { add('enrollments', a); add('subjects', b) }
    }
    scanRow(e.changes)
    const isUpdate = e.action.startsWith('update') || e.action === 'correct_attendance'
    if (isUpdate && STUDENT_ROW_TABLES[e.entity]) (rowNeeded[e.entity] ??= new Set()).add(e.entity_id)
  }

  // Rows for updates, so we can tell which student a score/invoice/... is about.
  const rowsByEntity = {}
  await Promise.all(
    Object.entries(rowNeeded).map(async ([table, ids]) => {
      const cols = table === 'scores' ? 'id, student_id, component_id' : table === 'attendance_records' ? 'id, enrollment_id, date' : 'id, student_id'
      const rows = await run(supabase.from(table).select(cols).in('id', [...ids]))
      rowsByEntity[table] = Object.fromEntries(rows.map((r) => [r.id, r]))
      rows.forEach(scanRow)
    }),
  )
  // Enrollments point at students; fetch them first so students get resolved too.
  const names = {}
  const fetchers = {
    users: (ids) => run(supabase.from('users').select('id, first_name, last_name').in('id', ids)).then((r) => r.map((u) => [u.id, `${u.first_name} ${u.last_name}`])),
    students: (ids) => run(supabase.from('students').select('id, admission_number, users(first_name, last_name)').in('id', ids)).then((r) => r.map((s) => [s.id, `${s.users.first_name} ${s.users.last_name} (${s.admission_number})`])),
    teachers: (ids) => run(supabase.from('teachers').select('id, users(first_name, last_name)').in('id', ids)).then((r) => r.map((t) => [t.id, `${t.users.first_name} ${t.users.last_name}`])),
    parents: (ids) => run(supabase.from('parents').select('id, users(first_name, last_name)').in('id', ids)).then((r) => r.map((p) => [p.id, `${p.users.first_name} ${p.users.last_name}`])),
    classes: (ids) => run(supabase.from('classes').select('id, name').in('id', ids)).then((r) => r.map((c) => [c.id, c.name])),
    sections: (ids) => run(supabase.from('sections').select('id, name, classes(name)').in('id', ids)).then((r) => r.map((s) => [s.id, `${s.classes.name} ${s.name}`])),
    subjects: (ids) => run(supabase.from('subjects').select('id, name').in('id', ids)).then((r) => r.map((s) => [s.id, s.name])),
    sessions: (ids) => run(supabase.from('sessions').select('id, name').in('id', ids)).then((r) => r.map((s) => [s.id, s.name])),
    terms: (ids) => run(supabase.from('terms').select('id, name, sessions(name)').in('id', ids)).then((r) => r.map((t) => [t.id, `${t.name}, ${t.sessions.name}`])),
    news_posts: (ids) => run(supabase.from('news_posts').select('id, title').in('id', ids)).then((r) => r.map((p) => [p.id, p.title])),
    gallery_photos: (ids) => run(supabase.from('gallery_photos').select('id, caption, image_url').in('id', ids)).then((r) => r.map((p) => [p.id, p.caption ?? p.image_url])),
    admissions_inquiries: (ids) => run(supabase.from('admissions_inquiries').select('id, parent_name, child_name').in('id', ids)).then((r) => r.map((i) => [i.id, `${i.parent_name} (for ${i.child_name})`])),
    periods: (ids) => run(supabase.from('periods').select('id, name').in('id', ids)).then((r) => r.map((p) => [p.id, p.name])),
    assessment_components: (ids) => run(supabase.from('assessment_components').select('id, name, subjects(name)').in('id', ids)).then((r) => r.map((c) => [c.id, `${c.subjects.name} ${c.name}`])),
    fee_structures: (ids) => run(supabase.from('fee_structures').select('id, name, classes(name)').in('id', ids)).then((r) => r.map((f) => [f.id, `${f.classes.name} ${f.name}`])),
    timetable_slots: (ids) => run(supabase.from('timetable_slots').select('id, day_of_week, subjects(name), sections(name, classes(name)), periods(name)').in('id', ids)).then((r) => r.map((s) => [s.id, `${s.subjects.name} — ${s.sections.classes.name} ${s.sections.name}, ${s.day_of_week} ${s.periods.name}`])),
  }
  if (want.enrollments) {
    const rows = await run(supabase.from('enrollments').select('id, student_id, sections(name, classes(name))').in('id', [...want.enrollments]))
    rows.forEach((r) => add('students', r.student_id))
    names.enrollments = Object.fromEntries(rows.map((r) => [r.id, { studentId: r.student_id, cls: `${r.sections.classes.name} ${r.sections.name}` }]))
  }
  await Promise.all(
    Object.entries(fetchers)
      .filter(([table]) => want[table]?.size)
      .map(async ([table, fetch]) => {
        try {
          names[table] = Object.fromEntries(await fetch([...want[table]]))
        } catch {
          names[table] = {} // a lookup failing just means IDs are shown instead of names
        }
      }),
  )
  if (names.enrollments) {
    for (const [id, e] of Object.entries(names.enrollments)) {
      names.enrollments[id] = `${names.students?.[e.studentId] ?? shortId(e.studentId)}, ${e.cls}`
    }
  }
  return { names, rowsByEntity }
}
