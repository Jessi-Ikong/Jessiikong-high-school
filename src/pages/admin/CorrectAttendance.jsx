import { useState } from 'react'
import { friendlyDbError } from '../../lib/db'
import { formatDate, formatTime } from '../../lib/format'
import { capitalise, recentDatesOn, toIsoDate } from '../../lib/dates'
import { isEditable } from '../../lib/attendance'
import { fullName } from '../../lib/people'
import { fetchCorrectionSetup, fetchSectionSlots } from '../../lib/corrections'
import { useAsyncData } from '../../hooks/useAsyncData'
import { Roster } from '../../components/AttendanceRoster'
import TermClassSectionPicker from '../../components/TermClassSectionPicker'

// Admins (both tiers) correct attendance for ANY class and ANY past date in a
// term. It uses the teacher's roster and saves through the same table and
// rules: the database still checks weekday, term dates, no future dates and
// that the student takes the subject; admins are only exempt from the 7-day
// window (migration 15). marked_by becomes the admin, and the correction is
// logged with the original marker (migration 16).
export default function CorrectAttendance() {
  const setup = useAsyncData(fetchCorrectionSetup, 'correction-setup')
  return (
    <>
      <h1>Correct attendance</h1>
      <p className="muted">
        Fix attendance for any class and any date, including dates teachers can no longer change (older than 7 days). Each
        change is recorded in the audit log, keeping who originally marked it.
      </p>
      {setup.loading ? (
        <p className="muted">Loading…</p>
      ) : setup.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(setup.error)}</p>
      ) : setup.data.terms.length === 0 ? (
        <p className="empty-state">No terms exist yet.</p>
      ) : (
        <Picker setup={setup.data} />
      )}
    </>
  )
}

function Picker({ setup }) {
  const current = setup.terms.find((t) => t.is_current) ?? setup.terms[0]
  const [filters, setFilters] = useState({ termId: current.id, classId: '', sectionId: '' })
  const term = setup.terms.find((t) => t.id === filters.termId)

  return (
    <>
      <TermClassSectionPicker setup={setup} value={filters} onChange={setFilters} />
      {!filters.sectionId ? (
        <p className="empty-state">Choose a class and section.</p>
      ) : (
        <SlotPicker key={`${filters.termId}:${filters.sectionId}`} term={term} sectionId={filters.sectionId} />
      )}
    </>
  )
}

function slotLabel(s) {
  const teacher = s.teachers?.users ? fullName(s.teachers.users) : 'no teacher'
  return `${s.subjects.name} — ${capitalise(s.day_of_week)} ${s.periods.name} (${formatTime(s.periods.start_time)}) · ${teacher}`
}

function SlotPicker({ term, sectionId }) {
  const slotsQuery = useAsyncData(() => fetchSectionSlots(term.id, sectionId), `section-slots:${term.id}:${sectionId}`)
  const [slotId, setSlotId] = useState('')
  const [date, setDate] = useState('')

  if (slotsQuery.loading) return <p className="muted">Loading the timetable…</p>
  if (slotsQuery.error) return <p className="alert alert-error" role="alert">{friendlyDbError(slotsQuery.error)}</p>
  const slots = slotsQuery.data
  if (slots.length === 0) return <p className="empty-state">This section has no classes on the timetable for {term.name}.</p>

  const slot = slots.find((s) => s.id === slotId)
  // Every date this class met in the term, up to today (newest first).
  const dates = slot ? recentDatesOn(slot.day_of_week, term.start_date, term.end_date, 60) : []
  const chosenDate = dates.includes(date) ? date : dates[0]
  const today = toIsoDate(new Date())

  return (
    <>
      <div className="filter-bar">
        <label className="inline-field correction-slot">
          Class (subject, day, period)
          <select
            value={slotId}
            onChange={(e) => {
              setSlotId(e.target.value)
              setDate('')
            }}
          >
            <option value="">Choose a class</option>
            {slots.map((s) => (
              <option key={s.id} value={s.id}>
                {slotLabel(s)}
              </option>
            ))}
          </select>
        </label>
        {slot && dates.length > 0 && (
          <label className="inline-field">
            Date
            <select value={chosenDate} onChange={(e) => setDate(e.target.value)}>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {formatDate(d)}
                  {d === today ? ' (today)' : isEditable(d) ? '' : ' 🔒'}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!slot ? null : dates.length === 0 ? (
        <p className="empty-state">
          There is no {capitalise(slot.day_of_week)} in {term.name} up to today, so there is nothing to correct.
        </p>
      ) : (
        <>
          <p className="muted small">
            🔒 = older than 7 days: teachers can&apos;t change it any more; you&apos;ll be asked to confirm a correction.
          </p>
          <Roster key={`${slot.id}:${chosenDate}`} slot={slot} date={chosenDate} admin />
        </>
      )}
    </>
  )
}
