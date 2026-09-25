import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { callFunction } from '../../lib/functions'
import { formatDate } from '../../lib/format'
import { fullName, byName } from '../../lib/people'
import { useAsyncData } from '../../hooks/useAsyncData'
import PhotoUpload from '../../components/PhotoUpload'
import { ActiveToggle, EditStudentDialog, StudentSubjectsDialog } from '../../components/PersonEdit'

const STATUSES = ['active', 'promoted', 'repeated', 'graduated', 'withdrawn']

async function fetchSetup() {
  const [sessions, classes, sections, subjects] = await Promise.all([
    run(supabase.from('sessions').select('id, name, is_current, start_date').order('start_date', { ascending: false })),
    run(supabase.from('classes').select('id, name, level').order('level')),
    run(supabase.from('sections').select('id, class_id, name').order('name')),
    run(supabase.from('subjects').select('id, name, code').order('name')),
  ])
  return { sessions, classes, sections, subjects }
}

export default function Students() {
  const setup = useAsyncData(fetchSetup, 'student-setup')

  if (setup.loading) return <p className="muted">Loading…</p>
  if (setup.error) return <p className="alert alert-error" role="alert">{friendlyDbError(setup.error)}</p>

  const { sessions, classes } = setup.data
  if (sessions.length === 0 || classes.length === 0) {
    return (
      <>
        <h1>Students</h1>
        <p className="empty-state">
          Before adding students, create at least one <Link to="/admin/sessions">session</Link> and one{' '}
          <Link to="/admin/classes">class with a section</Link>.
        </p>
      </>
    )
  }
  return <StudentsPage setup={setup.data} />
}

