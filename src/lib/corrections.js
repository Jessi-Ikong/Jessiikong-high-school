import { supabase } from './supabaseClient'
import { run } from './db'
import { byName } from './people'
import { signedUrls } from './assignments'

// Data for the admin correction screens (attendance, scores, assignment
// grades). Admins can read every class; saving goes through the same tables
// and rules as the teachers' pages (see the shared components).

// Every term (newest session first), classes and sections, for the pickers.
export async function fetchCorrectionSetup() {
  const [terms, classes, sections] = await Promise.all([
    run(
      supabase
        .from('terms')
        .select('id, name, term_number, start_date, end_date, is_current, session_id, sessions!inner(name, start_date)')
        .order('start_date', { ascending: false }),
    ),
    run(supabase.from('classes').select('id, name, level').order('level')),
    run(supabase.from('sections').select('id, class_id, name').order('name')),
  ])
  return { terms, classes, sections }
}

export function termLabel(term) {
  return `${term.name}, ${term.sessions.name}${term.is_current ? ' (current)' : ''}`
}

// A section's timetable slots in a term, shaped like the teacher page's slot.
export async function fetchSectionSlots(termId, sectionId) {
  const slots = await run(
    supabase
      .from('timetable_slots')
      .select(
        'id, day_of_week, section_id, subject_id, subjects(name), sections(name, classes(name)), ' +
          'periods(name, start_time, end_time), terms(id, name, session_id, start_date, end_date), ' +
          'teachers(users(first_name, middle_name, last_name))',
      )
      .eq('term_id', termId)
      .eq('section_id', sectionId),
  )
  const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
  return slots.sort(
    (a, b) =>
      a.subjects.name.localeCompare(b.subjects.name) ||
      dayOrder.indexOf(a.day_of_week) - dayOrder.indexOf(b.day_of_week) ||
      a.periods.start_time.localeCompare(b.periods.start_time),
  )
}

// Subjects taken by anyone enrolled in the section that session (any status).
export async function fetchSectionSubjects(sessionId, sectionId) {
  const rows = await run(
    supabase
      .from('enrollments')
      .select('student_subjects(subject_id, subjects(id, name))')
      .eq('session_id', sessionId)
      .eq('section_id', sectionId),
  )
  const subjects = new Map()
  for (const e of rows) for (const ss of e.student_subjects) if (ss.subjects) subjects.set(ss.subjects.id, ss.subjects)
  return [...subjects.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// Assignments in a term, optionally for one class / section (any teacher).
export async function fetchTermAssignments(termId, classId, sectionId) {
  let query = supabase
    .from('assignments')
    .select(
      'id, title, description, attachment_url, due_at, max_score, requires_submission, created_at, term_id, section_id, subject_id, ' +
        'subjects(name), sections!inner(name, class_id, classes(name, level)), teachers(users(first_name, middle_name, last_name)), submissions(count)',
    )
    .eq('term_id', termId)
  if (sectionId) query = query.eq('section_id', sectionId)
  else if (classId) query = query.eq('sections.class_id', classId)
  const rows = await run(query)
  return rows.sort(
    (a, b) =>
      a.sections.classes.level - b.sections.classes.level ||
      a.sections.name.localeCompare(b.sections.name) ||
      a.subjects.name.localeCompare(b.subjects.name) ||
      b.created_at.localeCompare(a.created_at),
  )
}

// One assignment's roster (students who take the subject in its section that
// session, ANY enrollment status), its submissions and file links.
export async function fetchAssignmentGrading(assignment, sessionId) {
  const [enrollments, submissions] = await Promise.all([
    run(
      supabase
        .from('enrollments')
        .select('student_id, status, students(admission_number, users(first_name, middle_name, last_name)), student_subjects!inner(subject_id)')
        .eq('section_id', assignment.section_id)
        .eq('session_id', sessionId)
        .eq('student_subjects.subject_id', assignment.subject_id),
    ),
    run(
      supabase
        .from('submissions')
        .select('id, assignment_id, student_id, content, attachment_url, submitted_at, score, feedback, graded_at')
        .eq('assignment_id', assignment.id),
    ),
  ])
  const students = enrollments
    .map((e) => ({ studentId: e.student_id, enrollmentStatus: e.status, admissionNumber: e.students.admission_number, ...e.students.users }))
    .sort(byName)
  const urls = await signedUrls([assignment.attachment_url, ...submissions.map((s) => s.attachment_url)])
  return { students, submissions, urls }
}
