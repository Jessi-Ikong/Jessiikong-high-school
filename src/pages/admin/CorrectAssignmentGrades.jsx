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
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'

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
      <PageHeader
        title="Correct assignment grades"
        subtitle="Grade or fix marks for any assignment, including terms that are locked for teachers. Each change is recorded in the audit log."
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
        <Alert tone="info">
          🔒 {term.name} ({term.sessions.name}) is locked for teachers since {formatDate(termGradingLastDay(term))}. As an admin you can still grade and
          correct; you&apos;ll be asked to confirm each change.
        </Alert>
      )}
      {query.loading ? (
        <LoadingState lines={4} label="Loading assignments…" />
      ) : query.error ? (
        <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
      ) : query.data.length === 0 ? (
        <Card>
          <EmptyState icon="file">No assignments match these filters.</EmptyState>
        </Card>
      ) : (
        query.data.map((a) => {
          const isOpen = openId === a.id
          const records = a.submissions?.[0]?.count ?? 0
          return (
            <Card
              key={a.id}
              title={
                <span className="ds-inline">
                  {a.title}
                  {!a.requires_submission && <Badge tone="neutral">Offline work</Badge>}
                </span>
              }
              action={
                <span className="ds-muted ds-small" style={{ whiteSpace: 'nowrap' }}>
                  <strong>{records}</strong>{' '}
                  {a.requires_submission ? (records === 1 ? 'submission' : 'submissions') : records === 1 ? 'grade' : 'grades'}
                </span>
              }
            >
              <p className="ds-note">
                {a.subjects.name} — {a.sections.classes.name} {a.sections.name} · set by {a.teachers?.users ? fullName(a.teachers.users) : 'a former teacher'} ·
                Due {a.due_at ? formatDateTime(a.due_at) : '(no due date)'} · Out of {formatMark(a.max_score) || '—'}
              </p>
              <Button variant="secondary" onClick={() => setOpenId(isOpen ? null : a.id)}>
                {isOpen ? 'Close' : a.requires_submission ? 'View and grade submissions' : 'Grade students'}
              </Button>
              {isOpen && (
                <div style={{ marginTop: 16 }}>
                  <Grading assignment={a} term={term} locked={locked} onChanged={query.reload} />
                </div>
              )}
            </Card>
          )
        })
      )}
    </>
  )
}

function Grading({ assignment, term, locked, onChanged }) {
  const query = useAsyncData(() => fetchAssignmentGrading(assignment, term.session_id), `assignment-grading:${assignment.id}`)
  if (query.loading) return <LoadingState lines={3} label="Loading students…" />
  if (query.error) return <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
  const { students, submissions, urls } = query.data
  // Only students who take the subject there (same roster as the teacher's).
  const rosterIds = new Set(students.map((s) => s.studentId))
  return (
    <>
      {assignment.description && <p className="ds-pre ds-small">{assignment.description}</p>}
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
