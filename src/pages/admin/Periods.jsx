import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { formatTime } from '../../lib/format'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Checkbox, Field, TextInput } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'

const EMPTY_FORM = { name: '', start_time: '', end_time: '', is_break: false }
const ERRORS = {
  unique: 'Another period already has that name.',
  check: 'The end time must be after the start time.',
}

function fetchPeriods() {
  return run(supabase.from('periods').select('id, name, start_time, end_time, is_break').order('start_time'))
}

export default function Periods() {
  const { data: periods, error: loadError, loading, reload } = useAsyncData(fetchPeriods, 'periods')

  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  function startEdit(period) {
    setEditingId(period.id)
    setForm({
      name: period.name,
      start_time: formatTime(period.start_time),
      end_time: formatTime(period.end_time),
      is_break: period.is_break,
    })
    setFormError(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)
    const values = { ...form, name: form.name.trim() }
    if (values.end_time <= values.start_time) {
      setFormError(ERRORS.check)
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await runWrite(supabase.from('periods').update(values).eq('id', editingId).select('id'))
      } else {
        await run(supabase.from('periods').insert(values))
      }
      resetForm()
      reload()
    } catch (err) {
      setFormError(friendlyDbError(err, ERRORS))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Periods"
        subtitle="The fixed times of the school day. They become the rows of every timetable. Mark breaks so no lessons can be put in them."
      />

      <Card title={editingId ? 'Edit period' : 'New period'}>
        <form onSubmit={handleSubmit}>
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="ds-form-grid">
            <Field label="Name" className="ds-span-2">
              {(p) => <TextInput {...p} value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Period 1" required />}
            </Field>
            <Field label="Start time">
              {(p) => <TextInput {...p} type="time" value={form.start_time} onChange={(e) => update('start_time', e.target.value)} required />}
            </Field>
            <Field label="End time">
              {(p) => <TextInput {...p} type="time" value={form.end_time} onChange={(e) => update('end_time', e.target.value)} required />}
            </Field>
          </div>
          <Checkbox label="This is a break (no lessons)" checked={form.is_break} onChange={(e) => update('is_break', e.target.checked)} />
          <div className="ds-form-actions">
            {editingId && (
              <Button variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create period'}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="The school day" flush>
        {loading ? (
          <LoadingState lines={4} />
        ) : loadError ? (
          <div className="ds-card-body">
            <Alert tone="danger">{friendlyDbError(loadError)}</Alert>
          </div>
        ) : (
          <DataTable
            caption="Periods"
            rowKey={(p) => p.id}
            rows={periods}
            empty={<EmptyState icon="clock">No periods yet — create one above to get started.</EmptyState>}
            columns={[
              {
                key: 'name',
                header: 'Name',
                primary: true,
                render: (p) => (
                  <span className="ds-inline">
                    {p.name}
                    {editingId === p.id && <Badge tone="info">Editing</Badge>}
                  </span>
                ),
              },
              { key: 'start', header: 'Start', render: (p) => formatTime(p.start_time) },
              { key: 'end', header: 'End', render: (p) => formatTime(p.end_time) },
              { key: 'type', header: 'Type', render: (p) => (p.is_break ? <Badge tone="neutral">Break</Badge> : 'Lesson') },
              {
                key: 'actions',
                header: 'Actions',
                render: (period) => (
                  <div className="ds-row-actions">
                    <button type="button" className="ds-btn ds-btn-link" onClick={() => startEdit(period)}>
                      Edit
                    </button>
                    <DeleteAction
                      itemName={period.name}
                      buttonClassName="ds-btn ds-btn-link ds-btn-link-danger"
                      dependencyChecks={[
                        { table: 'timetable_slots', column: 'period_id', value: period.id, label: ['timetable slot', 'timetable slots'] },
                      ]}
                      onDelete={() => runWrite(supabase.from('periods').delete().eq('id', period.id).select('id'))}
                      onDeleted={() => {
                        if (editingId === period.id) resetForm()
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
