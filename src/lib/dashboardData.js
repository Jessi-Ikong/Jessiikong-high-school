import { supabase } from './supabaseClient'
import { run } from './db'
import { resolveNames } from './audit'
import { LOW_ATTENDANCE_THRESHOLD, termSoFar } from './dashboard'

// Data for the four dashboards. Everything goes through the normal row rules
// (RLS): the totals come from the read-only summary functions of migration 37,
// which run with the viewer's own permissions, so nobody gets a number about
// rows they couldn't already read.

export function fetchCurrentTerm() {
  return run(
    supabase
      .from('terms')
      .select('id, name, start_date, end_date, session_id, sessions(name)')
      .eq('is_current', true)
      .maybeSingle(),
  )
}

async function count(query) {
  const { count: n, error } = await query
  if (error) throw error
  return n ?? 0
}

// ---------- Admin ----------

export async function fetchAdminOverview(term) {
  const [students, teachers, classes, overdueInvoices, fees, gaps, unassignedSlots, inactiveTeacherSlots] = await Promise.all([
    count(
      supabase
        .from('enrollments')
        .select('id, sessions!inner(is_current)', { count: 'exact', head: true })
        .eq('status', 'active')
        .eq('sessions.is_current', true),
    ),
    count(
      supabase.from('teachers').select('id, users!inner(is_active)', { count: 'exact', head: true }).eq('users.is_active', true),
    ),
    count(supabase.from('classes').select('id', { count: 'exact', head: true })),
    count(supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'overdue')),
    term ? run(supabase.rpc('fee_totals', { p_term_id: term.id })).then((rows) => rows[0]) : null,
    term ? run(supabase.rpc('timetable_gaps', { p_term_id: term.id })) : [],
    term
      ? count(
          supabase.from('timetable_slots').select('id', { count: 'exact', head: true }).eq('term_id', term.id).is('teacher_id', null),
        )
      : 0,
    // slots still assigned to a teacher who has been deactivated
    term
      ? count(
          supabase
            .from('timetable_slots')
            .select('id, teachers!inner(users!inner(is_active))', { count: 'exact', head: true })
            .eq('term_id', term.id)
            .eq('teachers.users.is_active', false),
        )
      : 0,
  ])
  return { students, teachers, classes, overdueInvoices, fees, gaps, unassignedSlots, inactiveTeacherSlots }
}

// Per section: today, this week and this term so far; plus the students below
// the threshold this term (lowest first).
export async function fetchAttendanceOverview(todayIso, weekStart, termRange) {
  const bySection = (from, to) => run(supabase.rpc('attendance_by_section', { p_from: from, p_to: to }))
  const [today, week, term, lowStudents] = await Promise.all([
    bySection(todayIso, todayIso),
    bySection(weekStart, todayIso),
    termRange ? bySection(termRange.from, termRange.to) : [],
    termRange
      ? run(
          supabase
            .rpc('student_attendance_rates', { p_from: termRange.from, p_to: termRange.to })
            .lt('rate', LOW_ATTENDANCE_THRESHOLD)
            .order('rate')
            .order('full_name')
            .limit(50),
        )
      : [],
  ])
  return { today, week, term, lowStudents }
}

