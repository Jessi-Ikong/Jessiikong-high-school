import { supabase } from './supabaseClient'
import { run } from './db'

// The teacher's classes (subject + section) in each term of the CURRENT session.
export async function fetchTeacherClasses(userId) {
  const teacher = await run(supabase.from('teachers').select('id').eq('user_id', userId).maybeSingle())
  if (!teacher) return { problem: 'no-teacher' }
  const terms = await run(
    supabase
      .from('terms')
      .select('id, name, term_number, is_current, start_date, end_date, session_id, sessions!inner(name, is_current)')
      .eq('sessions.is_current', true)
      .order('term_number'),
  )
  if (terms.length === 0) return { problem: 'no-session' }
  const slots = await run(
    supabase
      .from('timetable_slots')
      .select('term_id, section_id, subject_id, subjects(name), sections(name, classes(name, level))')
      .eq('teacher_id', teacher.id)
      .in('term_id', terms.map((t) => t.id)),
  )
  // One entry per term + section + subject (a class can meet several times a week).
  const classes = new Map()
  for (const s of slots) {
    const key = `${s.term_id}:${s.section_id}:${s.subject_id}`
    if (!classes.has(key)) {
      classes.set(key, {
        key,
        termId: s.term_id,
        sectionId: s.section_id,
        subjectId: s.subject_id,
        label: `${s.subjects.name} — ${s.sections.classes.name} ${s.sections.name}`,
        order: `${String(s.sections.classes.level).padStart(3, '0')}${s.sections.name}${s.subjects.name}`,
      })
    }
  }
  return { teacherId: teacher.id, terms, classes: [...classes.values()].sort((a, b) => a.order.localeCompare(b.order)) }
}
