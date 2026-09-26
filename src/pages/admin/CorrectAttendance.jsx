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
import { Alert, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, Select } from '../../components/ui/Form'

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
      <PageHeader
        title="Correct attendance"
        subtitle="Fix attendance for any class and any date, including dates teachers can no longer change (older than 7 days). Each change is recorded in the audit log, keeping who originally marked it."
      />
      {setup.loading ? (
        <LoadingState lines={4} />
      ) : setup.error ? (
        <Alert tone="danger">{friendlyDbError(setup.error)}</Alert>
      ) : setup.data.terms.length === 0 ? (
        <Card>
          <EmptyState icon="calendar">No terms exist yet.</EmptyState>
        </Card>
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
        <Card>
          <EmptyState icon="check">Choose a class and section.</EmptyState>
        </Card>
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

  if (slotsQuery.loading) return <LoadingState lines={3} label="Loading the timetable…" />
  if (slotsQuery.error) return <Alert tone="danger">{friendlyDbError(slotsQuery.error)}</Alert>
  const slots = slotsQuery.data
  if (slots.length === 0) {
    return (
      <Card>
        <EmptyState icon="calendar">This section has no classes on the timetable for {term.name}.</EmptyState>
      </Card>
    )
  }
  const slot = slots.find((s) => s.id === slotId)
  // Every date this class met in the term, up to today (newest first).
  const dates = slot ? recentDatesOn(slot.day_of_week, term.start_date, term.end_date, 60) : []
  const chosenDate = dates.includes(date) ? date : dates[0]
  const today = toIsoDate(new Date())

  return (
    <>
      <div className="ds-filters">
        <Field label="Class (subject, day, period)">
          {(p) => (
            <Select
              {...p}
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
            </Select>
          )}
        </Field>
        {slot && dates.length > 0 && (
          <Field label="Date" hint="🔒 = older than 7 days: teachers can't change it any more; you'll be asked to confirm a correction.">
            {(p) => (
              <Select {...p} value={chosenDate} onChange={(e) => setDate(e.target.value)}>
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {formatDate(d)}
                    {d === today ? ' (today)' : isEditable(d) ? '' : ' 🔒'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
      {!slot ? null : dates.length === 0 ? (
        <Card>
          <EmptyState icon="calendar">
            There is no {capitalise(slot.day_of_week)} in {term.name} up to today, so there is nothing to correct.
          </EmptyState>
        </Card>
      ) : (
        <Card title={`${slot.subjects.name} · ${formatDate(chosenDate)}`}>
          <Roster key={`${slot.id}:${chosenDate}`} slot={slot} date={chosenDate} admin />
        </Card>
      )}
    </>
  )
}
