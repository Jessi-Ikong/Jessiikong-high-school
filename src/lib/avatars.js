import { supabase } from './supabaseClient'
import { runWrite } from './db'

// Profile photos live in the PUBLIC "avatars" bucket as <user id>/<random>.<ext>
// (migration 34): the no-login ID card verification page must be able to show
// them, and the random name means a photo can only be opened via its link.
// users.photo_url stores that path. Who may change a photo: the person
// themselves, or an admin allowed to edit them (checked by the database).
const BUCKET = 'avatars'
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
export const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp'

export function photoUrl(path) {
  return path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null
}

function extensionOf(name) {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

// Why this file can't be used as a photo, or null.
export function photoProblem(file) {
  if (!file) return null
  if (!TYPES[extensionOf(file.name)]) return `"${file.name}" isn't a JPG, PNG or WebP image.`
  if (file.size > MAX_PHOTO_BYTES) return `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. Photos can be up to 5 MB.`
  if (file.size === 0) return `"${file.name}" is empty.`
  return null
}

// Uploads a new photo for userId and makes it their photo. Returns the new path.
export async function setPhoto(userId, file, oldPath) {
  const problem = photoProblem(file)
  if (problem) throw new Error(problem)
  const ext = extensionOf(file.name)
  const path = `${userId}/${crypto.randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: TYPES[ext], upsert: false })
  if (uploadError) {
    const text = `${uploadError.message ?? ''} ${uploadError.statusCode ?? ''}`
    if (/size|413/i.test(text)) throw new Error('That photo is too big. Photos can be up to 5 MB.')
    if (/mime|type/i.test(text)) throw new Error('That file type isn’t allowed. Use a JPG, PNG or WebP image.')
    if (/security|403|unauthorized/i.test(text)) throw new Error('You’re not allowed to change this person’s photo.')
    throw new Error('The photo could not be uploaded. Please try again.')
  }
  try {
    await runWrite(supabase.from('users').update({ photo_url: path }).eq('id', userId).select('id'))
  } catch (err) {
    await supabase.storage.from(BUCKET).remove([path])
    throw err
  }
  if (oldPath && oldPath !== path) await supabase.storage.from(BUCKET).remove([oldPath]) // best effort
  return path
}
