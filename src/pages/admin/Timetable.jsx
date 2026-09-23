import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { formatTime } from '../../lib/format'
import { fullName, byName } from '../../lib/people'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'

const DAYS = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
]
const dayLabel = (value) => DAYS.find((d) => d.value === value)?.label ?? value

async function fetchSetup() {
  const [terms, classes, sections, periods, subjects, teachers] = await Promise.all([
    run(
      supabase
        .from('terms')
        .select('id, name, term_number, is_current, start_date, sessions(name)')
        .order('start_date', { ascending: false }),
    ),
    run(supabase.from('classes').select('id, name, level').order('level')),
    run(supabase.from('sections').select('id, class_id, name').order('name')),
    run(supabase.from('periods').select('id, name, start_time, end_time, is_break').order('start_time')),
    run(supabase.from('subjects').select('id, name, code').order('name')),
    run(supabase.from('teachers').select('id, users(first_name, middle_name, last_name, is_active)')),
  ])
  return {
    terms,
    classes,
    sections,
    periods,
    subjects,
    teachers: teachers
      .filter((t) => t.users.is_active)
      .map((t) => ({ id: t.id, name: fullName(t.users), ...t.users }))
      .sort(byName),
  }
}

export default function Timetable() {
  const setup = useAsyncData(fetchSetup, 'timetable-setup')

  if (setup.loading) return <p className="muted">Loading…</p>
  if (setup.error) return <p className="alert alert-error" role="alert">{friendlyDbError(setup.error)}</p>

  const { terms, sections, periods, subjects } = setup.data
  const missing = [
    terms.length === 0 && <Link key="terms" to="/admin/terms">a term</Link>,
    sections.length === 0 && <Link key="classes" to="/admin/classes">a class with a section</Link>,
    periods.length === 0 && <Link key="periods" to="/admin/periods">some periods</Link>,
    subjects.length === 0 && <Link key="subjects" to="/admin/subjects">some subjects</Link>,
  ].filter(Boolean)

  if (missing.length > 0) {
    return (
      <>
        <h1>Timetable</h1>
        <p className="empty-state">
          Before building a timetable, create{' '}
          {missing.map((item, i) => (
            <span key={item.key}>
              {i > 0 && (i === missing.length - 1 ? ' and ' : ', ')}
              {item}
            </span>
          ))}
          .
        </p>
      </>
    )
  }
  return <TimetableBuilder setup={setup.data} />
}

