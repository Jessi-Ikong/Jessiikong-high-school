import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { fullName, byName } from '../../lib/people'
import { weightTotal, weightedTotal } from '../../lib/grading'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'

// The teacher's classes (subject + section) in each term of the CURRENT session.
async function fetchTeacherClasses(userId) {
  const teacher = await run(supabase.from('teachers').select('id').eq('user_id', userId).maybeSingle())
  if (!teacher) return { problem: 'no-teacher' }
  const terms = await run(
    supabase
      .from('terms')
      .select('id, name, term_number, is_current, session_id, sessions!inner(name, is_current)')
      .eq('sessions.is_current', true)
      .order('term_number'),
  )
  if (terms.length === 0) return { problem: 'no-session' }
  const slots = await run(
    supabase
      .from('timetable_slots')
      .select('term_id, section_id, subject_id, subjects(name), sections(name, classes(name, level))')
      .eq('teacher_id', teacher.id)
      .in('term_id', terms.map((t) => t.id)),
  )
  // One entry per term + section + subject (a class can meet several times a week).
  const classes = new Map()
  for (const s of slots) {
    const key = `${s.term_id}:${s.section_id}:${s.subject_id}`
    if (!classes.has(key)) {
      classes.set(key, {
        key,
        termId: s.term_id,
        sectionId: s.section_id,
        subjectId: s.subject_id,
        label: `${s.subjects.name} — ${s.sections.classes.name} ${s.sections.name}`,
        order: `${String(s.sections.classes.level).padStart(3, '0')}${s.sections.name}${s.subjects.name}`,
      })
    }
  }
  return { terms, classes: [...classes.values()].sort((a, b) => a.order.localeCompare(b.order)) }
}

// Components, students who TAKE the subject in that section (same rule as
// attendance), and their saved scores.
async function fetchGradebook(cls, term) {
  const [components, enrollments] = await Promise.all([
    run(
      supabase
        .from('assessment_components')
        .select('id, name, max_score, weight, sort_order')
        .eq('term_id', cls.termId)
        .eq('subject_id', cls.subjectId)
        .order('sort_order')
        .order('name'),
    ),
    run(
      supabase
        .from('enrollments')
        .select('id, student_id, students(admission_number, users(first_name, middle_name, last_name)), student_subjects!inner(subject_id)')
        .eq('section_id', cls.sectionId)
        .eq('session_id', term.session_id)
        .eq('status', 'active')
        .eq('student_subjects.subject_id', cls.subjectId),
    ),
  ])
  const students = enrollments
    .map((e) => ({ studentId: e.student_id, admissionNumber: e.students.admission_number, ...e.students.users }))
    .sort(byName)
  const scores = students.length
    ? await run(
        supabase
          .from('scores')
          .select('student_id, component_id, score_obtained')
          .eq('term_id', cls.termId)
          .eq('subject_id', cls.subjectId)
          .in('student_id', students.map((s) => s.studentId)),
      )
    : []
  const saved = Object.fromEntries(scores.map((s) => [`${s.student_id}:${s.component_id}`, String(Number(s.score_obtained))]))
  return { components, students, saved }
}

export default function Gradebook() {
  const { profile } = useAuth()
  const classesQuery = useAsyncData(() => fetchTeacherClasses(profile.id), `teacher-classes:${profile.id}`)

  if (classesQuery.loading) return <p className="muted">Loading your classes…</p>
  if (classesQuery.error) return <p className="alert alert-error" role="alert">{friendlyDbError(classesQuery.error)}</p>

  const data = classesQuery.data
  return (
    <>
      <h1>Gradebook</h1>
      {data.problem === 'no-teacher' ? (
        <p className="alert alert-error" role="alert">
          Your account isn&apos;t set up as a teacher record yet. Please contact the school office.
        </p>
      ) : data.problem === 'no-session' ? (
        <p className="empty-state">No session is marked as current yet, so there are no classes to grade.</p>
      ) : (
        <GradebookPicker terms={data.terms} classes={data.classes} />
      )}
    </>
  )
}

