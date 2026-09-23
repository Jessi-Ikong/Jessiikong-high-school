import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'

const EMPTY_FORM = { name: '', code: '' }
const ERRORS = { unique: 'Another subject already has that name or code.' }

function fetchSubjects() {
  return run(supabase.from('subjects').select('id, name, code').order('name'))
}

export default function Subjects() {
  const { data: subjects, error: loadError, loading, reload } = useAsyncData(fetchSubjects, 'subjects')

  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  function startEdit(subject) {
    setEditingId(subject.id)
    setForm({ name: subject.name, code: subject.code ?? '' })
    setFormError(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)
    // Code is optional; store "no code" as null so several subjects can lack one.
    const values = { name: form.name.trim(), code: form.code.trim().toUpperCase() || null }
    setSaving(true)
    try {
      if (editingId) {
        await runWrite(supabase.from('subjects').update(values).eq('id', editingId).select('id'))
      } else {
        await run(supabase.from('subjects').insert(values))
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
      <h1>Subjects</h1>
      <p className="muted">All subjects taught at the school. Codes are optional short names, e.g. MTH.</p>

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h2>{editingId ? 'Edit subject' : 'New subject'}</h2>
        {formError && <p className="alert alert-error" role="alert">{formError}</p>}
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Mathematics" required />
        </label>
        <label>
          Code (optional)
          <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="MTH" />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create subject'}
          </button>
          {editingId && (
            <button type="button" className="button-secondary" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <p className="muted">Loading subjects…</p>
      ) : loadError ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(loadError)}</p>
      ) : subjects.length === 0 ? (
        <p className="empty-state">No subjects yet — create one above to get started.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {subjects.map((subject) => (
                <tr key={subject.id} className={editingId === subject.id ? 'row-editing' : undefined}>
                  <td>{subject.name}</td>
                  <td>{subject.code ?? <span className="muted">—</span>}</td>
                  <td className="row-actions">
                    <button type="button" className="button-link" onClick={() => startEdit(subject)}>
                      Edit
                    </button>
                    <DeleteAction
                      itemName={subject.name}
                      dependencyChecks={[
                        { table: 'student_subjects', column: 'subject_id', value: subject.id, label: ['student taking it', 'students taking it'] },
                        { table: 'timetable_slots', column: 'subject_id', value: subject.id, label: ['timetable slot', 'timetable slots'] },
                        { table: 'assessment_components', column: 'subject_id', value: subject.id, label: ['assessment component', 'assessment components'] },
                        { table: 'scores', column: 'subject_id', value: subject.id, label: ['score', 'scores'] },
                        { table: 'assignments', column: 'subject_id', value: subject.id, label: ['assignment', 'assignments'] },
                      ]}
                      onDelete={() => runWrite(supabase.from('subjects').delete().eq('id', subject.id).select('id'))}
                      onDeleted={() => {
                        if (editingId === subject.id) resetForm()
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
