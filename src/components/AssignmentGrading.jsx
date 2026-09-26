import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../lib/db'
import { fullName } from '../lib/people'
import { formatDateTime, formatMark, submissionStatus } from '../lib/assignments'
import { FileLink, SubmissionBadges } from './SubmissionBadges'
import { useCorrectionConfirm } from './CorrectionConfirm'
import { Alert, Badge, Button, Card, EmptyState } from './ui/Primitives'
import DataTable from './ui/DataTable'

// Grading an assignment's submissions (or, for offline work, the roster
// directly), shared by the teacher's Assignments page and the admin's Correct
// Assignment Grades page. Both save through the same submissions table and
// rules; the term lock applies to teachers only, and the generic audit
// trigger logs every change (old and new mark, who graded).

// admin: correcting (grades stay editable after the term lock, with a
// confirmation; students who are no longer active are listed too).
// lockedExplanation: shown in that confirmation.
export function SubmissionsTable({ assignment, students, submissions, urls, locked, onGraded, admin = false, lockedExplanation }) {
  if (students.length === 0) {
    return (
      <Card>
        <EmptyState icon="users">No students in this section take this subject this session.</EmptyState>
      </Card>
    )
  }
  const byStudent = Object.fromEntries(submissions.map((s) => [s.student_id, s]))
  const offline = !assignment.requires_submission
  const subOf = (student) => byStudent[student.studentId]
  // Each student is a card on phones (the grade form stacked under its label); a table when there's room.
  return (
    <DataTable
      caption={`Submissions for ${assignment.title}`}
      rowKey={(student) => student.studentId}
      rows={students}
      columns={[
        {
          key: 'student',
          header: 'Student',
          primary: true,
          render: (student) => (
            <span>
              {fullName(student)} <span className="ds-muted ds-small">{student.admissionNumber}</span>{' '}
              {admin && student.enrollmentStatus && student.enrollmentStatus !== 'active' && (
                <Badge status={student.enrollmentStatus}>{student.enrollmentStatus}</Badge>
              )}
            </span>
          ),
        },
        { key: 'status', header: 'Status', render: (student) => <SubmissionBadges status={submissionStatus(assignment, subOf(student))} /> },
        ...(offline
          ? []
          : [
              {
                key: 'handed-in',
                header: 'Handed in',
                render: (student) =>
                  subOf(student) ? <span className="ds-small">{formatDateTime(subOf(student).submitted_at)}</span> : <span className="ds-muted">—</span>,
              },
              {
                key: 'work',
                header: 'Work',
                stack: true,
                render: (student) => {
                  const sub = subOf(student)
                  return sub ? (
                    <span className="ds-stack" style={{ display: 'block' }}>
                      {sub.content && <span className="ds-pre ds-small" style={{ display: 'block' }}>{sub.content}</span>}
                      <FileLink path={sub.attachment_url} urls={urls} />
                    </span>
                  ) : (
                    <span className="ds-muted">—</span>
                  )
                },
              },
            ]),
        {
          key: 'grade',
          header: 'Mark and feedback',
          stack: true,
          render: (student) => {
            const sub = subOf(student)
            return (sub || offline) && locked && !admin ? (
              <LockedGrade assignment={assignment} submission={sub} />
            ) : sub || offline ? (
              // Offline work: graded directly, no submission needed first.
              <GradeForm
                key={`${student.studentId}:${sub?.graded_at ?? ''}`}
                assignment={assignment}
                studentId={student.studentId}
                submission={sub}
                onGraded={onGraded}
                confirmLocked={admin && locked}
                lockedExplanation={lockedExplanation}
                studentName={fullName(student)}
              />
            ) : (
              <span className="ds-muted ds-small">Nothing to grade yet</span>
            )
          },
        },
      ]}
    />
  )
}

// confirmLocked: an admin correcting a locked term's grade -> confirm first.
function GradeForm({ assignment, studentId, submission, onGraded, confirmLocked = false, lockedExplanation, studentName }) {
  const [score, setScore] = useState(formatMark(submission?.score))
  const [feedback, setFeedback] = useState(submission?.feedback ?? '')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const confirm = useCorrectionConfirm()
  const max = Number(assignment.max_score)
  const isGraded = Boolean(submission?.graded_at)

  function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    const n = Number(score)
    if (score.trim() === '' || Number.isNaN(n)) return setError('Enter a mark.')
    if (n < 0 || (max && n > max)) return setError(`The mark must be between 0 and ${max}.`)
    if (isGraded && formatMark(submission.score) === String(n) && (submission.feedback ?? '') === feedback.trim()) {
      return setError('Nothing has changed.')
    }
    const what = isGraded
      ? `${studentName}'s mark: ${formatMark(submission.score)} → ${n}`
      : `${studentName}: new mark ${n}`
    confirm.run(confirmLocked, `${lockedExplanation ?? ''} ${what}.`.trim(), () => save(n))
  }

  async function save(n) {
    setSaving(true)
    try {
      const grade = { score: n, feedback: feedback.trim() || null }
      if (submission) {
        await runWrite(supabase.from('submissions').update(grade).eq('id', submission.id).select('id'))
      } else {
        // Offline work: the graded record is created here (no text or file).
        await run(supabase.from('submissions').insert({ assignment_id: assignment.id, student_id: studentId, ...grade }))
      }
      onGraded()
    } catch (err) {
      setError(friendlyDbError(err))
      setSaving(false)
    }
  }

  return (
    <form className="ds-grade-form" onSubmit={handleSubmit}>
      <label className="ds-grade-mark">
        <span className="ds-label" style={{ margin: 0 }}>Mark</span>
        <input
          className="ds-input ds-score-input"
          type="number"
          min="0"
          max={max || undefined}
          step="any"
          value={score}
          onChange={(e) => setScore(e.target.value)}
          aria-label="Mark"
        />
        <span className="ds-muted ds-small">/ {formatMark(assignment.max_score)}</span>
      </label>
      <textarea className="ds-textarea" rows={2} placeholder="Feedback (optional)" value={feedback} onChange={(e) => setFeedback(e.target.value)} aria-label="Feedback" />
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" disabled={saving}>
        {saving ? 'Saving…' : isGraded ? 'Update grade' : 'Save grade'}
      </Button>
      {isGraded && <span className="ds-muted ds-small">Graded {formatDateTime(submission.graded_at)}</span>}
      {confirm.dialog}
    </form>
  )
}

// Read-only grade once the term is locked (only an admin can change it).
function LockedGrade({ assignment, submission }) {
  if (!submission?.graded_at) return <span className="ds-muted ds-small">🔒 Not graded (term locked)</span>
  return (
    <div>
      <strong>
        {formatMark(submission.score)} / {formatMark(assignment.max_score)}
      </strong>
      {submission.feedback && <div className="ds-pre ds-small">{submission.feedback}</div>}
      <span className="ds-muted ds-small">🔒 Graded {formatDateTime(submission.graded_at)}</span>
    </div>
  )
}
