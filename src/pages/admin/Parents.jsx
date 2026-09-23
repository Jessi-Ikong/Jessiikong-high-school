import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { callFunction } from '../../lib/functions'
import { fullName, byName } from '../../lib/people'
import { useAsyncData } from '../../hooks/useAsyncData'
import ConfirmDialog from '../../components/ConfirmDialog'

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
      <h1>Parents</h1>
      <p className="muted">Parents and guardians, and the students they are linked to.</p>

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h2>Add parent</h2>
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        {success && <p className="alert alert-success" role="status">{success}</p>}
        <label>
          Full name
          <input
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            placeholder="Paul Okafor"
            required
          />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Sending invite…' : 'Add and send invite'}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="muted">Loading parents…</p>
      ) : loadError ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(loadError)}</p>
      ) : data.parents.length === 0 ? (
        <p className="empty-state">No parents yet — add one above.</p>
      ) : (
        <div className="card-list">
          {data.parents.map((parent) => (
            <ParentCard
              key={parent.id}
              parent={parent}
              students={data.students}
              linking={linkingParentId === parent.id}
              onStartLink={() => setLinkingParentId(parent.id)}
              onStopLink={() => setLinkingParentId(null)}
              onChanged={reload}
            />
          ))}
        </div>
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
    <div className="panel parent-card">
      <div className="parent-card-header">
        <div>
          <strong>{fullName(parent)}</strong>
          <div className="muted small">
            {parent.email}
            {parent.phone ? ` · ${parent.phone}` : ''}
          </div>
        </div>
        {!linking && (
          <button type="button" className="button-secondary" onClick={onStartLink}>
            Link student
          </button>
        )}
      </div>

      {children.length === 0 ? (
        <p className="muted small">Not linked to any students yet.</p>
      ) : (
        <ul className="section-list">
          {children.map((link) => (
            <li key={link.student_id}>
              <span>
                {fullName(link.students.users)} <span className="muted small">({link.students.admission_number})</span>
                {link.relationship && <span className="muted small"> · {link.relationship}</span>}
              </span>
              <button type="button" className="button-link danger" onClick={() => setUnlinking(link)}>
                Unlink
              </button>
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
            {fullName(parent)} will no longer see {fullName(unlinking.students.users)}&apos;s records. No other data is
            deleted.
          </p>
        </ConfirmDialog>
      )}
    </div>
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
    <div className="link-form">
      <div className="inline-form">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or admission number"
          aria-label="Search students"
          autoFocus
        />
        <select value={relationship} onChange={(e) => setRelationship(e.target.value)} aria-label="Relationship">
          {RELATIONSHIPS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button type="button" className="button-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {term && matches.length === 0 && <p className="muted small">No matching students.</p>}
      {matches.length > 0 && (
        <ul className="section-list">
          {matches.map((s) => (
            <li key={s.id}>
              <span>
                {fullName(s)} <span className="muted small">({s.admission_number})</span>
              </span>
              <button type="button" className="button-link" onClick={() => link(s)} disabled={busyId !== null}>
                {busyId === s.id ? 'Linking…' : `Link as ${relationship}`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