// The newest audit entries the viewer may see. Limited admins only get their
// own and non-admin entries: the audit_log row rules (migration 20) decide.
export async function fetchRecentActivity(limit = 8) {
  const entries = await run(
    supabase
      .from('audit_log')
      .select('id, created_at, action, entity, entity_id, changes, user_id, users(first_name, last_name, role)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit),
  )
  const { names, rowsByEntity } = await resolveNames(entries)
  return { entries, names, rowsByEntity }
}

// ---------- Teacher ----------

// Assignments this teacher set in the current session, the submissions still
// waiting for a grade, and what's due next.
export async function fetchTeacherWork(userId) {
  const teacher = await run(supabase.from('teachers').select('id').eq('user_id', userId).maybeSingle())
  if (!teacher) return null
  const terms = await run(supabase.from('terms').select('id, sessions!inner(is_current)').eq('sessions.is_current', true))
  if (terms.length === 0) return { assignments: [], ungraded: [] }
  const assignments = await run(
    supabase
      .from('assignments')
      .select('id, title, due_at, requires_submission, term_id, section_id, subject_id, subjects(name), sections(name, classes(name))')
      .eq('teacher_id', teacher.id)
      .in('term_id', terms.map((t) => t.id)),
  )
  const handedIn = assignments.filter((a) => a.requires_submission !== false)
  const ungraded = handedIn.length
    ? await run(
        supabase
          .from('submissions')
          .select('assignment_id')
          .in('assignment_id', handedIn.map((a) => a.id))
          .is('graded_at', null),
      )
    : []
  return { assignments, ungraded }
}

// ---------- Student ----------

export async function fetchStudentHome(userId, term, day, todayIso) {
  const student = await run(supabase.from('students').select('id').eq('user_id', userId).maybeSingle())
  if (!student) return { problem: 'no-student' }
  const enrollment = await run(
    supabase
      .from('enrollments')
      .select('id, section_id, sections(name, classes(name)), sessions!inner(is_current), student_subjects(subject_id)')
      .eq('student_id', student.id)
      .eq('status', 'active')
      .eq('sessions.is_current', true)
      .maybeSingle(),
  )
  const subjectIds = enrollment?.student_subjects.map((s) => s.subject_id) ?? []
  const inTerm = enrollment && term && subjectIds.length > 0

  const [slots, assignments, scores, graded, ranking] = await Promise.all([
    inTerm && day
      ? run(
          supabase
            .from('timetable_slots')
            .select('id, subjects(name), periods(name, start_time, end_time), teachers(users(first_name, last_name))')
            .eq('section_id', enrollment.section_id)
            .eq('term_id', term.id)
            .eq('day_of_week', day)
            .in('subject_id', subjectIds),
        )
      : [],
    inTerm
      ? run(
          supabase
            .from('assignments')
            .select('id, title, due_at, requires_submission, subjects(name), submissions(id, submitted_at, graded_at)')
            .eq('section_id', enrollment.section_id)
            .eq('term_id', term.id)
            .in('subject_id', subjectIds)
            .gte('due_at', new Date().toISOString())
            .order('due_at')
            .limit(8),
        )
      : [],
    run(
      supabase
        .from('scores')
        .select('id, student_id, score_obtained, created_at, updated_at, subjects(name), assessment_components(name, max_score)')
        .eq('student_id', student.id)
        .order('updated_at', { ascending: false })
        .limit(5),
    ),
    run(
      supabase
        .from('submissions')
        .select('id, student_id, score, graded_at, assignments(title, max_score, subjects(name))')
        .eq('student_id', student.id)
        .not('graded_at', 'is', null)
        .order('graded_at', { ascending: false })
        .limit(5),
    ),
    enrollment && term
      ? run(supabase.rpc('get_class_rankings', { p_term_id: term.id, p_section_id: enrollment.section_id }))
      : [],
  ])
  const range = termSoFar(term, todayIso)
  const rate = range
    ? (await run(supabase.rpc('student_attendance_rates', { p_from: range.from, p_to: range.to, p_student_ids: [student.id] })))[0] ?? null
    : null

  slots.sort((a, b) => a.periods.start_time.localeCompare(b.periods.start_time))
  return {
    studentId: student.id,
    enrollment,
    slots,
    // submissions(...) only ever holds the student's own row (RLS)
    assignments: assignments.map((a) => ({ ...a, mine: a.submissions?.[0] ?? null })),
    scores,
    graded,
    rank: ranking.find((r) => r.student_id === student.id && r.position) ?? null,
    rate,
  }
}

// ---------- Parent ----------

// Attendance this term, recent grades and outstanding fees for each child,
// in a handful of queries for all children together.
export async function fetchChildrenSummaries(childIds, termRange) {
  if (childIds.length === 0) return { rates: [], scores: [], graded: [], invoices: [] }
  const [rates, scores, graded, invoices] = await Promise.all([
    termRange
      ? run(supabase.rpc('student_attendance_rates', { p_from: termRange.from, p_to: termRange.to, p_student_ids: childIds }))
      : [],
    run(
      supabase
        .from('scores')
        .select('id, student_id, score_obtained, created_at, updated_at, subjects(name), assessment_components(name, max_score)')
        .in('student_id', childIds)
        .order('updated_at', { ascending: false })
        .limit(10 * childIds.length),
    ),
    run(
      supabase
        .from('submissions')
        .select('id, student_id, score, graded_at, assignments(title, max_score, subjects(name))')
        .in('student_id', childIds)
        .not('graded_at', 'is', null)
        .order('graded_at', { ascending: false })
        .limit(10 * childIds.length),
    ),
    run(
      supabase
        .from('invoices')
        .select('id, student_id, amount_due, amount_paid, status, due_date, fee_structures(name), terms(name)')
        .in('student_id', childIds)
        .neq('status', 'paid'),
    ),
  ])
  return { rates, scores, graded, invoices }
}