function TimetableBuilder({ setup }) {
  const { terms, classes, sections, periods, subjects, teachers } = setup

  // Default to the current term and the first class/section that has sections.
  const [chosenTermId, setChosenTermId] = useState(null)
  const [chosenClassId, setChosenClassId] = useState(null)
  const [chosenSectionId, setChosenSectionId] = useState(null)

  const term = terms.find((t) => t.id === chosenTermId) ?? terms.find((t) => t.is_current) ?? terms[0]
  const classesWithSections = classes.filter((c) => sections.some((s) => s.class_id === c.id))
  const cls = classesWithSections.find((c) => c.id === chosenClassId) ?? classesWithSections[0]
  const classSections = sections.filter((s) => s.class_id === cls.id)
  const section = classSections.find((s) => s.id === chosenSectionId) ?? classSections[0]

  const slotsQuery = useAsyncData(
    () =>
      run(
        supabase
          .from('timetable_slots')
          .select('id, period_id, day_of_week, subject_id, teacher_id, subjects(name, code), teachers(users(first_name, middle_name, last_name))')
          .eq('term_id', term.id)
          .eq('section_id', section.id),
      ),
    `slots:${term.id}:${section.id}`,
  )

  // Only one "+ Add class" form open at a time: `${periodId}:${day}`
  const [openCell, setOpenCell] = useState(null)

  const slots = slotsQuery.data ?? []
  const sectionLabel = `${cls.name} ${section.name}`

  return (
    <>
      <h1>Timetable</h1>
      <p className="muted">
        Choose a term and a section, then add classes to each day and period. A cell can hold several classes at once
        (parallel electives); each student attends the one matching their own subjects.
      </p>

      <div className="filter-bar">
        <label className="inline-field">
          Term
          <select
            value={term.id}
            onChange={(e) => {
              setChosenTermId(e.target.value)
              setOpenCell(null)
            }}
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}, {t.sessions.name}
                {t.is_current ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          Class
          <select
            value={cls.id}
            onChange={(e) => {
              setChosenClassId(e.target.value)
              setChosenSectionId(null)
              setOpenCell(null)
            }}
          >
            {classesWithSections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          Section
          <select
            value={section.id}
            onChange={(e) => {
              setChosenSectionId(e.target.value)
              setOpenCell(null)
            }}
          >
            {classSections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {slotsQuery.loading ? (
        <p className="muted">Loading timetable…</p>
      ) : slotsQuery.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(slotsQuery.error)}</p>
      ) : (
        <>
          <h2>
            {sectionLabel} — {term.name}, {term.sessions.name}
          </h2>
          <div className="table-wrap">
            <table className="timetable-grid">
              <thead>
                <tr>
                  <th>Period</th>
                  {DAYS.map((d) => (
                    <th key={d.value}>{d.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.id}>
                    <th scope="row" className="period-cell">
                      {period.name}
                      <span className="muted small">
                        {formatTime(period.start_time)}–{formatTime(period.end_time)}
                      </span>
                    </th>
                    {period.is_break ? (
                      <td colSpan={DAYS.length} className="break-cell">
                        Break
                      </td>
                    ) : (
                      DAYS.map((d) => {
                        const cellKey = `${period.id}:${d.value}`
                        return (
                          <TimetableCell
                            key={cellKey}
                            entries={slots.filter((s) => s.period_id === period.id && s.day_of_week === d.value)}
                            term={term}
                            section={section}
                            sectionLabel={sectionLabel}
                            period={period}
                            day={d.value}
                            subjects={subjects}
                            teachers={teachers}
                            adding={openCell === cellKey}
                            onStartAdd={() => setOpenCell(cellKey)}
                            onStopAdd={() => setOpenCell(null)}
                            onChanged={slotsQuery.reload}
                          />
                        )
                      })
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

function TimetableCell({ entries, term, section, sectionLabel, period, day, subjects, teachers, adding, onStartAdd, onStopAdd, onChanged }) {
  const sorted = [...entries].sort((a, b) => a.subjects.name.localeCompare(b.subjects.name))

  return (
    <td className={`timetable-cell${sorted.length === 0 ? ' is-empty' : ''}`}>
      {sorted.length === 0 ? (
        <span className="muted small">No class scheduled</span>
      ) : (
        <ul className="slot-chips">
          {sorted.map((slot) => {
            const teacherName = slot.teachers ? fullName(slot.teachers.users) : null
            return (
              <li key={slot.id} className="slot-chip">
                <span>
                  <strong>{slot.subjects.name}</strong> — {teacherName ?? <em>No teacher yet</em>}
                </span>
                <DeleteAction
                  itemName={`${slot.subjects.name} (${sectionLabel}, ${dayLabel(day)} ${period.name})`}
                  buttonLabel="×"
                  buttonClassName="chip-remove"
                  dependencyChecks={[
                    { table: 'attendance_records', column: 'timetable_slot_id', value: slot.id, label: ['attendance record', 'attendance records'] },
                  ]}
                  onDelete={() => runWrite(supabase.from('timetable_slots').delete().eq('id', slot.id).select('id'))}
                  onDeleted={onChanged}
                />
              </li>
            )
          })}
        </ul>
      )}
      {sorted.length > 1 && <span className="muted small parallel-note">Parallel classes</span>}

      {adding ? (
        <AddClassForm
          entries={sorted}
          term={term}
          section={section}
          sectionLabel={sectionLabel}
          period={period}
          day={day}
          subjects={subjects}
          teachers={teachers}
          onSaved={() => {
            onStopAdd()
            onChanged()
          }}
          onCancel={onStopAdd}
        />
      ) : (
        <button type="button" className="button-link add-class" onClick={onStartAdd}>
          + Add class
        </button>
      )}
    </td>
  )
}

function AddClassForm({ entries, term, section, sectionLabel, period, day, subjects, teachers, onSaved, onCancel }) {
  const [subjectId, setSubjectId] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const usedSubjectIds = entries.map((e) => e.subject_id)
  const when = `${dayLabel(day)}, ${period.name}`

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    const subject = subjects.find((s) => s.id === subjectId)
    const teacher = teachers.find((t) => t.id === teacherId)

    // Rule 1: the same subject can't be in the same cell twice.
    if (usedSubjectIds.includes(subjectId)) {
      setError(`${subject.name} is already scheduled for ${sectionLabel} on ${when}.`)
      return
    }

    setSaving(true)
    try {
      // Rule 2: a teacher can't be in two places at once, checked across ALL
      // sections for this term, day and period.
      if (teacher) {
        const clashes = await run(
          supabase
            .from('timetable_slots')
            .select('id, section_id, subjects(name), sections(name, classes(name))')
            .eq('term_id', term.id)
            .eq('day_of_week', day)
            .eq('period_id', period.id)
            .eq('teacher_id', teacher.id),
        )
        if (clashes.length > 0) {
          const clash = clashes[0]
          const where =
            clash.section_id === section.id
              ? `this section (${sectionLabel})`
              : `${clash.sections.classes.name} ${clash.sections.name}`
          setError(
            `${teacher.name} is already teaching ${clash.subjects.name} to ${where} on ${when}. A teacher can't be in two classes at the same time.`,
          )
          return
        }
      }

      await run(
        supabase.from('timetable_slots').insert({
          term_id: term.id,
          section_id: section.id,
          period_id: period.id,
          day_of_week: day,
          subject_id: subjectId,
          teacher_id: teacherId || null,
        }),
      )
      onSaved()
    } catch (err) {
      setError(slotErrorMessage(err, { subject, teacher, sectionLabel, when }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="add-class-form" onSubmit={handleSubmit}>
      <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="Subject" required autoFocus>
        <option value="">Subject…</option>
        {subjects.map((s) => (
          <option key={s.id} value={s.id} disabled={usedSubjectIds.includes(s.id)}>
            {s.name}
            {usedSubjectIds.includes(s.id) ? ' (already here)' : ''}
          </option>
        ))}
      </select>
      <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} aria-label="Teacher">
        <option value="">No teacher yet</option>
        {teachers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="button-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// Database-level backstops, e.g. if two admins edit at the same moment.
function slotErrorMessage(err, { subject, teacher, sectionLabel, when }) {
  const text = err?.message ?? ''
  if (err?.code === '23505') {
    if (text.includes('timetable_slots_one_subject_per_cell')) {
      return `${subject?.name ?? 'That subject'} is already scheduled for ${sectionLabel} on ${when}.`
    }
    if (text.includes('teacher_id_term_id_day_of_week_period_id')) {
      return `${teacher?.name ?? 'That teacher'} was just booked for another class on ${when}. Refresh the page to see where.`
    }
    if (text.includes('timetable_slots_section_id_term_id_day_of_week_period_id_key')) {
      return "The database setup is incomplete — migration 011 (parallel classes) hasn't been applied, so only one class per cell is allowed."
    }
  }
  return friendlyDbError(err)
}
