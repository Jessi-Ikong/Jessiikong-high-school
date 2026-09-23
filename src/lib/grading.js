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
