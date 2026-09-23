import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { formatDate } from '../../lib/format'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'

const TERM_NAMES = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' }
const EMPTY_FORM = { term_number: '1', name: TERM_NAMES[1], start_date: '', end_date: '' }
const ERRORS = { unique: 'This session already has a term with that number or name.' }

function fetchSessions() {
  return run(
    supabase
      .from('sessions')
      .select('id, name, start_date, end_date, is_current')
      .order('start_date', { ascending: false }),
  )
}

// The current term can be in any session (only one exists school-wide).
function fetchCurrentTerm() {
  return run(supabase.from('terms').select('id, name, sessions(name)').eq('is_current', true).maybeSingle())
}

export default function Terms() {
  const sessionsQuery = useAsyncData(fetchSessions, 'sessions')
  const currentTermQuery = useAsyncData(fetchCurrentTerm, 'current-term')
  const sessions = sessionsQuery.data ?? []

  // Default to the current session, else the newest one.
  const [chosenSessionId, setChosenSessionId] = useState(null)
  const defaultSession = sessions.find((s) => s.is_current) ?? sessions[0]
  const session = sessions.find((s) => s.id === chosenSessionId) ?? defaultSession
  const sessionId = session?.id ?? null

  const termsQuery = useAsyncData(
    () =>
      sessionId
        ? run(
            supabase
              .from('terms')
              .select('id, name, term_number, start_date, end_date, is_current')
              .eq('session_id', sessionId)
              .order('term_number'),
          )
        : Promise.resolve([]),
    `terms:${sessionId}`,
  )

  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  function reloadAll() {
    termsQuery.reload()
    currentTermQuery.reload()
  }

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  function chooseSession(id) {
    setChosenSessionId(id)
    resetForm()
    setActionError(null)
  }

  function changeTermNumber(value) {
    // Keep the suggested name in step unless the admin typed their own.
    setForm((f) => ({
      ...f,
      term_number: value,
      name: Object.values(TERM_NAMES).includes(f.name) || f.name === '' ? TERM_NAMES[value] : f.name,
    }))
  }

  function startEdit(term) {
    setEditingId(term.id)
    setForm({
      term_number: String(term.term_number),
      name: term.name,
      start_date: term.start_date,
      end_date: term.end_date,
    })
    setFormError(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)
    const values = {
      name: form.name.trim(),
      term_number: Number(form.term_number),
      start_date: form.start_date,
      end_date: form.end_date,
    }
    if (values.end_date <= values.start_date) {
      setFormError('The end date must be after the start date.')
      return
    }
    if (values.start_date < session.start_date || values.end_date > session.end_date) {
      setFormError(
        `The term must fall within the session (${formatDate(session.start_date)} to ${formatDate(session.end_date)}).`,
      )
      return
    }

    setSaving(true)
    try {
      if (editingId) {
        await runWrite(supabase.from('terms').update(values).eq('id', editingId).select('id'))
      } else {
        await run(supabase.from('terms').insert({ ...values, session_id: sessionId }))
      }
      resetForm()
      termsQuery.reload()
    } catch (err) {
      setFormError(friendlyDbError(err, ERRORS))
    } finally {
      setSaving(false)
    }
  }

  // Only ONE term can be current across the whole school (database rule),
  // so clear whichever term is current, in any session, first.
  async function makeCurrent(term) {
    setBusyId(term.id)
    setActionError(null)
    try {
      await run(supabase.from('terms').update({ is_current: false }).eq('is_current', true).neq('id', term.id))
      await runWrite(supabase.from('terms').update({ is_current: true }).eq('id', term.id).select('id'))
    } catch (err) {
      setActionError(friendlyDbError(err))
    } finally {
      setBusyId(null)
      reloadAll()
    }
  }

  if (sessionsQuery.loading) return <p className="muted">Loading sessions…</p>
  if (sessionsQuery.error) {
    return <p className="alert alert-error" role="alert">{friendlyDbError(sessionsQuery.error)}</p>
  }

  const terms = termsQuery.data ?? []
  const currentTerm = currentTermQuery.data

  return (
    <>
      <h1>Terms</h1>
      <p className="muted">
        The terms within each session. Only one term in the whole school is marked as current
        {currentTerm ? (
          <>
            {' '}(now: <strong>{currentTerm.name}, {currentTerm.sessions.name}</strong>).
          </>
        ) : (
          ' (none is set yet).'
        )}
      </p>

      {sessions.length === 0 ? (
        <p className="empty-state">
          No sessions yet. <Link to="/admin/sessions">Create a session</Link> first, then add its terms here.
        </p>
      ) : (
        <>
          <label className="inline-field">
            Session
            <select value={sessionId} onChange={(e) => chooseSession(e.target.value)}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.is_current ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </label>

          <form className="panel form-grid" onSubmit={handleSubmit}>
            <h2>{editingId ? 'Edit term' : `New term in ${session.name}`}</h2>
            {formError && <p className="alert alert-error" role="alert">{formError}</p>}
            <label>
              Term number
              <select value={form.term_number} onChange={(e) => changeTermNumber(e.target.value)}>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </label>
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </label>
            <label>
              Start date
              <input
                type="date"
                value={form.start_date}
                min={session.start_date}
                max={session.end_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                required
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={form.end_date}
                min={session.start_date}
                max={session.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                required
              />
            </label>
            <div className="form-actions">
              <button type="submit" disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create term'}
              </button>
              {editingId && (
                <button type="button" className="button-secondary" onClick={resetForm}>
                  Cancel
                </button>
              )}
            </div>
          </form>

          {actionError && <p className="alert alert-error" role="alert">{actionError}</p>}

          {termsQuery.loading ? (
            <p className="muted">Loading terms…</p>
          ) : termsQuery.error ? (
            <p className="alert alert-error" role="alert">{friendlyDbError(termsQuery.error)}</p>
          ) : terms.length === 0 ? (
            <p className="empty-state">No terms in {session.name} yet — create the first one above.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Current</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {terms.map((term) => (
                    <tr key={term.id} className={editingId === term.id ? 'row-editing' : undefined}>
                      <td>{term.term_number}</td>
                      <td>{term.name}</td>
                      <td>{formatDate(term.start_date)}</td>
                      <td>{formatDate(term.end_date)}</td>
                      <td>
                        {term.is_current ? (
                          <span className="badge">Current</span>
                        ) : (
                          <button
                            type="button"
                            className="button-link"
                            onClick={() => makeCurrent(term)}
                            disabled={busyId !== null}
                          >
                            {busyId === term.id ? 'Updating…' : 'Make current'}
                          </button>
                        )}
                      </td>
                      <td className="row-actions">
                        <button type="button" className="button-link" onClick={() => startEdit(term)}>
                          Edit
                        </button>
                        <DeleteAction
                          itemName={`${term.name} (${session.name})`}
                          dependencyChecks={[
                            { table: 'timetable_slots', column: 'term_id', value: term.id, label: ['timetable slot', 'timetable slots'] },
                            { table: 'assessment_components', column: 'term_id', value: term.id, label: ['assessment component', 'assessment components'] },
                            { table: 'scores', column: 'term_id', value: term.id, label: ['score', 'scores'] },
                            { table: 'assignments', column: 'term_id', value: term.id, label: ['assignment', 'assignments'] },
                            { table: 'fee_structures', column: 'term_id', value: term.id, label: ['fee item', 'fee items'] },
                            { table: 'invoices', column: 'term_id', value: term.id, label: ['invoice', 'invoices'] },
                          ]}
                          onDelete={() => runWrite(supabase.from('terms').delete().eq('id', term.id).select('id'))}
                          onDeleted={() => {
                            if (editingId === term.id) resetForm()
                            reloadAll()
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
      )}
    </>
  )
}
