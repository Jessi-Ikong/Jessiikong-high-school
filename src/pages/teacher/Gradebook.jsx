import { useState } from 'react'
import { friendlyDbError } from '../../lib/db'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'
import { fetchTeacherClasses } from '../../lib/teacherClasses'
import { GradebookForClass } from '../../components/ScoreGradebook'
import { Alert, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, Select } from '../../components/ui/Form'

export default function Gradebook() {
  const { profile } = useAuth()
  const classesQuery = useAsyncData(() => fetchTeacherClasses(profile.id), `teacher-classes:${profile.id}`)

  if (classesQuery.loading) return <LoadingState lines={5} label="Loading your classes…" />
  if (classesQuery.error) return <Alert tone="danger">{friendlyDbError(classesQuery.error)}</Alert>

  const data = classesQuery.data
  return (
    <>
      {data.problem === 'no-teacher' ? (
        <>
          <PageHeader title="Gradebook" />
          <Alert tone="danger">Your account isn&apos;t set up as a teacher record yet. Please contact the school office.</Alert>
        </>
      ) : data.problem === 'no-session' ? (
        <>
          <PageHeader title="Gradebook" />
          <Card>
            <EmptyState icon="calendar">No session is marked as current yet, so there are no classes to grade.</EmptyState>
          </Card>
        </>
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
      <PageHeader
        title="Gradebook"
        subtitle={`Enter scores for the classes you teach this session (${term.sessions.name}). Only students who take the subject are listed.`}
      />
      <div className="ds-filters">
        <Field label="Term">
          {(p) => (
            <Select {...p} value={term.id} onChange={(e) => setChosenTermId(e.target.value)}>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.is_current ? ' (current)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {termClasses.length > 0 && (
          <Field label="Class">
            {(p) => (
              <Select {...p} value={cls.key} onChange={(e) => setChosenKey(e.target.value)}>
                {termClasses.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
      {termClasses.length === 0 ? (
        <Card>
          <EmptyState icon="chart">You have no classes on the timetable for {term.name}.</EmptyState>
        </Card>
      ) : (
        <Card title={cls.label}>
          <GradebookForClass key={cls.key} cls={cls} term={term} />
        </Card>
      )}
    </>
  )
}
