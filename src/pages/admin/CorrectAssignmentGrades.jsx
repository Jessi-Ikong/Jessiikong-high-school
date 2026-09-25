import { useState } from 'react'
import { friendlyDbError } from '../../lib/db'
import { fullName } from '../../lib/people'
import { formatDateTime, formatMark } from '../../lib/assignments'
import { termGradingOpen, termGradingLastDay } from '../../lib/grading'
import { formatDate } from '../../lib/format'
import { fetchAssignmentGrading, fetchCorrectionSetup, fetchTermAssignments } from '../../lib/corrections'
import { useAsyncData } from '../../hooks/useAsyncData'
import { SubmissionsTable } from '../../components/AssignmentGrading'
import { FileLink } from '../../components/SubmissionBadges'
import TermClassSectionPicker from '../../components/TermClassSectionPicker'

// Admins (both tiers) grade, or correct grades for, ANY assignment (any
// teacher, term or class), with the teacher's grading table: hand-in work
// through its submissions, offline work directly from the roster. Saving
// goes through the same submissions table and rules (mark not above the
// maximum; offline grades only for students who take the subject there);
// admins are only exempt from the term lock (migrations 23-25, 39). The
// admin is recorded as the grader and every change is audit-logged.
export default function CorrectAssignmentGrades() {
  const setup = useAsyncData(fetchCorrectionSetup, 'correction-setup')
  return (
    <>
      <h1>Correct assignment grades</h1>
      <p className="muted">
        Grade or fix marks for any assignment, including terms that are locked for teachers. Each change is recorded in
        the audit log.
      </p>
      {setup.loading ? (
        <p className="muted">Loading…</p>
      ) : setup.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(setup.error)}</p>
      ) : setup.data.terms.length === 0 ? (
        <p className="empty-state">No terms exist yet.</p>
      ) : (
        <Browser setup={setup.data} />
      )}
    </>
  )
}

function Browser({ setup }) {
  const current = setup.terms.find((t) => t.is_current) ?? setup.terms[0]
  const [filters, setFilters] = useState({ termId: current.id, classId: '', sectionId: '' })
  const term = setup.terms.find((t) => t.id === filters.termId)
  const query = useAsyncData(
    () => fetchTermAssignments(filters.termId, filters.classId, filters.sectionId),
    `term-assignments:${filters.termId}:${filters.classId}:${filters.sectionId}`,
  )
  const [openId, setOpenId] = useState(null)
  const locked = !termGradingOpen(term)

  return (
    <>
      <TermClassSectionPicker setup={setup} value={filters} onChange={setFilters} allowAll />
      {locked && (
        <p className="alert alert-info-plain">
          🔒 {term.name} ({term.sessions.name}) is locked for teachers since {formatDate(termGradingLastDay(term))}. As an admin
          you can still grade and correct; you&apos;ll be asked to confirm each change.
        </p>
      )}
      {query.loading ? (
        <p className="muted">Loading assignments…</p>
      ) : query.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
      ) : query.data.length === 0 ? (
        <p className="empty-state">No assignments match these filters.</p>
      ) : (
        <div className="assignment-list">
          {query.data.map((a) => {
            const isOpen = openId === a.id
            const records = a.submissions?.[0]?.count ?? 0
            return (
              <article key={a.id} className="panel assignment-card">
                <header className="assignment-card-header">
                  <div>
                    <h3>
                      {a.title}
                      {!a.requires_submission && <span className="badge badge-muted">Offline work</span>}
                    </h3>
                    <p className="muted small">
                      {a.subjects.name} — {a.sections.classes.name} {a.sections.name} · set by{' '}
                      {a.teachers?.users ? fullName(a.teachers.users) : 'a former teacher'} · Due{' '}
                      {a.due_at ? formatDateTime(a.due_at) : '(no due date)'} · Out of {formatMark(a.max_score) || '—'}
                    </p>
                  </div>
                  <div className="submission-count">
                    <strong>{records}</strong> {a.requires_submission ? (records === 1 ? 'submission' : 'submissions') : records === 1 ? 'grade' : 'grades'}
                  </div>
                </header>
                <div className="row-actions">
                  <button type="button" className="button-secondary" onClick={() => setOpenId(isOpen ? null : a.id)}>
                    {isOpen ? 'Close' : a.requires_submission ? 'View and grade submissions' : 'Grade students'}
                  </button>
                </div>
                {isOpen && <Grading assignment={a} term={term} locked={locked} onChanged={query.reload} />}
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}

function Grading({ assignment, term, locked, onChanged }) {
  const query = useAsyncData(() => fetchAssignmentGrading(assignment, term.session_id), `assignment-grading:${assignment.id}`)
  if (query.loading) return <p className="muted">Loading students…</p>
  if (query.error) return <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
  const { students, submissions, urls } = query.data
  // Only students who take the subject there (same roster as the teacher's).
  const rosterIds = new Set(students.map((s) => s.studentId))
  return (
    <>
      {assignment.description && <p className="assignment-description">{assignment.description}</p>}
      {assignment.attachment_url && (
        <p>
          <FileLink path={assignment.attachment_url} urls={urls} />
        </p>
      )}
      <SubmissionsTable
        assignment={assignment}
        students={students}
        submissions={submissions.filter((s) => rosterIds.has(s.student_id))}
        urls={urls}
        locked={locked}
        admin
        lockedExplanation={`"${assignment.title}" is in ${term.name}, which is locked for teachers.`}
        onGraded={() => {
          query.reload()
          onChanged()
        }}
      />
    </>
  )
}
