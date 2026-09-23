import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { formatTime } from '../../lib/format'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'

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
      <h1>Periods</h1>
      <p className="muted">
        The fixed times of the school day. They become the rows of every timetable. Mark breaks so no lessons can be
        put in them.
      </p>

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h2>{editingId ? 'Edit period' : 'New period'}</h2>
        {formError && <p className="alert alert-error" role="alert">{formError}</p>}
        <label>
          Name
          <input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Period 1" required />
        </label>
        <label>
          Start time
          <input type="time" value={form.start_time} onChange={(e) => update('start_time', e.target.value)} required />
        </label>
        <label>
          End time
          <input type="time" value={form.end_time} onChange={(e) => update('end_time', e.target.value)} required />
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={form.is_break} onChange={(e) => update('is_break', e.target.checked)} />
          This is a break (no lessons)
        </label>
        <div className="form-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create period'}
          </button>
          {editingId && (
            <button type="button" className="button-secondary" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <p className="muted">Loading periods…</p>
      ) : loadError ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(loadError)}</p>
      ) : periods.length === 0 ? (
        <p className="empty-state">No periods yet — create one above to get started.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Start</th>
                <th>End</th>
                <th>Type</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.id} className={editingId === period.id ? 'row-editing' : undefined}>
                  <td>{period.name}</td>
                  <td>{formatTime(period.start_time)}</td>
                  <td>{formatTime(period.end_time)}</td>
                  <td>{period.is_break ? <span className="badge badge-muted">Break</span> : 'Lesson'}</td>
                  <td className="row-actions">
                    <button type="button" className="button-link" onClick={() => startEdit(period)}>
                      Edit
                    </button>
                    <DeleteAction
                      itemName={period.name}
                      dependencyChecks={[
                        { table: 'timetable_slots', column: 'period_id', value: period.id, label: ['timetable slot', 'timetable slots'] },
                      ]}
                      onDelete={() => runWrite(supabase.from('periods').delete().eq('id', period.id).select('id'))}
                      onDeleted={() => {
                        if (editingId === period.id) resetForm()
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
