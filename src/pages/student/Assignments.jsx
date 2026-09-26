import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { fullName } from '../../lib/people'
import {
  FILE_ACCEPT,
  FILE_RULES,
  fileProblem,
  formatDateTime,
  formatMark,
  removeAssignmentFile,
  signedUrls,
  submissionStatus,
  uploadAssignmentFile,
} from '../../lib/assignments'
import { termGradingOpen } from '../../lib/grading'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'
import { FileLink, SubmissionBadges } from '../../components/SubmissionBadges'
import { toneFor } from '../../lib/statusTones'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Checkbox, Field, TextArea, TextInput } from '../../components/ui/Form'
import Dialog from '../../components/ui/Dialog'

// Assignments for the subjects the student takes, in their section, in the
// CURRENT session (every class they take, every term; the page groups them by
// term), plus their own submissions. RLS enforces the same scoping; the
// filters here just keep older sessions out of the list.
async function fetchMyAssignments(userId) {
  const student = await run(supabase.from('students').select('id').eq('user_id', userId).maybeSingle())
  if (!student) return { problem: 'no-student' }
  const enrollment = await run(
    supabase
      .from('enrollments')
      .select('id, section_id, session_id, sessions!inner(name, is_current), sections(name, classes(name)), student_subjects(subject_id)')
      .eq('student_id', student.id)
      .eq('status', 'active')
      .eq('sessions.is_current', true)
      .maybeSingle(),
  )
  if (!enrollment) return { problem: 'no-enrollment' }
  const subjectIds = enrollment.student_subjects.map((s) => s.subject_id)
  const assignments = subjectIds.length
    ? await run(
        supabase
          .from('assignments')
          .select('id, title, description, attachment_url, due_at, max_score, requires_submission, created_at, subjects(name), teachers(users(first_name, last_name)), terms!inner(id, name, term_number, is_current, end_date, session_id)')
          .eq('section_id', enrollment.section_id)
          .in('subject_id', subjectIds)
          .eq('terms.session_id', enrollment.session_id),
      )
    : []
  const submissions = assignments.length
    ? await run(
        supabase
          .from('submissions')
          .select('id, assignment_id, content, attachment_url, submitted_at, score, feedback, graded_at')
          .eq('student_id', student.id)
          .in('assignment_id', assignments.map((a) => a.id)),
      )
    : []
  const urls = await signedUrls([...assignments.map((a) => a.attachment_url), ...submissions.map((s) => s.attachment_url)])
  return { studentId: student.id, enrollment, subjectCount: subjectIds.length, assignments, submissions, urls }
}

// Upcoming due dates first (soonest at the top), then past ones (most recent
// first), then any without a due date.
function byDueDate(now) {
  const rank = (a) => (!a.due_at ? 2 : new Date(a.due_at) >= now ? 0 : 1)
  return (a, b) => {
    const diff = rank(a) - rank(b)
    if (diff !== 0) return diff
    if (!a.due_at) return a.title.localeCompare(b.title)
    const ta = new Date(a.due_at).getTime()
    const tb = new Date(b.due_at).getTime()
    return rank(a) === 0 ? ta - tb : tb - ta
  }
}

const GROUPS = [
  { key: 'not-submitted', title: 'To do', empty: 'Nothing to hand in. Well done!' },
  { key: 'submitted', title: 'Submitted — awaiting grade', empty: 'Nothing waiting to be graded.' },
  { key: 'graded', title: 'Graded', empty: 'Nothing graded yet.' },
]

// The terms that have assignments, in term order (First, Second, Third).
function termsOf(items) {
  const terms = new Map(items.map((i) => [i.assignment.terms.id, i.assignment.terms]))
  return [...terms.values()].sort((a, b) => a.term_number - b.term_number)
}