function StudentsPage({ setup }) {
  const { sessions, classes, sections } = setup
  const defaultSession = sessions.find((s) => s.is_current) ?? sessions[0]

  // List filters
  const [sessionId, setSessionId] = useState(defaultSession.id)
  const [classFilter, setClassFilter] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortBy, setSortBy] = useState('name')
  // { kind: 'details' | 'subjects', row }
  const [editing, setEditing] = useState(null)

  const enrollments = useAsyncData(
    () =>
      run(
        supabase
          .from('enrollments')
          .select(
            'id, status, class_id, section_id, classes(name, level), sections(name), ' +
              'students(id, admission_number, gender, date_of_birth, users(id, first_name, middle_name, last_name, email, photo_url, is_active))',
          )
          .eq('session_id', sessionId),
      ),
    `enrollments:${sessionId}`,
  )

  const rows = (enrollments.data ?? [])
    .map((e) => ({ ...e, student: e.students, person: e.students.users }))
    .filter((e) => !classFilter || e.class_id === classFilter)
    .filter((e) => !sectionFilter || e.section_id === sectionFilter)
    .filter((e) => !statusFilter || e.status === statusFilter)
    .sort((a, b) =>
      sortBy === 'admission'
        ? a.student.admission_number.localeCompare(b.student.admission_number)
        : byName(a.person, b.person),
    )

  const filterSections = sections.filter((s) => s.class_id === classFilter)
  const sessionName = sessions.find((s) => s.id === sessionId)?.name
  // Subjects can only be changed for the current session (the database enforces it too).
  const isCurrentSession = sessions.find((s) => s.id === sessionId)?.is_current ?? false

  return (
    <>
      <h1>Students</h1>
      <p className="muted">Students enrolled in the chosen session. Every new student gets an email invite to set their password.</p>

      <AddStudentForm setup={setup} defaultSessionId={defaultSession.id} onAdded={enrollments.reload} />

      <div className="filter-bar">
        <label className="inline-field">
          Session
          <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.is_current ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          Class
          <select
            value={classFilter}
            onChange={(e) => {
              setClassFilter(e.target.value)
              setSectionFilter('')
            }}
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          Section
          <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} disabled={!classFilter}>
            <option value="">{classFilter ? 'All sections' : 'Choose a class first'}</option>
            {filterSections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          Sort by
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="name">Name (A–Z)</option>
            <option value="admission">Admission number</option>
          </select>
        </label>
      </div>

      {enrollments.loading ? (
        <p className="muted">Loading students…</p>
      ) : enrollments.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(enrollments.error)}</p>
      ) : rows.length === 0 ? (
        <p className="empty-state">
          {enrollments.data.length === 0
            ? `No students enrolled in ${sessionName} yet — add one above.`
            : 'No students match these filters.'}
        </p>
      ) : (
        <>
          <p className="muted small">
            {rows.length} {rows.length === 1 ? 'student' : 'students'}
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Name</th>
                  <th>Admission no.</th>
                  <th>Class</th>
                  <th>Status</th>
                  <th>Email</th>
                  <th>Date of birth</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <PhotoUpload userId={row.person.id} name={fullName(row.person)} path={row.person.photo_url} label="Change" onChanged={enrollments.reload} />
                    </td>
                    <td>
                      {fullName(row.person)}
                      {!row.person.is_active && <span className="badge badge-muted">Deactivated</span>}
                    </td>
                    <td>{row.student.admission_number}</td>
                    <td>
                      {row.classes.name} {row.sections.name}
                    </td>
                    <td>{row.status}</td>
                    <td>{row.person.email}</td>
                    <td>{formatDate(row.student.date_of_birth) || <span className="muted">—</span>}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="button-link" onClick={() => setEditing({ kind: 'details', row })}>
                          Edit
                        </button>
                        {isCurrentSession && (
                          <button type="button" className="button-link" onClick={() => setEditing({ kind: 'subjects', row })}>
                            Subjects
                          </button>
                        )}
                        <ActiveToggle
                          person={{ userId: row.person.id, name: fullName(row.person), role: 'student', is_active: row.person.is_active }}
                          onChanged={enrollments.reload}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing?.kind === 'details' && (
        <EditStudentDialog
          person={{ studentId: editing.row.student.id, ...editing.row.person, date_of_birth: editing.row.student.date_of_birth, gender: editing.row.student.gender }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            enrollments.reload()
          }}
        />
      )}
      {editing?.kind === 'subjects' && (
        <StudentSubjectsDialog
          enrollmentId={editing.row.id}
          studentName={fullName(editing.row.person)}
          classLabel={`${editing.row.classes.name} ${editing.row.sections.name}, ${sessionName}`}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

const EMPTY_FORM = {
  full_name: '',
  email: '',
  date_of_birth: '',
  gender: '',
  class_id: '',
  section_id: '',
  subject_ids: [],
}

function AddStudentForm({ setup, defaultSessionId, onAdded }) {
  const { sessions, classes, sections, subjects } = setup
  const [form, setForm] = useState({ ...EMPTY_FORM, session_id: defaultSessionId })
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [saving, setSaving] = useState(false)

  const formSections = sections.filter((s) => s.class_id === form.class_id)

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function toggleSubject(id) {
    setForm((f) => ({
      ...f,
      subject_ids: f.subject_ids.includes(id) ? f.subject_ids.filter((s) => s !== id) : [...f.subject_ids, id],
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setSaving(true)
    try {
      const result = await callFunction('invite-user', {
        role: 'student',
        full_name: form.full_name,
        email: form.email,
        date_of_birth: form.date_of_birth || null,
        gender: form.gender || null,
        session_id: form.session_id,
        class_id: form.class_id,
        section_id: form.section_id,
        subject_ids: form.subject_ids,
      })
      const name = form.full_name.trim()
      setSuccess(
        `${name} was added with admission number ${result.admission_number}. An invite email has been sent to ${form.email.trim()}.`,
      )
      setForm({ ...EMPTY_FORM, session_id: form.session_id })
      onAdded()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="panel form-grid" onSubmit={handleSubmit}>
      <h2>Add student</h2>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {success && <p className="alert alert-success" role="status">{success}</p>}

      <label>
        Full name
        <input value={form.full_name} onChange={(e) => update('full_name', e.target.value)} placeholder="Ada Grace Okafor" required />
      </label>
      <label>
        Student&apos;s email
        <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />
      </label>
      <p className="muted small form-note">
        Students need their own email address: it becomes their login. A parent&apos;s email can&apos;t be used.
      </p>

      <label>
        Date of birth
        <input type="date" value={form.date_of_birth} onChange={(e) => update('date_of_birth', e.target.value)} />
      </label>
      <label>
        Gender
        <select value={form.gender} onChange={(e) => update('gender', e.target.value)}>
          <option value="">Not specified</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
      </label>

      <label>
        Session
        <select value={form.session_id} onChange={(e) => update('session_id', e.target.value)} required>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.is_current ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        Class
        <select
          value={form.class_id}
          onChange={(e) => setForm((f) => ({ ...f, class_id: e.target.value, section_id: '' }))}
          required
        >
          <option value="">Choose a class</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Section
        <select value={form.section_id} onChange={(e) => update('section_id', e.target.value)} required disabled={!form.class_id}>
          <option value="">{form.class_id ? (formSections.length ? 'Choose a section' : 'This class has no sections') : 'Choose a class first'}</option>
          {formSections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="subject-checklist">
        <legend>Subjects (core and electives)</legend>
        {subjects.length === 0 ? (
          <p className="muted small">
            No subjects yet — <Link to="/admin/subjects">add subjects</Link> first, or add the student now and assign
            subjects later.
          </p>
        ) : (
          subjects.map((s) => (
            <label key={s.id} className="checkbox-field">
              <input type="checkbox" checked={form.subject_ids.includes(s.id)} onChange={() => toggleSubject(s.id)} />
              {s.name}
              {s.code ? ` (${s.code})` : ''}
            </label>
          ))
        )}
      </fieldset>

      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Adding…' : 'Add and send invite'}
        </button>
      </div>
    </form>
  )
}
