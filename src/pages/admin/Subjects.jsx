import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, TextInput } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'

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
      <PageHeader title="Subjects" subtitle="All subjects taught at the school. Codes are optional short names, e.g. MTH." />

      <Card title={editingId ? 'Edit subject' : 'New subject'}>
        <form onSubmit={handleSubmit}>
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="ds-form-grid">
            <Field label="Name">
              {(p) => <TextInput {...p} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Mathematics" required />}
            </Field>
            <Field label="Code" hint="Optional">
              {(p) => <TextInput {...p} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="MTH" />}
            </Field>
          </div>
          <div className="ds-form-actions">
            {editingId && (
              <Button variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create subject'}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="All subjects" flush>
        {loading ? (
          <LoadingState lines={4} />
        ) : loadError ? (
          <div className="ds-card-body">
            <Alert tone="danger">{friendlyDbError(loadError)}</Alert>
          </div>
        ) : (
          <DataTable
            caption="Subjects"
            rowKey={(s) => s.id}
            rows={subjects}
            empty={<EmptyState icon="book">No subjects yet — create one above to get started.</EmptyState>}
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
              { key: 'code', header: 'Code', render: (s) => s.code ?? <span className="ds-muted">—</span> },
              {
                key: 'actions',
                header: 'Actions',
                render: (subject) => (
                  <div className="ds-row-actions">
                    <button type="button" className="ds-btn ds-btn-link" onClick={() => startEdit(subject)}>
                      Edit
                    </button>
                    <DeleteAction
                      itemName={subject.name}
                      buttonClassName="ds-btn ds-btn-link ds-btn-link-danger"
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