export default function Assignments() {
  const { profile } = useAuth()
  const query = useAsyncData(() => fetchMyAssignments(profile.id), `my-assignments:${profile.id}`)
  const [message, setMessage] = useState(null)

  if (query.loading) return <LoadingState lines={5} label="Loading your assignments…" />
  if (query.error) return <Alert tone="danger">{friendlyDbError(query.error)}</Alert>

  const data = query.data
  if (data.problem === 'no-student') {
    return (
      <>
        <PageHeader title="Assignments" />
        <Alert tone="danger">Your account isn&apos;t set up as a student record yet. Please contact the school office.</Alert>
      </>
    )
  }
  if (data.problem === 'no-enrollment') {
    return (
      <>
        <PageHeader title="Assignments" />
        <Card>
          <EmptyState icon="file">You aren&apos;t enrolled in a class for the current session yet, so there are no assignments.</EmptyState>
        </Card>
      </>
    )
  }

  const now = new Date()
  const { enrollment, assignments, submissions, urls, studentId } = data
  const mine = Object.fromEntries(submissions.map((s) => [s.assignment_id, s]))
  const items = assignments
    .sort(byDueDate(now))
    .map((a) => ({ assignment: a, submission: mine[a.id], status: submissionStatus(a, mine[a.id], now) }))

  return (
    <>
      <PageHeader
        title="Assignments"
        subtitle={`${enrollment.sections.classes.name} ${enrollment.sections.name} · ${enrollment.sessions.name}. Work set for the subjects you take.`}
      />
      {message && <Alert tone="success">{message}</Alert>}
      {data.subjectCount === 0 ? (
        <Card>
          <EmptyState icon="book">No subjects have been chosen for you yet. Please contact the school office.</EmptyState>
        </Card>
      ) : assignments.length === 0 ? (
        <Card>
          <EmptyState icon="file">No assignments have been set for your subjects yet.</EmptyState>
        </Card>
      ) : (
        termsOf(items).map((term) => {
          const termItems = items.filter((i) => i.assignment.terms.id === term.id)
          return (
            <section key={term.id} className="ds-term-group">
              <h2 className="ds-h2 ds-inline" style={{ fontSize: 'var(--ds-text-lg)' }}>
                {term.name}
                {term.is_current && <Badge status="current">Current term</Badge>}
                {!termGradingOpen(term) && <Badge status="locked">🔒 Closed</Badge>}
              </h2>
              {GROUPS.map((group) => {
                const groupItems = termItems.filter((i) => i.status.key === group.key)
                return (
                  <section key={group.key}>
                    <h3 className="ds-h3" style={{ marginTop: 16 }}>
                      {group.title} ({groupItems.length})
                    </h3>
                    {groupItems.length === 0 ? (
                      <p className="ds-note">{group.empty}</p>
                    ) : (
                      <div>
                        {groupItems.map((item) => (
                          <AssignmentCard
                            key={`${item.assignment.id}:${item.submission?.submitted_at ?? ''}`}
                            {...item}
                            studentId={studentId}
                            urls={urls}
                            onSubmitted={(text) => {
                              setMessage(text)
                              query.reload()
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </section>
          )
        })
      )}
    </>
  )
}

function AssignmentCard({ assignment, submission, status, studentId, urls, onSubmitted }) {
  const [editing, setEditing] = useState(false)
  const teacher = assignment.teachers?.users
  // Closes with the term's grading window (end date + 7 days); the database enforces it.
  const termClosed = !termGradingOpen(assignment.terms)
  // Offline work (practicals, presentations...): nothing to hand in here.
  const offline = !assignment.requires_submission

  return (
    <Card
      className={`ds-edge-${toneFor(status.key)}`}
      title={
        <span className="ds-inline">
          {assignment.title}
          {offline && <Badge status="no hand-in">Offline work</Badge>}
        </span>
      }
    >
      <div className="ds-assignment-head">
        <p className="ds-muted ds-small" style={{ margin: 0 }}>
          {assignment.subjects.name}
          {teacher ? ` · ${fullName(teacher)}` : ''}
        </p>
        <SubmissionBadges status={status} />
      </div>
      <p className="ds-small">
        <strong>Due:</strong> {assignment.due_at ? formatDateTime(assignment.due_at) : 'no due date'}
        {assignment.max_score && <span className="ds-muted"> · Marked out of {formatMark(assignment.max_score)}</span>}
      </p>
      {assignment.description && <p className="ds-pre ds-small">{assignment.description}</p>}
      {assignment.attachment_url && (
        <p>
          <FileLink path={assignment.attachment_url} urls={urls} />
        </p>
      )}

      {submission && !offline && !editing && (
        <div className="ds-work-box">
          <h4 className="ds-h3">Your work</h4>
          <p className="ds-muted ds-small" style={{ marginTop: 0 }}>
            Handed in {formatDateTime(submission.submitted_at)}
            {status.late && <strong className="ds-text-danger"> — after the due date (Late)</strong>}
          </p>
          {submission.content && <div className="ds-pre ds-small">{submission.content}</div>}
          <FileLink path={submission.attachment_url} urls={urls} />
        </div>
      )}

      {status.key === 'graded' && (
        <div className="ds-work-box ds-work-graded">
          <p style={{ marginTop: 0 }}>
            <strong>
              Mark: {formatMark(submission.score)}
              {assignment.max_score ? ` / ${formatMark(assignment.max_score)}` : ''}
            </strong>
          </p>
          {submission.feedback ? (
            <p className="ds-pre">{submission.feedback}</p>
          ) : (
            <p className="ds-muted ds-small">No written feedback.</p>
          )}
          <p className="ds-muted ds-small" style={{ marginBottom: 0 }}>
            🔒 Graded {formatDateTime(submission.graded_at)}.{offline ? '' : ' This submission can no longer be changed.'}
          </p>
        </div>
      )}

      {status.key !== 'graded' && offline && (
        <Alert tone="info">No submission needed — your teacher will grade this directly.</Alert>
      )}

      {status.key !== 'graded' && !offline && termClosed && (
        <Alert tone="info">
          🔒 This assignment&apos;s term has closed for new submissions. Contact an admin if you still need to hand this in.
        </Alert>
      )}

      {status.key !== 'graded' &&
        !offline &&
        !termClosed &&
        (
          <>
            <div className="ds-row-actions" style={{ alignItems: 'center' }}>
              <Button variant={submission ? 'secondary' : 'primary'} onClick={() => setEditing(true)}>
                {submission ? 'Change my submission' : 'Hand in work'}
              </Button>
              {submission && <span className="ds-muted ds-small">You can change it until your teacher grades it.</span>}
            </div>
            {editing && (
              <SubmitForm
                assignment={assignment}
                existing={submission}
                studentId={studentId}
                onCancel={() => setEditing(false)}
                onSubmitted={onSubmitted}
              />
            )}
          </>
        )}
    </Card>
  )
}

function SubmitForm({ assignment, existing, studentId, onCancel, onSubmitted }) {
  const [content, setContent] = useState(existing?.content ?? '')
  const [file, setFile] = useState(null)
  const [removeFile, setRemoveFile] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const pastDue = assignment.due_at && new Date() > new Date(assignment.due_at)
  const keptFile = !file && !removeFile ? existing?.attachment_url : null

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    const problem = fileProblem(file)
    if (problem) return setError(problem)
    if (!content.trim() && !file && !keptFile) return setError('Write something or attach a file before handing in.')

    setSaving(true)
    let uploaded = null
    try {
      if (file) uploaded = await uploadAssignmentFile(`submission/${assignment.id}/${studentId}`, file)
      // One submission per student per assignment: handing in again replaces it.
      await run(
        supabase
          .from('submissions')
          .upsert(
            {
              assignment_id: assignment.id,
              student_id: studentId,
              content: content.trim() || null,
              attachment_url: uploaded ?? keptFile ?? null,
            },
            { onConflict: 'assignment_id,student_id' },
          )
          .select('id'),
      )
      if (existing?.attachment_url && existing.attachment_url !== (uploaded ?? keptFile)) {
        await removeAssignmentFile(existing.attachment_url)
      }
      onSubmitted(`"${assignment.title}" was handed in${pastDue ? ' (late)' : ''}.`)
    } catch (err) {
      if (uploaded) await removeAssignmentFile(uploaded)
      setError(err.code ? friendlyDbError(err) : err.message)
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={`Hand in: ${assignment.title}`}
      onClose={onCancel}
      busy={saving}
      dismissOnBackdrop={false}
      footer={
        <div className="ds-form-actions" style={{ margin: 0, width: '100%' }}>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={`submit-${assignment.id}`} disabled={saving}>
            {saving ? 'Handing in…' : existing ? 'Hand in again' : 'Hand in'}
          </Button>
        </div>
      }
    >
      <form id={`submit-${assignment.id}`} onSubmit={handleSubmit}>
        {pastDue && (
          <Alert tone="warning">
            The due date has passed. You can still hand this in, but it will be marked <strong>Late</strong> for you and your teacher.
          </Alert>
        )}
        <Field label="Your answer" hint="Optional if you attach a file.">
          {(p) => <TextArea {...p} rows={6} value={content} onChange={(e) => setContent(e.target.value)} data-autofocus />}
        </Field>
        {existing?.attachment_url && !file && (
          <Checkbox label="Remove the file I handed in before" checked={removeFile} onChange={(e) => setRemoveFile(e.target.checked)} />
        )}
        <Field label={existing?.attachment_url ? 'Replace file (optional)' : 'Attach a file (optional)'} hint={FILE_RULES}>
          {(p) => (
            <TextInput
              {...p}
              type="file"
              accept={FILE_ACCEPT}
              onChange={(e) => {
                const chosen = e.target.files[0] ?? null
                setFile(chosen)
                setError(fileProblem(chosen))
              }}
            />
          )}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  )
}
