import { supabase } from './supabaseClient'

// Files for assignments live in the private "assignments" storage bucket.
// The bucket itself enforces the same limits (migration 022); checking here
// first gives a clear message before anything is uploaded.
export const BUCKET = 'assignments'
export const MAX_FILE_BYTES = 10 * 1024 * 1024

// Extension -> content type. Browsers sometimes report an empty type for Word
// files, so the type is taken from the extension.
const FILE_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

export const FILE_ACCEPT = Object.keys(FILE_TYPES).map((ext) => `.${ext}`).join(',')
export const FILE_RULES = 'PDF, Word (.doc, .docx) or an image (JPG, PNG, GIF, WebP), up to 10 MB.'

function extensionOf(name) {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

// Why this file can't be uploaded, or null if it's fine.
export function fileProblem(file) {
  if (!file) return null
  if (!FILE_TYPES[extensionOf(file.name)]) {
    return `"${file.name}" isn't an allowed file type. Use a ${FILE_RULES}`
  }
  if (file.size > MAX_FILE_BYTES) {
    return `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. Files can be up to 10 MB.`
  }
  if (file.size === 0) return `"${file.name}" is empty.`
  return null
}

function safeFileName(name) {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100)
}

// Uploads a file under `folder` (e.g. 'assignment/<id>') and returns its path.
export async function uploadAssignmentFile(folder, file) {
  const problem = fileProblem(file)
  if (problem) throw new Error(problem)
  const path = `${folder}/${Date.now()}-${safeFileName(file.name)}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: FILE_TYPES[extensionOf(file.name)], upsert: false })
  if (error) throw new Error(friendlyStorageError(error))
  return path
}

// Best effort: a file left behind is harmless, so failures are ignored.
export async function removeAssignmentFile(path) {
  if (!path) return
  await supabase.storage.from(BUCKET).remove([path])
}

// { path: temporary download link } for the given paths (private bucket).
export async function signedUrls(paths) {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(unique, 60 * 60)
  if (error) return {}
  return Object.fromEntries(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]))
}

// '.../1727170000000-My_essay.pdf' -> 'My_essay.pdf'
export function fileNameOf(path) {
  return path ? path.split('/').pop().replace(/^\d+-/, '') : ''
}

export function friendlyStorageError(error) {
  const text = `${error?.message ?? ''} ${error?.statusCode ?? ''}`
  if (/maximum allowed size|too large|413/i.test(text)) return 'That file is too big. Files can be up to 10 MB.'
  if (/mime type|not supported|invalid_mime/i.test(text)) return `That file type isn't allowed. Use a ${FILE_RULES}`
  if (/row-level security|403|unauthorized/i.test(text)) {
    return "The file wasn't uploaded: you're not allowed to add files here (for example, the work has already been graded)."
  }
  if (/Failed to fetch/i.test(text)) return "We couldn't reach the server. Check your internet connection and try again."
  return 'The file could not be uploaded. Please try again.'
}

// 'not-submitted' | 'submitted' | 'graded', plus whether it's late/overdue.
// Late = handed in after the due date (late work is accepted, just flagged).
// Offline work (requires_submission = false) is never handed in, so it's only
// "not graded yet" or "graded", and never Late / Overdue: the only time on
// record is when the teacher graded it, which says nothing about the student.
export function submissionStatus(assignment, submission, now = new Date()) {
  if (assignment.requires_submission === false) {
    return submission?.graded_at
      ? { key: 'graded', label: 'Graded', late: false, overdue: false }
      : { key: 'not-submitted', label: 'Not graded yet', late: false, overdue: false }
  }
  const due = assignment.due_at ? new Date(assignment.due_at) : null
  if (!submission) {
    return { key: 'not-submitted', label: 'Not submitted', late: false, overdue: Boolean(due && now > due) }
  }
  const late = Boolean(due && new Date(submission.submitted_at) > due)
  if (submission.graded_at) return { key: 'graded', label: 'Graded', late, overdue: false }
  return { key: 'submitted', label: 'Submitted', late, overdue: false }
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

// Timestamps are shown in the browser's local time.
export function formatDateTime(iso) {
  return iso ? dateTimeFormatter.format(new Date(iso)) : ''
}

export function formatMark(value) {
  return value === null || value === undefined ? '' : String(Number(value))
}
