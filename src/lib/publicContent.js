import { supabase } from './supabaseClient'
import { run, runWrite } from './db'
import { IMAGE_TYPES, imageProblem } from './publicContentRules'

export { CONSENT_NOTE, GALLERY_CATEGORIES, IMAGE_ACCEPT, INQUIRY_STATUSES, imageProblem, newsState, reorderPlan } from './publicContentRules'

// Public website content (migration 40): news & events, the photo gallery
// and admissions inquiries. Published news / photos are readable by anyone;
// admins (both tiers) manage everything. Inquiries: anyone can submit, only
// admins can read them.

export const GALLERY_BUCKET = 'gallery'
// The public address of a file in the gallery bucket (anyone can open it).
export function galleryUrl(path) {
  return path ? supabase.storage.from(GALLERY_BUCKET).getPublicUrl(path).data.publicUrl : null
}

// folder: 'photos' (gallery) or 'news' (cover images). Random file names, so
// addresses of unpublished photos can't be guessed.
export async function uploadGalleryImage(folder, file) {
  const problem = imageProblem(file)
  if (problem) throw new Error(problem)
  const path = `${folder}/${crypto.randomUUID()}.${IMAGE_TYPES[file.type]}`
  const { error } = await supabase.storage.from(GALLERY_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return path
}

// Best effort: a leftover file is harmless (unlisted), a failed delete isn't worth an error.
export async function removeGalleryImage(path) {
  if (!path) return
  await supabase.storage.from(GALLERY_BUCKET).remove([path])
}

// ---------- News ----------
export async function fetchAllNews() {
  const rows = await run(
    supabase
      .from('news_posts')
      .select('id, title, body, cover_image_url, is_published, published_at, created_at, updated_at, author:users!news_posts_created_by_fkey(first_name, last_name)'),
  )
  // Drafts (no date yet) first, then newest first.
  return rows.sort((a, b) => (b.published_at ?? '9999').localeCompare(a.published_at ?? '9999') || b.created_at.localeCompare(a.created_at))
}

export function saveNewsPost(id, fields) {
  const query = id
    ? supabase.from('news_posts').update(fields).eq('id', id).select('id')
    : supabase.from('news_posts').insert(fields).select('id')
  return runWrite(query)
}

export function deleteNewsPost(id) {
  return runWrite(supabase.from('news_posts').delete().eq('id', id).select('id'))
}

// ---------- Gallery ----------
export async function fetchAllPhotos() {
  return run(
    supabase
      .from('gallery_photos')
      .select('id, image_url, caption, category, display_order, is_published, created_at, uploader:users!gallery_photos_uploaded_by_fkey(first_name, last_name)')
      .order('display_order')
      .order('created_at'),
  )
}

export function addPhoto(fields) {
  return runWrite(supabase.from('gallery_photos').insert(fields).select('id'))
}

export function updatePhoto(id, fields) {
  return runWrite(supabase.from('gallery_photos').update(fields).eq('id', id).select('id'))
}

export function deletePhoto(id) {
  return runWrite(supabase.from('gallery_photos').delete().eq('id', id).select('id'))
}

// ---------- Admissions inquiries ----------
export function fetchInquiries() {
  return run(
    supabase
      .from('admissions_inquiries')
      .select('id, parent_name, email, phone, child_name, desired_class, message, status, internal_notes, submitted_at, updated_at')
      .order('submitted_at', { ascending: false }),
  )
}

export function updateInquiry(id, fields) {
  return runWrite(supabase.from('admissions_inquiries').update(fields).eq('id', id).select('id'))
}

export function deleteInquiry(id) {
  return runWrite(supabase.from('admissions_inquiries').delete().eq('id', id).select('id'))
}
