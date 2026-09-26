import { useState } from 'react'
import { friendlyDbError } from '../../lib/db'
import { fetchCorrectionSetup, fetchSectionSubjects } from '../../lib/corrections'
import { useAsyncData } from '../../hooks/useAsyncData'
import { GradebookForClass } from '../../components/ScoreGradebook'
import TermClassSectionPicker from '../../components/TermClassSectionPicker'
import { Alert, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, Select } from '../../components/ui/Form'

// Admins (both tiers) correct scores for ANY term, class and subject, with
// the teacher's gradebook. Saving goes through the same scores table and
// rules (maximum, components complete, student takes the subject); admins
// are only exempt from the term lock (migration 23). Every change is
// audit-logged with the old and new score and who entered it.
export default function CorrectScores() {
  const setup = useAsyncData(fetchCorrectionSetup, 'correction-setup')
  return (
    <>
      <PageHeader
        title="Correct scores"
        subtitle="Fix scores for any class and term, including terms that are locked for teachers. Each change is recorded in the audit log."
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
          <EmptyState icon="edit">Choose a class and section.</EmptyState>
        </Card>
      ) : (
        <SubjectPicker key={`${term.session_id}:${filters.sectionId}`} term={term} sectionId={filters.sectionId} />
      )}
    </>
  )
}

function SubjectPicker({ term, sectionId }) {
  const subjectsQuery = useAsyncData(() => fetchSectionSubjects(term.session_id, sectionId), `section-subjects:${term.session_id}:${sectionId}`)
  const [subjectId, setSubjectId] = useState('')

  if (subjectsQuery.loading) return <LoadingState lines={3} label="Loading subjects…" />
  if (subjectsQuery.error) return <Alert tone="danger">{friendlyDbError(subjectsQuery.error)}</Alert>
  const subjects = subjectsQuery.data
  if (subjects.length === 0) {
    return (
      <Card>
        <EmptyState icon="book">No student in this section takes any subject in {term.sessions.name}.</EmptyState>
      </Card>
    )
  }

  const cls = subjectId ? { key: `${term.id}:${sectionId}:${subjectId}`, termId: term.id, sectionId, subjectId } : null
  return (
    <>
      <div className="ds-filters">
        <Field label="Subject">
          {(p) => (
            <Select {...p} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Choose a subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {cls && (
        <Card title={subjects.find((s) => s.id === subjectId)?.name ?? 'Scores'}>
          <GradebookForClass key={cls.key} cls={cls} term={term} admin />
        </Card>
      )}
    </>
  )
}
