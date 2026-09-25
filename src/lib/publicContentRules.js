// Pure rules for the public website content (no database access, so they
// can be tested on their own). Data access: publicContent.js.

// Shown in the upload form (required wording).
export const CONSENT_NOTE =
  'Only upload photos appropriate for public display (group activities, events, facilities). Do not upload identifiable close-up photos of individual students without separate parental consent obtained outside this system.'

export const GALLERY_CATEGORIES = ['Events', 'Facilities', 'Sports', 'Academics', 'Other']
export const INQUIRY_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'enrolled', label: 'Enrolled' },
  { value: 'declined', label: 'Declined' },
]

// Same limits as the storage bucket.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
export const IMAGE_ACCEPT = Object.keys(IMAGE_TYPES).join(',')

// A message if this file can't be used, else null.
export function imageProblem(file) {
  if (!file) return 'Choose a photo.'
  if (!IMAGE_TYPES[file.type]) return 'Only JPEG, PNG or WebP images can be uploaded.'
  if (file.size > MAX_IMAGE_BYTES) return 'That image is larger than 10 MB. Please resize it first.'
  return null
}

// 'draft' | 'scheduled' | 'published'
export function newsState(post, now = new Date()) {
  if (!post.is_published) return 'draft'
  return new Date(post.published_at) > now ? 'scheduled' : 'published'
}

// Moves photos[index] by `step` (-1 up, +1 down) and renumbers the list
// 10, 20, 30... Returns the updates to make: [{ id, display_order }] (only
// rows whose number changes).
export function reorderPlan(photos, index, step) {
  const target = index + step
  if (target < 0 || target >= photos.length) return []
  const order = [...photos]
  ;[order[index], order[target]] = [order[target], order[index]]
  return order
    .map((p, i) => ({ id: p.id, display_order: (i + 1) * 10, before: p.display_order }))
    .filter((p) => p.display_order !== p.before)
    .map(({ id, display_order }) => ({ id, display_order }))
}
