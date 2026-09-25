import { useState } from 'react'
import { friendlyDbError } from '../../lib/db'
import { fetchCorrectionSetup, fetchSectionSubjects } from '../../lib/corrections'
import { useAsyncData } from '../../hooks/useAsyncData'
import { GradebookForClass } from '../../components/ScoreGradebook'
import TermClassSectionPicker from '../../components/TermClassSectionPicker'

// Admins (both tiers) correct scores for ANY term, class and subject, with
// the teacher's gradebook. Saving goes through the same scores table and
// rules (maximum, components complete, student takes the subject); admins
// are only exempt from the term lock (migration 23). Every change is
// audit-logged with the old and new score and who entered it.
export default function CorrectScores() {
  const setup = useAsyncData(fetchCorrectionSetup, 'correction-setup')
  return (
    <>
      <h1>Correct scores</h1>
      <p className="muted">
        Fix scores for any class and term, including terms that are locked for teachers. Each change is recorded in the
        audit log.
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
        <SubjectPicker key={`${term.session_id}:${filters.sectionId}`} term={term} sectionId={filters.sectionId} />
      )}
    </>
  )
}

function SubjectPicker({ term, sectionId }) {
  const subjectsQuery = useAsyncData(() => fetchSectionSubjects(term.session_id, sectionId), `section-subjects:${term.session_id}:${sectionId}`)
  const [subjectId, setSubjectId] = useState('')

  if (subjectsQuery.loading) return <p className="muted">Loading subjects…</p>
  if (subjectsQuery.error) return <p className="alert alert-error" role="alert">{friendlyDbError(subjectsQuery.error)}</p>
  const subjects = subjectsQuery.data
  if (subjects.length === 0) return <p className="empty-state">No student in this section takes any subject in {term.sessions.name}.</p>

  const cls = subjectId ? { key: `${term.id}:${sectionId}:${subjectId}`, termId: term.id, sectionId, subjectId } : null
  return (
    <>
      <div className="filter-bar">
        <label className="inline-field">
          Subject
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Choose a subject</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {cls && <GradebookForClass key={cls.key} cls={cls} term={term} admin />}
    </>
  )
}
