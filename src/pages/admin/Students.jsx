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
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Checkbox, Field, Select, TextInput } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'

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

  if (setup.loading) return <LoadingState lines={6} />
  if (setup.error) return <Alert tone="danger">{friendlyDbError(setup.error)}</Alert>

  const { sessions, classes } = setup.data
  if (sessions.length === 0 || classes.length === 0) {
    return (
      <>
        <PageHeader title="Students" />
        <Card>
          <EmptyState icon="users" title="Set up the school first">
            Before adding students, create at least one <Link to="/admin/sessions">session</Link> and one{' '}
            <Link to="/admin/classes">class with a section</Link>.
          </EmptyState>
        </Card>
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
      <PageHeader title="Students" subtitle="Students enrolled in the chosen session. Every new student gets an email invite to set their password." />

      <AddStudentForm setup={setup} defaultSessionId={defaultSession.id} onAdded={enrollments.reload} />

      <Card title={`Students · ${sessionName ?? ''}`} flush>
        <div className="ds-card-body">
          <div className="ds-filters">
            <Field label="Session">
              {(p) => (
                <Select {...p} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.is_current ? ' (current)' : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Class">
              {(p) => (
                <Select
                  {...p}
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
                </Select>
              )}
            </Field>
            <Field label="Section">
              {(p) => (
                <Select {...p} value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} disabled={!classFilter}>
                  <option value="">{classFilter ? 'All sections' : 'Choose a class first'}</option>
                  {filterSections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Status">
              {(p) => (
                <Select {...p} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Sort by">
              {(p) => (
                <Select {...p} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="name">Name (A–Z)</option>
                  <option value="admission">Admission number</option>
                </Select>
              )}
            </Field>
          </div>
          {!enrollments.loading && !enrollments.error && rows.length > 0 && (
            <p className="ds-count">
              {rows.length} {rows.length === 1 ? 'student' : 'students'}
            </p>
          )}
        </div>

        {enrollments.loading ? (
          <LoadingState lines={5} />
        ) : enrollments.error ? (
          <div className="ds-card-body">
            <Alert tone="danger">{friendlyDbError(enrollments.error)}</Alert>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="users">
            {enrollments.data.length === 0 ? `No students enrolled in ${sessionName} yet — add one above.` : 'No students match these filters.'}
          </EmptyState>
        ) : (
          <DataTable
            caption="Students"
            rowKey={(row) => row.id}
            rows={rows}
            columns={[
              {
                key: 'name',
                header: 'Name',
                primary: true,
                render: (row) => (
                  <span className="ds-inline">
                    {fullName(row.person)}
                    {!row.person.is_active && <Badge status="deactivated">Deactivated</Badge>}
                  </span>
                ),
              },
              { key: 'admission', header: 'Admission no.', render: (row) => row.student.admission_number },
              { key: 'class', header: 'Class', render: (row) => `${row.classes.name} ${row.sections.name}` },
              { key: 'status', header: 'Status', render: (row) => <Badge status={row.status} /> },
              { key: 'email', header: 'Email', render: (row) => row.person.email },
              { key: 'dob', header: 'Date of birth', render: (row) => formatDate(row.student.date_of_birth) || <span className="ds-muted">—</span> },
              {
                key: 'photo',
                header: 'Photo',
                render: (row) => (
                  <PhotoUpload userId={row.person.id} name={fullName(row.person)} path={row.person.photo_url} label="Change" onChanged={enrollments.reload} />
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) => (
                  <div className="ds-row-actions">
                    <button type="button" className="ds-btn ds-btn-link" onClick={() => setEditing({ kind: 'details', row })}>
                      Edit
                    </button>
                    {isCurrentSession && (
                      <button type="button" className="ds-btn ds-btn-link" onClick={() => setEditing({ kind: 'subjects', row })}>
                        Subjects
                      </button>
                    )}
                    <ActiveToggle
                      person={{ userId: row.person.id, name: fullName(row.person), role: 'student', is_active: row.person.is_active }}
                      onChanged={enrollments.reload}
                    />
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

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
    <Card title="Add student">
      <form onSubmit={handleSubmit}>
        {error && <Alert tone="danger">{error}</Alert>}
        {success && <Alert tone="success">{success}</Alert>}
        <div className="ds-form-grid">
          <Field label="Full name">
            {(p) => <TextInput {...p} value={form.full_name} onChange={(e) => update('full_name', e.target.value)} placeholder="Ada Grace Okafor" required />}
          </Field>
          <Field label="Student's email" hint="Students need their own email address: it becomes their login. A parent's email can't be used.">
            {(p) => <TextInput {...p} type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />}
          </Field>
          <Field label="Date of birth">
            {(p) => <TextInput {...p} type="date" value={form.date_of_birth} onChange={(e) => update('date_of_birth', e.target.value)} />}
          </Field>
          <Field label="Gender">
            {(p) => (
              <Select {...p} value={form.gender} onChange={(e) => update('gender', e.target.value)}>
                <option value="">Not specified</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </Select>
            )}
          </Field>
          <Field label="Session">
            {(p) => (
              <Select {...p} value={form.session_id} onChange={(e) => update('session_id', e.target.value)} required>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.is_current ? ' (current)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Class">
            {(p) => (
              <Select {...p} value={form.class_id} onChange={(e) => setForm((f) => ({ ...f, class_id: e.target.value, section_id: '' }))} required>
                <option value="">Choose a class</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Section">
            {(p) => (
              <Select {...p} value={form.section_id} onChange={(e) => update('section_id', e.target.value)} required disabled={!form.class_id}>
                <option value="">{form.class_id ? (formSections.length ? 'Choose a section' : 'This class has no sections') : 'Choose a class first'}</option>
                {formSections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <fieldset className="ds-fieldset">
          <legend className="ds-label">Subjects (core and electives)</legend>
          {subjects.length === 0 ? (
            <p className="ds-note">
              No subjects yet — <Link to="/admin/subjects">add subjects</Link> first, or add the student now and assign subjects later.
            </p>
          ) : (
            <div className="ds-checklist">
              {subjects.map((s) => (
                <Checkbox
                  key={s.id}
                  label={`${s.name}${s.code ? ` (${s.code})` : ''}`}
                  checked={form.subject_ids.includes(s.id)}
                  onChange={() => toggleSubject(s.id)}
                />
              ))}
            </div>
          )}
        </fieldset>

        <div className="ds-form-actions">
          <Button type="submit" disabled={saving}>
            {saving ? 'Adding…' : 'Add and send invite'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
