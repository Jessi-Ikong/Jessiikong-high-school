import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { formatDate } from '../../lib/format'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, TextInput } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'

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
      <PageHeader title="Sessions" subtitle="Academic years, e.g. 2026/2027. One session is marked as the current one." />

      <Card title={editingId ? 'Edit session' : 'New session'}>
        <form onSubmit={handleSubmit}>
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="ds-form-grid">
            <Field label="Name" className="ds-span-2">
              {(p) => <TextInput {...p} value={form.name} onChange={(e) => updateField('name', e.target.value)} placeholder="2026/2027" required />}
            </Field>
            <Field label="Start date">
              {(p) => <TextInput {...p} type="date" value={form.start_date} onChange={(e) => updateField('start_date', e.target.value)} required />}
            </Field>
            <Field label="End date">
              {(p) => <TextInput {...p} type="date" value={form.end_date} onChange={(e) => updateField('end_date', e.target.value)} required />}
            </Field>
          </div>
          <div className="ds-form-actions">
            {editingId && (
              <Button variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create session'}
            </Button>
          </div>
        </form>
      </Card>

      {actionError && <Alert tone="danger">{actionError}</Alert>}

      <Card title="All sessions" flush>
        {loading ? (
          <LoadingState lines={4} />
        ) : loadError ? (
          <div className="ds-card-body">
            <Alert tone="danger">{friendlyDbError(loadError)}</Alert>
          </div>
        ) : (
          <DataTable
            caption="Sessions"
            rowKey={(s) => s.id}
            rows={sessions}
            empty={<EmptyState icon="calendar">No sessions yet — create one above to get started.</EmptyState>}
            columns={[
              {
                key: 'name',
                header: 'Name',
                primary: true,
                render: (s) => (
                  <span className="ds-inline">
                    {s.name}
                    {editingId === s.id && <Badge tone="info">Editing</Badge>}
                  </span>
                ),
              },
              { key: 'start', header: 'Start', render: (s) => formatDate(s.start_date) },
              { key: 'end', header: 'End', render: (s) => formatDate(s.end_date) },
              {
                key: 'current',
                header: 'Current',
                render: (s) =>
                  s.is_current ? (
                    <Badge tone="success">Current</Badge>
                  ) : (
                    <button type="button" className="ds-btn ds-btn-link" onClick={() => makeCurrent(s)} disabled={busyId !== null}>
                      {busyId === s.id ? 'Updating…' : 'Make current'}
                    </button>
                  ),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (session) => (
                  <div className="ds-row-actions">
                    <button type="button" className="ds-btn ds-btn-link" onClick={() => startEdit(session)}>
                      Edit
                    </button>
                    <DeleteAction
                      itemName={`session ${session.name}`}
                      buttonClassName="ds-btn ds-btn-link ds-btn-link-danger"
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
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>
    </>
  )
}
