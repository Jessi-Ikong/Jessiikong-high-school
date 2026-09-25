import { supabase } from './supabaseClient'
import { run } from './db'

// Data for the PUBLIC website. Works signed out: the database only returns
// published news (from its publish date), published photos and the class /
// subject lists (migrations 40 and 41). Form submissions are insert-only:
// visitors can never read an inquiry or message back.

const NEWS_COLUMNS = 'id, title, body, cover_image_url, published_at'

export function fetchLatestNews(limit = 3) {
  return run(supabase.from('news_posts').select(NEWS_COLUMNS).order('published_at', { ascending: false }).limit(limit))
}

export function fetchAllNews() {
  return run(supabase.from('news_posts').select(NEWS_COLUMNS).order('published_at', { ascending: false }))
}

// null if it doesn't exist or isn't published (yet).
export function fetchNewsPost(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) return Promise.resolve(null)
  return run(supabase.from('news_posts').select(NEWS_COLUMNS).eq('id', id).maybeSingle())
}

export function fetchPublishedPhotos(limit = null) {
  let query = supabase
    .from('gallery_photos')
    .select('id, image_url, caption, category, display_order')
    .order('display_order')
    .order('created_at')
  if (limit) query = query.limit(limit)
  return run(query)
}

// Classes (in level order) and subjects, from the school's own records.
export async function fetchCatalog() {
  const [classes, subjects] = await Promise.all([
    run(supabase.from('classes').select('id, name, level').order('level')),
    run(supabase.from('subjects').select('id, name, code, description').order('name')),
  ])
  return { classes, subjects }
}

// Insert only, no reading back (return=minimal): visitors can't read these.
async function insertOnly(table, row) {
  const { error } = await supabase.from(table).insert(row)
  if (error) throw error
}

export function submitAdmissionsInquiry(fields) {
  return insertOnly('admissions_inquiries', {
    parent_name: fields.parent_name,
    email: fields.email,
    phone: fields.phone || null,
    child_name: fields.child_name,
    desired_class: fields.desired_class,
    message: fields.message || null,
  })
}

export function submitContactMessage(fields) {
  return insertOnly('contact_messages', {
    name: fields.name,
    email: fields.email,
    phone: fields.phone || null,
    subject: fields.subject || null,
    message: fields.message,
  })
}

// Plain-language errors for the public forms.
export function publicFormError(error) {
  if (error?.message?.includes('Failed to fetch')) return "We couldn't reach the school's server. Please check your connection and try again."
  if (error?.code === 'P0001') return error.message // e.g. too many submissions from one email
  if (error?.code === '23514') return 'Some details look incomplete or too long. Please check the form and try again.'
  return 'Sorry, something went wrong. Please try again, or contact us by phone or email.'
}