function GradebookPicker({ terms, classes }) {
  const [chosenTermId, setChosenTermId] = useState(null)
  const [chosenKey, setChosenKey] = useState(null)
  const term = terms.find((t) => t.id === chosenTermId) ?? terms.find((t) => t.is_current) ?? terms[0]
  const termClasses = classes.filter((c) => c.termId === term.id)
  const cls = termClasses.find((c) => c.key === chosenKey) ?? termClasses[0]

  return (
    <>
      <p className="muted">
        Enter scores for the classes you teach this session ({term.sessions.name}). Only students who take the subject
        are listed.
      </p>
      <div className="filter-bar">
        <label className="inline-field">
          Term
          <select value={term.id} onChange={(e) => setChosenTermId(e.target.value)}>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.is_current ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
        {termClasses.length > 0 && (
          <label className="inline-field">
            Class
            <select value={cls.key} onChange={(e) => setChosenKey(e.target.value)}>
              {termClasses.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {termClasses.length === 0 ? (
        <p className="empty-state">You have no classes on the timetable for {term.name}.</p>
      ) : (
        <GradebookForClass key={cls.key} cls={cls} term={term} />
      )}
    </>
  )
}

function GradebookForClass({ cls, term }) {
  const query = useAsyncData(() => fetchGradebook(cls, term), `gradebook:${cls.key}`)
  const [savedMessage, setSavedMessage] = useState(null)

  if (query.loading) return <p className="muted">Loading gradebook…</p>
  if (query.error) return <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>

  const { components, students, saved } = query.data
  const total = weightTotal(components)

  if (total !== 100) {
    return (
      <p className="alert alert-error" role="alert">
        Grading isn&apos;t fully configured for this subject yet — ask an admin to complete the assessment components.
        <span className="small">
          {' '}
          ({components.length === 0 ? 'No components are set up' : `Components currently add up to ${total}%, not 100%`} for{' '}
          {term.name}.)
        </span>
      </p>
    )
  }
  if (students.length === 0) {
    return <p className="empty-state">No students in this section take this subject this session.</p>
  }

  return (
    <ScoreGrid
      key={JSON.stringify(saved)}
      cls={cls}
      components={components}
      students={students}
      saved={saved}
      savedMessage={savedMessage}
      onSaved={(message) => {
        setSavedMessage(message)
        query.reload()
      }}
      onEdit={() => setSavedMessage(null)}
    />
  )
}

function ScoreGrid({ cls, components, students, saved, savedMessage, onSaved, onEdit }) {
  const [values, setValues] = useState(() => ({ ...saved }))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const cellKey = (studentId, componentId) => `${studentId}:${componentId}`

  // Problem with a cell, or null if it's fine (blank is fine unless it was saved before).
  function cellProblem(studentId, component) {
    const key = cellKey(studentId, component.id)
    const raw = (values[key] ?? '').trim()
    if (raw === '') return saved[key] !== undefined ? 'cleared' : null
    const n = Number(raw)
    if (Number.isNaN(n)) return 'not a number'
    if (n < 0) return 'below 0'
    if (n > Number(component.max_score)) return `above ${Number(component.max_score)}`
    return null
  }

  const changed = []
  const problems = []
  for (const s of students) {
    for (const c of components) {
      const key = cellKey(s.studentId, c.id)
      const raw = (values[key] ?? '').trim()
      if (raw === (saved[key] ?? '')) continue
      const problem = cellProblem(s.studentId, c)
      if (problem) problems.push(`${fullName(s)} – ${c.name}: ${problem === 'cleared' ? "a saved score can't be cleared (ask an admin)" : problem}`)
      else changed.push({ student: s, component: c, value: Number(raw) })
    }
  }

  function setValue(studentId, componentId, value) {
    setValues((prev) => ({ ...prev, [cellKey(studentId, componentId)]: value }))
    setError(null)
    onEdit()
  }

  async function handleSave(event) {
    event.preventDefault()
    setError(null)
    if (problems.length > 0) {
      setError(`Fix these before saving: ${problems.join('; ')}.`)
      return
    }
    if (changed.length === 0) {
      setError('Nothing has changed.')
      return
    }
    setSaving(true)
    try {
      // One row per student per component: saving again updates it.
      await run(
        supabase.from('scores').upsert(
          changed.map((c) => ({
            student_id: c.student.studentId,
            subject_id: cls.subjectId,
            term_id: cls.termId,
            component_id: c.component.id,
            score_obtained: c.value,
          })),
          { onConflict: 'student_id,component_id' },
        ),
      )
      onSaved(`Saved ${changed.length} ${changed.length === 1 ? 'score' : 'scores'}.`)
    } catch (err) {
      setError(friendlyDbError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave}>
      {savedMessage && <p className="alert alert-success" role="status">{savedMessage}</p>}
      <div className="table-wrap">
        <table className="data-table gradebook">
          <thead>
            <tr>
              <th>Student</th>
              {components.map((c) => (
                <th key={c.id}>
                  {c.name}
                  <span className="muted small">
                    {' '}
                    / {Number(c.max_score)} · {Number(c.weight)}%
                  </span>
                </th>
              ))}
              <th>Total / 100</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const anyScore = components.some((c) => (values[cellKey(s.studentId, c.id)] ?? '').trim() !== '')
              const total = weightedTotal(components, (componentId) => {
                const raw = (values[cellKey(s.studentId, componentId)] ?? '').trim()
                return raw === '' || Number.isNaN(Number(raw)) ? null : raw
              })
              return (
                <tr key={s.studentId}>
                  <td>
                    {fullName(s)} <span className="muted small">{s.admissionNumber}</span>
                  </td>
                  {components.map((c) => {
                    const key = cellKey(s.studentId, c.id)
                    const problem = cellProblem(s.studentId, c)
                    return (
                      <td key={c.id}>
                        <input
                          className={`score-input${problem ? ' has-error' : ''}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max={Number(c.max_score)}
                          step="any"
                          value={values[key] ?? ''}
                          onChange={(e) => setValue(s.studentId, c.id, e.target.value)}
                          aria-label={`${c.name} for ${fullName(s)} (max ${Number(c.max_score)})`}
                          aria-invalid={problem ? 'true' : undefined}
                          title={problem ? `Must be between 0 and ${Number(c.max_score)}` : undefined}
                        />
                      </td>
                    )
                  })}
                  <td className="total-cell">{anyScore ? total.toFixed(1) : <span className="muted">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Total = each score divided by its maximum, times its weight, added up. Blank scores count as 0, so the total
        grows as more components are entered.
      </p>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : `Save scores${changed.length ? ` (${changed.length} changed)` : ''}`}
        </button>
      </div>
    </form>
  )
}
