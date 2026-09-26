import { supabase } from './supabaseClient'
import { run, runWrite } from './db'

// Admin corrections to students and teachers (migration 38). Both admin tiers
// may do all of this; the database enforces who, validates, and the generic
// audit trigger logs every changed row.

export function saveStudentDetails(studentId, form) {
  return run(
    supabase.rpc('update_student_details', {
      p_student_id: studentId,
      p_first_name: form.first_name,
      p_middle_name: form.middle_name,
      p_last_name: form.last_name,
      p_date_of_birth: form.date_of_birth || null,
      p_gender: form.gender || null,
    }),
  )
}

export function saveTeacherDetails(teacherId, form) {
  return run(
    supabase.rpc('update_teacher_details', {
      p_teacher_id: teacherId,
      p_first_name: form.first_name,
      p_middle_name: form.middle_name,
      p_last_name: form.last_name,
      p_staff_id: form.staff_id,
      p_department: form.department,
    }),
  )
}

// Deactivated people can't sign in and lose all access at once (every
// permission check requires an active account). Nothing is deleted.
export function setAccountActive(userId, active) {
  return runWrite(supabase.from('users').update({ is_active: active }).eq('id', userId).select('id'))
}

// A student's subjects on one enrollment, plus what they have recorded per
// subject (scores / attendance / submissions) for the removal warning.
export async function fetchStudentSubjects(enrollmentId) {
  const [rows, usage, subjects] = await Promise.all([
    run(supabase.from('student_subjects').select('subject_id').eq('enrollment_id', enrollmentId)),
    run(supabase.rpc('student_subject_usage', { p_enrollment_id: enrollmentId })),
    run(supabase.from('subjects').select('id, name, code').order('name')),
  ])
  return {
    taken: new Set(rows.map((r) => r.subject_id)),
    usage: Object.fromEntries(usage.map((u) => [u.subject_id, u])),
    subjects,
  }
}

export function addStudentSubject(enrollmentId, subjectId) {
  return runWrite(
    supabase.from('student_subjects').insert({ enrollment_id: enrollmentId, subject_id: subjectId }).select('subject_id'),
  )
}

// Keeps the student's scores / attendance / submissions for the subject (no
// cascade); they just stop counting until the subject is added back.
export function removeStudentSubject(enrollmentId, subjectId) {
  return runWrite(
    supabase.from('student_subjects').delete().eq('enrollment_id', enrollmentId).eq('subject_id', subjectId).select('subject_id'),
  )
}

