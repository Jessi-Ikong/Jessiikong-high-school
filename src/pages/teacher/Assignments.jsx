import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { byName } from '../../lib/people'
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
import { fetchTeacherClasses } from '../../lib/teacherClasses'
import { termGradingOpen, termLockedMessage } from '../../lib/grading'
import { fromIsoDate } from '../../lib/dates'
import { formatDate } from '../../lib/format'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'
import DeleteAction from '../../components/DeleteAction'
import { FileLink } from '../../components/SubmissionBadges'
import { SubmissionsTable } from '../../components/AssignmentGrading'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Checkbox, Field, Select, TextArea, TextInput } from '../../components/ui/Form'
import Dialog from '../../components/ui/Dialog'

// This class's assignments (newest first), the students who TAKE the subject
// in that section (same roster as attendance and the gradebook), their
// submissions, and download links for every file.
async function fetchClassAssignments(cls, term, teacherId) {
  const [assignments, enrollments] = await Promise.all([
    run(
      supabase
        .from('assignments')
        .select('id, title, description, attachment_url, due_at, max_score, requires_submission, created_at')
        .eq('teacher_id', teacherId)
        .eq('section_id', cls.sectionId)
        .eq('subject_id', cls.subjectId)
        .eq('term_id', cls.termId)
        .order('created_at', { ascending: false }),
    ),
    run(
      supabase
        .from('enrollments')
        .select('student_id, students(admission_number, users(first_name, middle_name, last_name)), student_subjects!inner(subject_id)')
        .eq('section_id', cls.sectionId)
        .eq('session_id', term.session_id)
        .eq('status', 'active')
        .eq('student_subjects.subject_id', cls.subjectId),
    ),
  ])
  const students = enrollments
    .map((e) => ({ studentId: e.student_id, admissionNumber: e.students.admission_number, ...e.students.users }))
    .sort(byName)
  const submissions = assignments.length
    ? await run(
        supabase
          .from('submissions')
          .select('id, assignment_id, student_id, content, attachment_url, submitted_at, score, feedback, graded_at')
          .in('assignment_id', assignments.map((a) => a.id)),
      )
    : []
  const urls = await signedUrls([
    ...assignments.map((a) => a.attachment_url),
    ...submissions.map((s) => s.attachment_url),
  ])
  return { assignments, students, submissions, urls }
}

export default function Assignments() {
  const { profile } = useAuth()
  const classesQuery = useAsyncData(() => fetchTeacherClasses(profile.id), `teacher-classes:${profile.id}`)

  if (classesQuery.loading) return <LoadingState lines={5} label="Loading your classes…" />
  if (classesQuery.error) return <Alert tone="danger">{friendlyDbError(classesQuery.error)}</Alert>

  const data = classesQuery.data
  return (
    <>
      {data.problem === 'no-teacher' ? (
        <>
          <PageHeader title="Assignments" />
          <Alert tone="danger">Your account isn&apos;t set up as a teacher record yet. Please contact the school office.</Alert>
        </>
      ) : data.problem === 'no-session' ? (
        <>
          <PageHeader title="Assignments" />
          <Card>
            <EmptyState icon="calendar">No session is marked as current yet, so there are no classes to set work for.</EmptyState>
          </Card>
        </>
      ) : (
        <ClassPicker teacherId={data.teacherId} terms={data.terms} classes={data.classes} />
      )}
    </>
  )
}

// ?class=<term:section:subject>&open=<assignment id> (links from the dashboard)
// preselect a class and expand one assignment.
function ClassPicker({ teacherId, terms, classes }) {
  const [params] = useSearchParams()
  const linked = classes.find((c) => c.key === params.get('class'))
  const [chosenTermId, setChosenTermId] = useState(linked?.termId ?? null)
  const [chosenKey, setChosenKey] = useState(linked?.key ?? null)
  const term = terms.find((t) => t.id === chosenTermId) ?? terms.find((t) => t.is_current) ?? terms[0]
  const termClasses = classes.filter((c) => c.termId === term.id)
  const cls = termClasses.find((c) => c.key === chosenKey) ?? termClasses[0]

  return (
    <>
      <PageHeader
        title="Assignments"
        subtitle={`Set work for the classes you teach this session (${term.sessions.name}). Only students who take the subject see it and can hand it in.`}
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
          <EmptyState icon="file">You have no classes on the timetable for {term.name}.</EmptyState>
        </Card>
      ) : (
        <ClassAssignments
          key={cls.key}
          cls={cls}
          term={term}
          teacherId={teacherId}
          initialOpenId={cls.key === linked?.key ? params.get('open') : null}
        />
      )}
    </>
  )
}

