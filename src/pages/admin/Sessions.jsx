import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { formatDate } from '../../lib/format'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'

const EMPTY_FORM = { name: '', start_date: '', end_date: '' }
const ERRORS = { unique: 'A session with that name already exists.' }

function fetchSessions() {
  return run(
    supabase
      .from('sessions')
      .select('id, name, start_date, end_date, is_current')
      .order('start_date', { ascending: false }),
  )
}

export default function Sessions() {
  const { data: sessions, error: loadError, loading, reload } = useAsyncData(fetchSessions, 'sessions')

  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function startEdit(session) {
    setEditingId(session.id)
    setForm({ name: session.name, start_date: session.start_date, end_date: session.end_date })
    setFormError(null)
  }

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)
    const values = { ...form, name: form.name.trim() }
    if (values.end_date <= values.start_date) {
      setFormError('The end date must be after the start date.')
      return
    }

    setSaving(true)
    try {
      if (editingId) {
        await runWrite(supabase.from('sessions').update(values).eq('id', editingId).select('id'))
      } else {
        await run(supabase.from('sessions').insert(values))
      }
      resetForm()
      reload()
    } catch (err) {
      setFormError(friendlyDbError(err, ERRORS))
    } finally {
      setSaving(false)
    }
  }

  // Only one session can be current (the database enforces this), so clear
  // the old one before setting the new one.
  async function makeCurrent(session) {
    setBusyId(session.id)
    setActionError(null)
    try {
      await run(supabase.from('sessions').update({ is_current: false }).eq('is_current', true).neq('id', session.id))
      await runWrite(supabase.from('sessions').update({ is_current: true }).eq('id', session.id).select('id'))
      reload()
    } catch (err) {
      setActionError(friendlyDbError(err))
      reload()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <h1>Sessions</h1>
      <p className="muted">Academic years, e.g. 2026/2027. One session is marked as the current one.</p>

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h2>{editingId ? 'Edit session' : 'New session'}</h2>
        {formError && <p className="alert alert-error" role="alert">{formError}</p>}
        <label>
          Name
          <input value={form.name} onChange={(e) => updateField('name', e.target.value)} placeholder="2026/2027" required />
        </label>
        <label>
          Start date
          <input type="date" value={form.start_date} onChange={(e) => updateField('start_date', e.target.value)} required />
        </label>
        <label>
          End date
          <input type="date" value={form.end_date} onChange={(e) => updateField('end_date', e.target.value)} required />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create session'}
          </button>
          {editingId && (
            <button type="button" className="button-secondary" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {actionError && <p className="alert alert-error" role="alert">{actionError}</p>}

      {loading ? (
        <p className="muted">Loading sessions…</p>
      ) : loadError ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(loadError)}</p>
      ) : sessions.length === 0 ? (
        <p className="empty-state">No sessions yet — create one above to get started.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Start</th>
                <th>End</th>
                <th>Current</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className={editingId === session.id ? 'row-editing' : undefined}>
                  <td>{session.name}</td>
                  <td>{formatDate(session.start_date)}</td>
                  <td>{formatDate(session.end_date)}</td>
                  <td>
                    {session.is_current ? (
                      <span className="badge">Current</span>
                    ) : (
                      <button
                        type="button"
                        className="button-link"
                        onClick={() => makeCurrent(session)}
                        disabled={busyId !== null}
                      >
                        {busyId === session.id ? 'Updating…' : 'Make current'}
                      </button>
                    )}
                  </td>
                  <td className="row-actions">
                    <button type="button" className="button-link" onClick={() => startEdit(session)}>
                      Edit
                    </button>
                    <DeleteAction
                      itemName={`session ${session.name}`}
                      dependencyChecks={[
                        { table: 'terms', column: 'session_id', value: session.id, label: ['term', 'terms'] },
                        { table: 'enrollments', column: 'session_id', value: session.id, label: ['enrollment', 'enrollments'] },
                        { table: 'students', column: 'admission_session_id', value: session.id, label: ['student admitted in it', 'students admitted in it'] },
                        { table: 'id_cards', column: 'session_id', value: session.id, label: ['ID card', 'ID cards'] },
                      ]}
                      onDelete={() => runWrite(supabase.from('sessions').delete().eq('id', session.id).select('id'))}
                      onDeleted={() => {
                        if (editingId === session.id) resetForm()
                        reload()
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
