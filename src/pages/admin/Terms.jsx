import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { formatDate } from '../../lib/format'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, Select, TextInput } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'

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

  if (sessionsQuery.loading) return <LoadingState lines={5} />
  if (sessionsQuery.error) {
    return <Alert tone="danger">{friendlyDbError(sessionsQuery.error)}</Alert>
  }

  const terms = termsQuery.data ?? []
  const currentTerm = currentTermQuery.data

  return (
    <>
      <PageHeader
        title="Terms"
        subtitle={
          <>
            The terms within each session. Only one term in the whole school is marked as current
            {currentTerm ? (
              <>
                {' '}(now: <strong>{currentTerm.name}, {currentTerm.sessions.name}</strong>).
              </>
            ) : (
              ' (none is set yet).'
            )}
          </>
        }
      />

      {sessions.length === 0 ? (
        <Card>
          <EmptyState icon="calendar">
            No sessions yet. <Link to="/admin/sessions">Create a session</Link> first, then add its terms here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="ds-filters">
            <Field label="Session">
              {(p) => (
                <Select {...p} value={sessionId} onChange={(e) => chooseSession(e.target.value)}>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.is_current ? ' (current)' : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Card title={editingId ? 'Edit term' : `New term in ${session.name}`}>
            <form onSubmit={handleSubmit}>
              {formError && <Alert tone="danger">{formError}</Alert>}
              <div className="ds-form-grid">
                <Field label="Term number">
                  {(p) => (
                    <Select {...p} value={form.term_number} onChange={(e) => changeTermNumber(e.target.value)}>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                    </Select>
                  )}
                </Field>
                <Field label="Name">
                  {(p) => <TextInput {...p} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />}
                </Field>
                <Field label="Start date">
                  {(p) => (
                    <TextInput
                      {...p}
                      type="date"
                      value={form.start_date}
                      min={session.start_date}
                      max={session.end_date}
                      onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                      required
                    />
                  )}
                </Field>
                <Field label="End date">
                  {(p) => (
                    <TextInput
                      {...p}
                      type="date"
                      value={form.end_date}
                      min={session.start_date}
                      max={session.end_date}
                      onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                      required
                    />
                  )}
                </Field>
              </div>
              <div className="ds-form-actions">
                {editingId && (
                  <Button variant="secondary" onClick={resetForm}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create term'}
                </Button>
              </div>
            </form>
          </Card>

          {actionError && <Alert tone="danger">{actionError}</Alert>}

          <Card title={`Terms in ${session.name}`} flush>
            {termsQuery.loading ? (
              <LoadingState lines={3} />
            ) : termsQuery.error ? (
              <div className="ds-card-body">
                <Alert tone="danger">{friendlyDbError(termsQuery.error)}</Alert>
              </div>
            ) : (
              <DataTable
                caption={`Terms in ${session.name}`}
                rowKey={(t) => t.id}
                rows={terms}
                empty={<EmptyState icon="calendar">No terms in {session.name} yet — create the first one above.</EmptyState>}
                columns={[
                  {
                    key: 'name',
                    header: 'Name',
                    primary: true,
                    render: (t) => (
                      <span className="ds-inline">
                        {t.name}
                        {editingId === t.id && <Badge tone="info">Editing</Badge>}
                      </span>
                    ),
                  },
                  { key: 'term_number', header: '#', numeric: true },
                  { key: 'start', header: 'Start', render: (t) => formatDate(t.start_date) },
                  { key: 'end', header: 'End', render: (t) => formatDate(t.end_date) },
                  {
                    key: 'current',
                    header: 'Current',
                    render: (term) =>
                      term.is_current ? (
                        <Badge tone="success">Current</Badge>
                      ) : (
                        <button type="button" className="ds-btn ds-btn-link" onClick={() => makeCurrent(term)} disabled={busyId !== null}>
                          {busyId === term.id ? 'Updating…' : 'Make current'}
                        </button>
                      ),
                  },
                  {
                    key: 'actions',
                    header: 'Actions',
                    render: (term) => (
                      <div className="ds-row-actions">
                        <button type="button" className="ds-btn ds-btn-link" onClick={() => startEdit(term)}>
                          Edit
                        </button>
                        <DeleteAction
                          itemName={`${term.name} (${session.name})`}
                          buttonClassName="ds-btn ds-btn-link ds-btn-link-danger"
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
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </>
      )}
    </>
  )
}