function ClassAssignments({ cls, term, teacherId, initialOpenId }) {
  const query = useAsyncData(() => fetchClassAssignments(cls, term, teacherId), `class-assignments:${cls.key}`)
  const [openId, setOpenId] = useState(initialOpenId)
  const [message, setMessage] = useState(null)

  if (query.loading) return <LoadingState lines={4} label="Loading assignments…" />
  if (query.error) return <Alert tone="danger">{friendlyDbError(query.error)}</Alert>

  const { assignments, students, submissions, urls } = query.data
  const rosterIds = new Set(students.map((s) => s.studentId))
  const locked = !termGradingOpen(term)

  return (
    <>
      {locked ? (
        <Alert tone="info">
          🔒 {termLockedMessage(term, 'Assignment grades')} Assignments in this term can no longer be created, changed or deleted either.
        </Alert>
      ) : (
        <CreateAssignmentForm
          cls={cls}
          term={term}
          teacherId={teacherId}
          onCreated={(text, newId) => {
            setMessage(text)
            setOpenId(newId)
            query.reload()
          }}
        />
      )}
      {message && <Alert tone="success">{message}</Alert>}

      <h2 className="ds-h2" style={{ marginTop: 16 }}>
        {cls.label} · {term.name}
      </h2>
      <p className="ds-note">
        {students.length} {students.length === 1 ? 'student takes' : 'students take'} this subject in this section.
      </p>
      {assignments.length === 0 ? (
        <Card>
          <EmptyState icon="file">No assignments for this class yet. Create one above.</EmptyState>
        </Card>
      ) : (
        <div>
          {assignments.map((a) => {
            const subs = submissions.filter((s) => s.assignment_id === a.id && rosterIds.has(s.student_id))
            const graded = subs.filter((s) => s.graded_at).length
            const late = subs.filter((s) => submissionStatus(a, s).late).length
            const isOpen = openId === a.id
            return (
              <Card
                key={a.id}
                title={
                  <span className="ds-inline">
                    {a.title}
                    {!a.requires_submission && <Badge status="no hand-in">Offline work</Badge>}
                  </span>
                }
              >
                <div className="ds-assignment-head">
                  <p className="ds-muted ds-small" style={{ margin: 0 }}>
                    Due {a.due_at ? formatDateTime(a.due_at) : '(no due date)'} · Out of {formatMark(a.max_score) || '—'} · Set{' '}
                    {formatDateTime(a.created_at)}
                  </p>
                  <div className="ds-small">
                    {a.requires_submission ? (
                      <>
                        <strong>
                          {subs.length} of {students.length}
                        </strong>{' '}
                        submitted
                        <span className="ds-muted">
                          {' '}
                          · {graded} graded{late > 0 ? ` · ${late} late` : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>
                          {graded} of {students.length}
                        </strong>{' '}
                        graded
                      </>
                    )}
                  </div>
                </div>
                {a.description && <p className="ds-pre ds-small">{a.description}</p>}
                {a.attachment_url && (
                  <p>
                    <FileLink path={a.attachment_url} urls={urls} />
                  </p>
                )}
                <div className="ds-row-actions">
                  <Button variant="secondary" onClick={() => setOpenId(isOpen ? null : a.id)}>
                    {isOpen
                      ? a.requires_submission
                        ? 'Hide submissions'
                        : 'Hide students'
                      : a.requires_submission
                        ? 'View submissions'
                        : 'Grade students'}
                  </Button>
                  {!locked && (
                    <DeleteAction
                      itemName={`"${a.title}"`}
                      dependencyChecks={[{ table: 'submissions', column: 'assignment_id', value: a.id, label: a.requires_submission ? ['submission', 'submissions'] : ['grade', 'grades'] }]}
                      onDelete={async () => {
                        await runWrite(supabase.from('assignments').delete().eq('id', a.id).select('id'))
                        await removeAssignmentFile(a.attachment_url)
                      }}
                      onDeleted={() => {
                        setMessage(`Deleted "${a.title}".`)
                        query.reload()
                      }}
                    />
                  )}
                </div>
                {isOpen && (
                  <div style={{ marginTop: 12 }}>
                    <SubmissionsTable
                      assignment={a}
                      students={students}
                      submissions={subs}
                      urls={urls}
                      locked={locked}
                      onGraded={query.reload}
                    />
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}

// The due date (a datetime-local value) falls on a day inside the term.
function dueWithinTerm(due, term) {
  const day = new Date(due)
  day.setHours(0, 0, 0, 0)
  return day >= fromIsoDate(term.start_date) && day <= fromIsoDate(term.end_date)
}

const EMPTY_FORM = { title: '', description: '', due: '', maxScore: '10', offline: false }

function CreateAssignmentForm({ cls, term, teacherId, onCreated }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [file, setFile] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
    setError(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    const maxScore = Number(form.maxScore)
    if (!form.title.trim()) return setError('Give the assignment a title.')
    if (!form.due) return setError('Choose a due date and time.')
    if (!dueWithinTerm(form.due, term)) {
      return setError(`The due date must fall within ${term.name} (${formatDate(term.start_date)} to ${formatDate(term.end_date)}).`)
    }
    if (!(maxScore > 0)) return setError('The maximum mark must be more than 0.')
    const problem = fileProblem(file)
    if (problem) return setError(problem)

    setSaving(true)
    try {
      const created = await run(
        supabase
          .from('assignments')
          .insert({
            teacher_id: teacherId,
            subject_id: cls.subjectId,
            section_id: cls.sectionId,
            term_id: cls.termId,
            title: form.title.trim(),
            description: form.description.trim() || null,
            due_at: new Date(form.due).toISOString(), // datetime-local is the teacher's local time
            max_score: maxScore,
            requires_submission: !form.offline,
          })
          .select('id')
          .single(),
      )
      let text = `"${form.title.trim()}" was created.`
      if (file) {
        try {
          const path = await uploadAssignmentFile(`assignment/${created.id}`, file)
          await runWrite(supabase.from('assignments').update({ attachment_url: path }).eq('id', created.id).select('id'))
        } catch (err) {
          text += ` But the file wasn't attached: ${err.code ? friendlyDbError(err) : err.message}`
        }
      }
      setForm(EMPTY_FORM)
      setFile(null)
      setFileInputKey((k) => k + 1)
      setOpen(false)
      onCreated(text, created.id)
    } catch (err) {
      setError(friendlyDbError(err))
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="ds-row-actions" style={{ marginBottom: 12 }}>
        <Button onClick={() => setOpen(true)}>+ New assignment</Button>
      </div>
    )
  }

  return (
    <>
      <div className="ds-row-actions" style={{ marginBottom: 12 }}>
        <Button onClick={() => setOpen(true)}>+ New assignment</Button>
      </div>
      <Dialog
        title={`New assignment for ${cls.label} · ${term.name}`}
        onClose={() => setOpen(false)}
        busy={saving}
        dismissOnBackdrop={false}
        footer={
          <div className="ds-form-actions" style={{ margin: 0, width: '100%' }}>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="new-assignment-form" disabled={saving}>
              {saving ? 'Creating…' : 'Create assignment'}
            </Button>
          </div>
        }
      >
        <form id="new-assignment-form" onSubmit={handleSubmit}>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="ds-form-grid">
            <Field label="Title" className="ds-span-2">
              {(p) => <TextInput {...p} value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="Photosynthesis essay" required data-autofocus />}
            </Field>
            <Field label="Due date and time" hint={`${term.name}: ${formatDate(term.start_date)} to ${formatDate(term.end_date)}`}>
              {(p) => (
                <TextInput
                  {...p}
                  type="datetime-local"
                  value={form.due}
                  min={`${term.start_date}T00:00`}
                  max={`${term.end_date}T23:59`}
                  onChange={(e) => update('due', e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="Marked out of">
              {(p) => <TextInput {...p} type="number" min="1" step="any" value={form.maxScore} onChange={(e) => update('maxScore', e.target.value)} required />}
            </Field>
          </div>
          <Checkbox
            label="This is offline work (no file/text submission expected)"
            checked={form.offline}
            onChange={(e) => update('offline', e.target.checked)}
          />
          <p className="ds-note" style={{ marginTop: 0 }}>
            e.g. a practical, presentation or physical project. Students won&apos;t hand anything in; you grade each student directly.
          </p>
          <Field label="Instructions" hint="Optional">
            {(p) => <TextArea {...p} rows={4} value={form.description} onChange={(e) => update('description', e.target.value)} />}
          </Field>
          <Field label="Attachment" hint={`Optional. ${FILE_RULES}`}>
            {(p) => (
              <TextInput
                {...p}
                key={fileInputKey}
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
        </form>
      </Dialog>
    </>
  )
}
