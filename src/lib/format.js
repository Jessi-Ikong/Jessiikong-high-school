const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

// '2026-09-07' -> '7 Sept 2026'. Dates from the database have no time zone,
// so format them as UTC to avoid showing the day before.
export function formatDate(isoDate) {
  if (!isoDate) return ''
  return dateFormatter.format(new Date(`${isoDate}T00:00:00Z`))
}
