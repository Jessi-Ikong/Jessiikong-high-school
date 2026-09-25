import { supabase } from './supabaseClient'
import { run } from './db'

// Who sees an announcement is decided by the database (migrations 9 + 33):
// all / teachers / students / parents / one class (its active students, their
// parents and the teachers who teach it this session); admins see everything.
// So one query serves every role: it only ever returns what the viewer may see.
// limit: only the newest few (dashboard previews).
export function fetchAnnouncements(limit = null) {
  let query = supabase
    .from('announcements')
    .select('id, title, body, audience, class_id, classes(name), author_name, published_at, expires_at, created_at, updated_at')
    .order('published_at', { ascending: false })
  if (limit) query = query.limit(limit)
  return run(query)
}

export const AUDIENCES = [
  { value: 'all', label: 'Everyone' },
  { value: 'teachers', label: 'Teachers' },
  { value: 'students', label: 'Students' },
  { value: 'parents', label: 'Parents' },
  { value: 'specific_class', label: 'A specific class' },
]

// 'Everyone', 'Parents', 'Class: JSS1'
export function audienceLabel(announcement) {
  if (announcement.audience === 'specific_class') return `Class: ${announcement.classes?.name ?? '—'}`
  return AUDIENCES.find((a) => a.value === announcement.audience)?.label ?? announcement.audience
}
