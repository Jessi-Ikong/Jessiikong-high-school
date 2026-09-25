import { useState } from 'react'
import { friendlyDbError } from '../../lib/db'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'
import { fetchTeacherClasses } from '../../lib/teacherClasses'
import { GradebookForClass } from '../../components/ScoreGradebook'

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
