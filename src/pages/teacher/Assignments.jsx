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

  if (classesQuery.loading) return <p className="muted">Loading your classes…</p>
  if (classesQuery.error) return <p className="alert alert-error" role="alert">{friendlyDbError(classesQuery.error)}</p>

  const data = classesQuery.data
  return (
    <>
      <h1>Assignments</h1>
      {data.problem === 'no-teacher' ? (
        <p className="alert alert-error" role="alert">
          Your account isn&apos;t set up as a teacher record yet. Please contact the school office.
        </p>
      ) : data.problem === 'no-session' ? (
        <p className="empty-state">No session is marked as current yet, so there are no classes to set work for.</p>
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
      <p className="muted">
        Set work for the classes you teach this session ({term.sessions.name}). Only students who take the subject see
        it and can hand it in.
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

  if (query.loading) return <p className="muted">Loading assignments…</p>
  if (query.error) return <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>

  const { assignments, students, submissions, urls } = query.data
  const rosterIds = new Set(students.map((s) => s.studentId))
  const locked = !termGradingOpen(term)

  return (
    <>
      {locked ? (
        <p className="alert alert-info-plain">
          🔒 {termLockedMessage(term, 'Assignment grades')} Assignments in this term can no longer be created, changed or deleted either.
        </p>
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
      {message && <p className="alert alert-success" role="status">{message}</p>}

      <h2>
        {cls.label} · {term.name}
      </h2>
      <p className="muted small">
        {students.length} {students.length === 1 ? 'student takes' : 'students take'} this subject in this section.
      </p>
      {assignments.length === 0 ? (
        <p className="empty-state">No assignments for this class yet. Create one above.</p>
      ) : (
        <div className="assignment-list">
          {assignments.map((a) => {
            const subs = submissions.filter((s) => s.assignment_id === a.id && rosterIds.has(s.student_id))
            const graded = subs.filter((s) => s.graded_at).length
            const late = subs.filter((s) => submissionStatus(a, s).late).length
            const isOpen = openId === a.id
            return (
              <article key={a.id} className="panel assignment-card">
                <header className="assignment-card-header">
                  <div>
                    <h3>
                      {a.title}
                      {!a.requires_submission && <span className="badge badge-muted">Offline work</span>}
                    </h3>
                    <p className="muted small">
                      Due {a.due_at ? formatDateTime(a.due_at) : '(no due date)'} · Out of {formatMark(a.max_score) || '—'} ·
                      Set {formatDateTime(a.created_at)}
                    </p>
                  </div>
                  <div className="submission-count">
                    {a.requires_submission ? (
                      <>
                        <strong>
                          {subs.length} of {students.length}
                        </strong>{' '}
                        submitted
                        <span className="muted small">
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
                </header>
                {a.description && <p className="assignment-description">{a.description}</p>}
                {a.attachment_url && (
                  <p>
                    <FileLink path={a.attachment_url} urls={urls} />
                  </p>
                )}
                <div className="row-actions">
                  <button type="button" className="button-secondary" onClick={() => setOpenId(isOpen ? null : a.id)}>
                    {isOpen
                      ? a.requires_submission
                        ? 'Hide submissions'
                        : 'Hide students'
                      : a.requires_submission
                        ? 'View submissions'
                        : 'Grade students'}
                  </button>
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
                  <SubmissionsTable
                    assignment={a}
                    students={students}
                    submissions={subs}
                    urls={urls}
                    locked={locked}
                    onGraded={query.reload}
                  />
                )}
              </article>
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
      <div className="toolbar">
        <button type="button" onClick={() => setOpen(true)}>
          + New assignment
        </button>
      </div>
    )
  }

  return (
    <form className="panel form-grid" onSubmit={handleSubmit}>
      <h2>
        New assignment for {cls.label} · {term.name}
      </h2>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <label>
        Title
        <input value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="Photosynthesis essay" required />
      </label>
      <label>
        Due date and time
        <input
          type="datetime-local"
          value={form.due}
          min={`${term.start_date}T00:00`}
          max={`${term.end_date}T23:59`}
          onChange={(e) => update('due', e.target.value)}
          required
        />
        <span className="muted small">
          {term.name}: {formatDate(term.start_date)} to {formatDate(term.end_date)}
        </span>
      </label>
      <label>
        Marked out of
        <input type="number" min="1" step="any" value={form.maxScore} onChange={(e) => update('maxScore', e.target.value)} required />
      </label>
      <label className="checkbox-field span-all">
        <input type="checkbox" checked={form.offline} onChange={(e) => update('offline', e.target.checked)} />
        This is offline work (no file/text submission expected)
        <span className="muted small">
          {' '}
          e.g. a practical, presentation or physical project. Students won&apos;t hand anything in; you grade each
          student directly.
        </span>
      </label>
      <label className="span-all">
        Instructions (optional)
        <textarea rows={4} value={form.description} onChange={(e) => update('description', e.target.value)} />
      </label>
      <label className="span-all">
        Attachment (optional)
        <input
          key={fileInputKey}
          type="file"
          accept={FILE_ACCEPT}
          onChange={(e) => {
            const chosen = e.target.files[0] ?? null
            setFile(chosen)
            setError(fileProblem(chosen))
          }}
        />
        <span className="muted small">{FILE_RULES}</span>
      </label>
      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Creating…' : 'Create assignment'}
        </button>
        <button type="button" className="button-secondary" onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  )
}
