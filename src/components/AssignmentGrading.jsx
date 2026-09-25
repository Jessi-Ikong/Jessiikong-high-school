import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../lib/db'
import { fullName } from '../lib/people'
import { formatDateTime, formatMark, submissionStatus } from '../lib/assignments'
import { FileLink, SubmissionBadges } from './SubmissionBadges'
import { useCorrectionConfirm } from './CorrectionConfirm'

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
    return <p className="empty-state">No students in this section take this subject this session.</p>
  }
  const byStudent = Object.fromEntries(submissions.map((s) => [s.student_id, s]))
  const offline = !assignment.requires_submission
  return (
    <div className="table-wrap">
      <table className="data-table submissions-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Status</th>
            {!offline && <th>Handed in</th>}
            {!offline && <th>Work</th>}
            <th>Mark and feedback</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => {
            const sub = byStudent[student.studentId]
            const status = submissionStatus(assignment, sub)
            return (
              <tr key={student.studentId}>
                <td>
                  {fullName(student)} <span className="muted small">{student.admissionNumber}</span>
                  {admin && student.enrollmentStatus && student.enrollmentStatus !== 'active' && (
                    <span className="badge badge-muted">{student.enrollmentStatus}</span>
                  )}
                </td>
                <td>
                  <SubmissionBadges status={status} />
                </td>
                {!offline && (
                  <td className="small">{sub ? formatDateTime(sub.submitted_at) : <span className="muted">—</span>}</td>
                )}
                {!offline && (
                  <td>
                    {sub ? (
                      <>
                        {sub.content && <div className="submission-text">{sub.content}</div>}
                        <FileLink path={sub.attachment_url} urls={urls} />
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                )}
                <td>
                  {(sub || offline) && locked && !admin ? (
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
                    <span className="muted small">Nothing to grade yet</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
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
    <form className="grade-form" onSubmit={handleSubmit}>
      <label className="inline-field">
        Mark
        <input
          className="score-input"
          type="number"
          min="0"
          max={max || undefined}
          step="any"
          value={score}
          onChange={(e) => setScore(e.target.value)}
          aria-label="Mark"
        />
        <span className="muted small">/ {formatMark(assignment.max_score)}</span>
      </label>
      <textarea rows={2} placeholder="Feedback (optional)" value={feedback} onChange={(e) => setFeedback(e.target.value)} aria-label="Feedback" />
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : isGraded ? 'Update grade' : 'Save grade'}
      </button>
      {isGraded && <span className="muted small">Graded {formatDateTime(submission.graded_at)}</span>}
      {confirm.dialog}
    </form>
  )
}

// Read-only grade once the term is locked (only an admin can change it).
function LockedGrade({ assignment, submission }) {
  if (!submission?.graded_at) return <span className="muted small">🔒 Not graded (term locked)</span>
  return (
    <div>
      <strong>
        {formatMark(submission.score)} / {formatMark(assignment.max_score)}
      </strong>
      {submission.feedback && <div className="submission-text">{submission.feedback}</div>}
      <span className="muted small">🔒 Graded {formatDateTime(submission.graded_at)}</span>
    </div>
  )
}
