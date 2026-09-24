import { supabase } from './supabaseClient'
import { run } from './db'
import { byName } from './people'

// The signed-in parent's linked children (parent_students), with their class
// this session if they're enrolled. Returns [] if the account has no parent
// record or no children linked yet.
export async function fetchMyChildren(userId) {
  const parent = await run(supabase.from('parents').select('id').eq('user_id', userId).maybeSingle())
  if (!parent) return []
  const links = await run(
    supabase
      .from('parent_students')
      .select('relationship, students(id, admission_number, users(first_name, middle_name, last_name))')
      .eq('parent_id', parent.id),
  )
  const children = links
    .filter((l) => l.students)
    .map((l) => ({
      id: l.students.id,
      admissionNumber: l.students.admission_number,
      relationship: l.relationship,
      ...l.students.users,
    }))
  if (children.length === 0) return []

  const enrollments = await run(
    supabase
      .from('enrollments')
      .select('student_id, classes(name), sections(name), sessions!inner(is_current)')
      .in('student_id', children.map((c) => c.id))
      .eq('sessions.is_current', true),
  )
  const classOf = Object.fromEntries(enrollments.map((e) => [e.student_id, `${e.classes.name} ${e.sections.name}`]))
  return children.map((c) => ({ ...c, className: classOf[c.id] ?? null })).sort(byName)
}
