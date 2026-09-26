import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { callFunction } from '../../lib/functions'
import { fullName, byName } from '../../lib/people'
import { useAsyncData } from '../../hooks/useAsyncData'
import ConfirmDialog from '../../components/ConfirmDialog'
import { Alert, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, Select, TextInput } from '../../components/ui/Form'

const RELATIONSHIPS = ['mother', 'father', 'guardian', 'other']

async function fetchParentsAndStudents() {
  const [parents, students] = await Promise.all([
    run(
      supabase
        .from('parents')
        .select(
          'id, users(first_name, middle_name, last_name, email, phone), ' +
            'parent_students(student_id, relationship, students(admission_number, users(first_name, middle_name, last_name)))',
        ),
    ),
    run(supabase.from('students').select('id, admission_number, users(first_name, middle_name, last_name)')),
  ])
  return {
    parents: parents.map((p) => ({ ...p, ...p.users })).sort(byName),
    students: students.map((s) => ({ ...s, ...s.users })).sort(byName),
  }
}

export default function Parents() {
  const { data, error: loadError, loading, reload } = useAsyncData(fetchParentsAndStudents, 'parents')

  const [form, setForm] = useState({ full_name: '', email: '' })
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [saving, setSaving] = useState(false)
  const [linkingParentId, setLinkingParentId] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setSaving(true)
    try {
      await callFunction('invite-user', { role: 'parent', full_name: form.full_name, email: form.email })
      setSuccess(
        `${form.full_name.trim()} was added. An invite email has been sent to ${form.email.trim()}. Use "Link student" to connect them to their children.`,
      )
      setForm({ full_name: '', email: '' })
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="Parents" subtitle="Parents and guardians, and the students they are linked to." />

      <Card title="Add parent">
        <form onSubmit={handleSubmit}>
          {error && <Alert tone="danger">{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}
          <div className="ds-form-grid">
            <Field label="Full name">
              {(p) => (
                <TextInput
                  {...p}
                  value={form.full_name}
                  onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                  placeholder="Paul Okafor"
                  required
                />
              )}
            </Field>
            <Field label="Email">
              {(p) => <TextInput {...p} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />}
            </Field>
          </div>
          <div className="ds-form-actions">
            <Button type="submit" disabled={saving}>
              {saving ? 'Sending invite…' : 'Add and send invite'}
            </Button>
          </div>
        </form>
      </Card>

      {loading ? (
        <LoadingState lines={5} />
      ) : loadError ? (
        <Alert tone="danger">{friendlyDbError(loadError)}</Alert>
      ) : data.parents.length === 0 ? (
        <Card>
          <EmptyState icon="users">No parents yet — add one above.</EmptyState>
        </Card>
      ) : (
        data.parents.map((parent) => (
          <ParentCard
            key={parent.id}
            parent={parent}
            students={data.students}
            linking={linkingParentId === parent.id}
            onStartLink={() => setLinkingParentId(parent.id)}
            onStopLink={() => setLinkingParentId(null)}
            onChanged={reload}
          />
        ))
      )}
    </>
  )
}

function ParentCard({ parent, students, linking, onStartLink, onStopLink, onChanged }) {
  const [unlinking, setUnlinking] = useState(null) // the link being removed
  const [unlinkBusy, setUnlinkBusy] = useState(false)
  const [unlinkError, setUnlinkError] = useState(null)

  const children = [...parent.parent_students].sort((a, b) => byName(a.students.users, b.students.users))

  async function confirmUnlink() {
    setUnlinkBusy(true)
    setUnlinkError(null)
    try {
      await runWrite(
        supabase
          .from('parent_students')
          .delete()
          .eq('parent_id', parent.id)
          .eq('student_id', unlinking.student_id)
          .select('parent_id'),
      )
      setUnlinking(null)
      onChanged()
    } catch (err) {
      setUnlinkError(friendlyDbError(err))
    } finally {
      setUnlinkBusy(false)
    }
  }

  return (
    <Card
      title={fullName(parent)}
      flush
      action={
        !linking && (
          <Button variant="secondary" size="sm" onClick={onStartLink}>
            Link student
          </Button>
        )
      }
    >
      <p className="ds-note ds-card-body" style={{ paddingBottom: 0 }}>
        {parent.email}
        {parent.phone ? ` · ${parent.phone}` : ''}
      </p>
      {children.length === 0 ? (
        <p className="ds-note ds-card-body">Not linked to any students yet.</p>
      ) : (
        <ul className="ds-list">
          {children.map((link) => (
            <li key={link.student_id} className="ds-list-item">
              <span className="ds-list-main">
                <strong>{fullName(link.students.users)}</strong>
                <span className="ds-list-meta">
                  {link.students.admission_number}
                  {link.relationship ? ` · ${link.relationship}` : ''}
                </span>
              </span>
              <span className="ds-list-action">
                <button type="button" className="ds-btn ds-btn-link ds-btn-link-danger" onClick={() => setUnlinking(link)}>
                  Unlink
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {linking && (
        <LinkStudentForm
          parent={parent}
          students={students}
          alreadyLinked={children.map((c) => c.student_id)}
          onDone={() => {
            onStopLink()
            onChanged()
          }}
          onCancel={onStopLink}
        />
      )}

      {unlinking && (
        <ConfirmDialog
          title="Unlink student?"
          confirmLabel="Unlink"
          danger
          busy={unlinkBusy}
          error={unlinkError}
          onConfirm={confirmUnlink}
          onCancel={() => {
            setUnlinking(null)
            setUnlinkError(null)
          }}
        >
          <p>
            {fullName(parent)} will no longer see {fullName(unlinking.students.users)}&apos;s records. No other data is deleted.
          </p>
        </ConfirmDialog>
      )}
    </Card>
  )
}

function LinkStudentForm({ parent, students, alreadyLinked, onDone, onCancel }) {
  const [search, setSearch] = useState('')
  const [relationship, setRelationship] = useState('guardian')
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const term = search.trim().toLowerCase()
  const matches = term
    ? students
        .filter((s) => !alreadyLinked.includes(s.id))
        .filter((s) => fullName(s).toLowerCase().includes(term) || s.admission_number.toLowerCase().includes(term))
        .slice(0, 10)
    : []

  async function link(student) {
    setBusyId(student.id)
    setError(null)
    try {
      await run(supabase.from('parent_students').insert({ parent_id: parent.id, student_id: student.id, relationship }))
      onDone()
    } catch (err) {
      setError(friendlyDbError(err, { unique: 'This parent is already linked to that student.' }))
      setBusyId(null)
    }
  }

  return (
    <div className="ds-card-body" style={{ borderTop: '1px solid var(--ds-border)' }}>
      <div className="ds-filters">
        <Field label="Find a student">
          {(p) => (
            <TextInput {...p} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or admission number" autoFocus />
          )}
        </Field>
        <Field label="Relationship">
          {(p) => (
            <Select {...p} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {term && matches.length === 0 && <p className="ds-note">No matching students.</p>}
      {matches.length > 0 && (
        <ul className="ds-list">
          {matches.map((s) => (
            <li key={s.id} className="ds-list-item" style={{ paddingInline: 0 }}>
              <span className="ds-list-main">
                <strong>{fullName(s)}</strong>
                <span className="ds-list-meta">{s.admission_number}</span>
              </span>
              <span className="ds-list-action">
                <button type="button" className="ds-btn ds-btn-link" onClick={() => link(s)} disabled={busyId !== null}>
                  {busyId === s.id ? 'Linking…' : `Link as ${relationship}`}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="ds-form-actions">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
