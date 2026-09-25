// Pure helpers for the public website (no database access, so they can be
// tested on their own).

// News bodies are plain text: blank lines separate paragraphs. (Rendered as
// text, never as HTML, so nothing typed into a post can inject markup.)
export function toParagraphs(body) {
  return (body ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

// First ~n characters, cut at a word boundary: 'The new library opens…'
export function excerpt(body, max = 180) {
  const text = (body ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return `${cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : max).replace(/[\s,.;:]+$/, '')}…`
}

// ---------------------------------------------------------------------------
// Spam guard for the public forms.
//   * a honeypot field ("website") that is invisible to people, so only bots
//     fill it in;
//   * a form submitted within a couple of seconds of appearing was almost
//     certainly not typed by a person.
// A suspected bot is shown the normal "thank you" message but nothing is
// sent, so it learns nothing. (The database also limits each email address
// to 3 submissions an hour.)
// ---------------------------------------------------------------------------
export const HONEYPOT_FIELD = 'website'
export const MIN_FILL_MS = 2500

export function looksLikeBot({ honeypot, startedAt, now = Date.now() }) {
  if ((honeypot ?? '').trim() !== '') return true
  if (typeof startedAt === 'number' && now - startedAt < MIN_FILL_MS) return true
  return false
}

// "25 September 2026"
const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
export function formatLongDate(iso) {
  return iso ? longDate.format(new Date(iso)) : ''
}
