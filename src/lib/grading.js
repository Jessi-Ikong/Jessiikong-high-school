import { fromIsoDate, toIsoDate } from './dates'
import { formatDate } from './format'

// Total weight of a term + subject's assessment components. Grading for that
// subject is "complete" only when this is exactly 100 (the database enforces
// the same rule before any score can be saved).
export function weightTotal(components) {
  // Rounded to 2 decimals: the database adds weights exactly, but in JavaScript
  // e.g. 33.33 + 33.33 + 33.34 would give 99.99999...
  return Math.round(components.reduce((sum, c) => sum + Number(c.weight), 0) * 100) / 100
}

// A student's weighted total out of 100 for one subject: the sum over
// components of (score / max_score x weight). Blank scores count as 0.
export function weightedTotal(components, scoreFor) {
  return components.reduce((sum, c) => {
    const score = scoreFor(c.id)
    return score === null || score === undefined || score === '' ? sum : sum + (Number(score) / Number(c.max_score)) * Number(c.weight)
  }, 0)
}

// ---------------------------------------------------------------------------
// Grade letters (school-wide grading_scale). Bands are whole numbers with both
// ends included (e.g. B = 60–69). A percentage is rounded to the nearest whole
// number (.5 rounds up) before looking up its band, so 69.5 -> A, 69.4 -> B.
// ---------------------------------------------------------------------------

// The band for a percentage, or null if there's no score or no band covers it
// (show "—" in that case rather than guessing).
export function gradeFor(score, scale) {
  if (score === null || score === undefined || score === '' || Number.isNaN(Number(score))) return null
  const rounded = Math.round(Number(score))
  return scale.find((b) => rounded >= Number(b.min_score) && rounded <= Number(b.max_score)) ?? null
}

export function gradeLabel(score, scale) {
  return gradeFor(score, scale)?.grade ?? '—'
}

// Problems with a draft scale, in plain language (the database checks the same
// rules on save). Empty list = valid.
export function scaleProblems(bands) {
  const problems = []
  const parsed = bands.map((b, i) => {
    const label = b.grade?.trim() || `Row ${i + 1}`
    const min = String(b.min_score).trim()
    const max = String(b.max_score).trim()
    if (!b.grade?.trim()) problems.push(`Row ${i + 1} needs a grade letter.`)
    for (const [value, name] of [[min, 'lowest score'], [max, 'highest score']]) {
      if (!/^\d+$/.test(value) || Number(value) > 100) problems.push(`${label}: the ${name} must be a whole number from 0 to 100.`)
    }
    return { label, min: Number(min), max: Number(max), valid: /^\d+$/.test(min) && /^\d+$/.test(max) }
  })
  const letters = bands.map((b) => b.grade?.trim().toUpperCase()).filter(Boolean)
  for (const letter of new Set(letters)) {
    if (letters.filter((l) => l === letter).length > 1) problems.push(`Grade "${letter}" is used more than once.`)
  }
  for (const p of parsed) if (p.valid && p.min > p.max) problems.push(`${p.label}: the lowest score (${p.min}) is above the highest (${p.max}).`)
  if (problems.length > 0) return problems
  if (parsed.length === 0) return ['The scale needs at least one band covering 0 to 100.']

  const sorted = [...parsed].sort((a, b) => a.min - b.min || a.max - b.max)
  if (sorted[0].min !== 0) problems.push(`The scale must start at 0: the lowest band (${sorted[0].label}) starts at ${sorted[0].min}.`)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (cur.min <= prev.max) {
      problems.push(`${prev.label} (${prev.min}–${prev.max}) and ${cur.label} (${cur.min}–${cur.max}) overlap.`)
    } else if (cur.min > prev.max + 1) {
      problems.push(`Gap: no grade covers ${prev.max + 1} to ${cur.min - 1} (between ${prev.label} and ${cur.label}).`)
    }
  }
  const last = sorted[sorted.length - 1]
  if (last.max !== 100) problems.push(`The scale must reach 100: the highest band (${last.label}) ends at ${last.max}.`)
  return problems
}

// ---------------------------------------------------------------------------
// Term edit lock (migration 023). Teachers can enter or change scores and
// assignment grades until 7 days after the term's end_date (inclusive); after
// that only an admin can. The database enforces this; these helpers just let
// the pages explain it up front. `term` needs end_date and name.
// ---------------------------------------------------------------------------

// The last day teachers can still make changes, as 'YYYY-MM-DD'.
export function termGradingLastDay(term) {
  const last = fromIsoDate(term.end_date)
  last.setDate(last.getDate() + 7)
  return toIsoDate(last)
}

export function termGradingOpen(term, today = new Date()) {
  return toIsoDate(today) <= termGradingLastDay(term)
}

// what: 'Scores' or 'Assignment grades'
export function termLockedMessage(term, what) {
  return `${what} for ${term.name} are locked: the term ended on ${formatDate(term.end_date)} and teachers could make changes until ${formatDate(termGradingLastDay(term))}. Only an admin can change them now.`
}
