import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { friendlyDbError, run } from '../lib/db'
import { fullName, byName } from '../lib/people'
import { gradeFor, termGradingOpen, termLockedMessage, weightTotal, weightedTotal } from '../lib/grading'
import { useAsyncData } from '../hooks/useAsyncData'
import { useCorrectionConfirm } from './CorrectionConfirm'

// The score grid, shared by the teacher's Gradebook and the admin's Correct
// Scores page. Both save through the same scores table and rules (maximum,
// components complete, student takes the subject; the term lock applies to
// teachers only), and the generic audit trigger logs every change.
// cls: { key, termId, sectionId, subjectId }; term: { name, end_date, session_id }

// Components, students who TAKE the subject in that section (same rule as
// attendance), and their saved scores.
// Students who take the subject in the section that session. Teachers: active
// enrollments. Admins (anyStatus): every status, so past sessions (promoted /
// graduated) and students who have since left can be corrected.
function enrollmentsQuery(cls, term, anyStatus) {
  const query = supabase
    .from('enrollments')
    .select('id, student_id, status, students(admission_number, users(first_name, middle_name, last_name)), student_subjects!inner(subject_id)')
    .eq('section_id', cls.sectionId)
    .eq('session_id', term.session_id)
    .eq('student_subjects.subject_id', cls.subjectId)
  return anyStatus ? query : query.eq('status', 'active')
}

async function fetchGradebook(cls, term, anyStatus) {
  const [components, enrollments, scale] = await Promise.all([
    run(
      supabase
        .from('assessment_components')
        .select('id, name, max_score, weight, sort_order')
        .eq('term_id', cls.termId)
        .eq('subject_id', cls.subjectId)
        .order('sort_order')
        .order('name'),
    ),
    run(enrollmentsQuery(cls, term, anyStatus)),
    run(supabase.from('grading_scale').select('grade, min_score, max_score, remark')),
  ])
  const students = enrollments
    .map((e) => ({ studentId: e.student_id, enrollmentStatus: e.status, admissionNumber: e.students.admission_number, ...e.students.users }))
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
  return { components, students, saved, scale }
}

// admin: correcting (locked terms stay editable, with a confirmation; a saved
// score can be cleared; students who are no longer active are listed too).
export function GradebookForClass({ cls, term, admin = false }) {
  const query = useAsyncData(() => fetchGradebook(cls, term, admin), `gradebook:${admin}:${cls.key}`)
  const [savedMessage, setSavedMessage] = useState(null)

  if (query.loading) return <p className="muted">Loading gradebook…</p>
  if (query.error) return <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>

  const { components, students, saved, scale } = query.data
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

  const locked = !termGradingOpen(term)
  return (
    <>
      {locked && !admin && <p className="alert alert-info-plain">🔒 {termLockedMessage(term, 'Scores')}</p>}
      {locked && admin && (
        <p className="alert alert-info-plain">
          🔒 {term.name} is locked for teachers. As an admin you can still correct scores; you&apos;ll be asked to confirm.
        </p>
      )}
      <ScoreGrid
        key={JSON.stringify(saved)}
        cls={cls}
        term={term}
        admin={admin}
        locked={locked}
        components={components}
        students={students}
        saved={saved}
        scale={scale}
        savedMessage={savedMessage}
        onSaved={(message) => {
          setSavedMessage(message)
          query.reload()
        }}
        onEdit={() => setSavedMessage(null)}
      />
    </>
  )
}

function ScoreGrid({ cls, term, admin, locked, components, students, saved, scale, savedMessage, onSaved, onEdit }) {
  const [values, setValues] = useState(() => ({ ...saved }))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const confirm = useCorrectionConfirm()
  const editable = admin || !locked

  const cellKey = (studentId, componentId) => `${studentId}:${componentId}`

  // Problem with a cell, or null if it's fine (blank is fine unless it was saved before).
  function cellProblem(studentId, component) {
    const key = cellKey(studentId, component.id)
    const raw = (values[key] ?? '').trim()
    if (raw === '') return saved[key] !== undefined && !admin ? 'cleared' : null
    const n = Number(raw)
    if (Number.isNaN(n)) return 'not a number'
    if (n < 0) return 'below 0'
    if (n > Number(component.max_score)) return `above ${Number(component.max_score)}`
    return null
  }

  const changed = []
  const cleared = [] // admins only: saved scores emptied -> deleted
  const problems = []
  for (const s of students) {
    for (const c of components) {
      const key = cellKey(s.studentId, c.id)
      const raw = (values[key] ?? '').trim()
      if (raw === (saved[key] ?? '')) continue
      const problem = cellProblem(s.studentId, c)
      if (!problem && raw === '') cleared.push({ student: s, component: c })
      else if (problem) problems.push(`${fullName(s)} – ${c.name}: ${problem === 'cleared' ? "a saved score can't be cleared (ask an admin)" : problem}`)
      else changed.push({ student: s, component: c, value: Number(raw) })
    }
  }

  function setValue(studentId, componentId, value) {
    setValues((prev) => ({ ...prev, [cellKey(studentId, componentId)]: value }))
    setError(null)
    onEdit()
  }

  const total = changed.length + cleared.length

  async function save() {
    setSaving(true)
    try {
      // One row per student per component: saving again updates it.
      if (changed.length > 0) {
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
      }
      for (const c of cleared) {
        await run(supabase.from('scores').delete().eq('student_id', c.student.studentId).eq('component_id', c.component.id))
      }
      onSaved(`Saved ${changed.length} ${changed.length === 1 ? 'score' : 'scores'}${cleared.length ? `, cleared ${cleared.length}` : ''}.`)
    } catch (err) {
      setError(friendlyDbError(err))
    } finally {
      setSaving(false)
    }
  }

  function handleSave(event) {
    event.preventDefault()
    setError(null)
    if (problems.length > 0) {
      setError(`Fix these before saving: ${problems.join('; ')}.`)
      return
    }
    if (total === 0) {
      setError('Nothing has changed.')
      return
    }
    confirm.run(
      admin && locked,
      `${term.name} is locked for teachers (it ended more than 7 days ago). You are about to change ${total} ${total === 1 ? 'score' : 'scores'}${cleared.length ? ` (${cleared.length} cleared)` : ''}.`,
      save,
    )
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
              <th>Grade</th>
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
                    {admin && s.enrollmentStatus !== 'active' && <span className="badge badge-muted">{s.enrollmentStatus}</span>}
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
                          disabled={!editable}
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
                  <td className="grade-cell">{anyScore ? (gradeFor(total, scale)?.grade ?? '—') : <span className="muted">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Total = each score divided by its maximum, times its weight, added up. Blank scores count as 0, so the total
        (and the grade) grows as more components are entered. The grade uses the school's grade scale, with the total
        rounded to the nearest whole number.
      </p>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {admin && <p className="muted small">To clear a saved score, empty its box and save.</p>}
      {editable && (
        <div className="form-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : `${admin ? 'Save corrections' : 'Save scores'}${total ? ` (${total} changed)` : ''}`}
          </button>
        </div>
      )}
      {confirm.dialog}
    </form>
  )
}
