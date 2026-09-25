import { supabase } from './supabaseClient'
import { runWrite } from './db'

// Profile photos live in the PRIVATE "avatars" bucket as <user id>/<random>.<ext>
// (migrations 34 + 35). users.photo_url stores that path. Photos are only ever
// shown through short-lived SIGNED links, which the database lets you create
// only for your own photo, or as an admin for people you manage. (The public
// ID card check signs its photo server-side: the verify-card Edge Function.)
// Who may change a photo: the person themselves, or an admin allowed to edit
// them.
const BUCKET = 'avatars'
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
export const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp'

// Signed links for showing photos in the app: valid 5 minutes, long enough to
// load the page; an image already on screen stays visible after that. Links
// are requested in ONE batch per render (not one request per photo) and
// reused while they still have more than a minute left.
export const DISPLAY_LINK_SECONDS = 300
const cache = new Map() // path -> { url, expiresAt }
let batch = null // { paths: Set, promise }

export function getSignedPhotoUrl(path) {
  const hit = cache.get(path)
  if (hit && hit.expiresAt - Date.now() > 60_000) return Promise.resolve(hit.url)
  if (!batch) {
    const paths = new Set()
    const promise = new Promise((resolve) => setTimeout(resolve, 0)).then(async () => {
      batch = null
      const list = [...paths]
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(list, DISPLAY_LINK_SECONDS)
      if (error) throw error
      const expiresAt = Date.now() + DISPLAY_LINK_SECONDS * 1000
      for (const item of data ?? []) {
        if (item.signedUrl) cache.set(item.path, { url: item.signedUrl, expiresAt })
      }
    })
    batch = { paths, promise }
  }
  batch.paths.add(path)
  return batch.promise.then(() => cache.get(path)?.url ?? null)
}

// A fresh, single-use-length link for drawing a photo into an ID card PDF:
// created right before the photo is loaded, valid 60 seconds.
export async function freshSignedPhotoUrl(path, seconds = 60) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds)
  return error ? null : data.signedUrl
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
    if (oldPath) cache.delete(oldPath)
  } catch (err) {
    await supabase.storage.from(BUCKET).remove([path])
    throw err
  }
  if (oldPath && oldPath !== path) await supabase.storage.from(BUCKET).remove([oldPath]) // best effort
  return path
}
