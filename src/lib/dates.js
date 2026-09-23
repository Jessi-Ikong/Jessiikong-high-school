// School days as stored in timetable_slots.day_of_week.
export const SCHOOL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// A Date as 'YYYY-MM-DD' in the browser's LOCAL time (toISOString would use
// UTC, which is the previous day between midnight and 1am in Nigeria).
export function toIsoDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 'YYYY-MM-DD' -> local Date at midnight.
export function fromIsoDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// 'monday' ... or null on weekends.
export function schoolDayOf(date) {
  const name = WEEKDAY_NAMES[date.getDay()]
  return SCHOOL_DAYS.includes(name) ? name : null
}

export function capitalise(word) {
  return word ? word[0].toUpperCase() + word.slice(1) : ''
}

// The most recent dates (newest first, up to `count`) that fall on `dayOfWeek`,
// are not in the future, and lie inside [startIso, endIso].
export function recentDatesOn(dayOfWeek, startIso, endIso, count = 4, today = new Date()) {
  const target = WEEKDAY_NAMES.indexOf(dayOfWeek)
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  cursor.setDate(cursor.getDate() - ((cursor.getDay() - target + 7) % 7))
  const end = endIso ? fromIsoDate(endIso) : null
  while (end && cursor > end) cursor.setDate(cursor.getDate() - 7)

  const dates = []
  const start = startIso ? fromIsoDate(startIso) : null
  while (dates.length < count && (!start || cursor >= start)) {
    dates.push(toIsoDate(cursor))
    cursor.setDate(cursor.getDate() - 7)
  }
  return dates
}
