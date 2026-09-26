import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, TextInput } from '../../components/ui/Form'

const EMPTY_CLASS_FORM = { name: '', level: '' }
const CLASS_ERRORS = { unique: 'Another class already has that name or level.', check: 'Level must be 1 or more.' }
const SECTION_ERRORS = { unique: 'This class already has a section with that name.' }

async function fetchClassesWithSections() {
  const [classes, sections] = await Promise.all([
    run(supabase.from('classes').select('id, name, level').order('level')),
    run(supabase.from('sections').select('id, class_id, name').order('name')),
  ])
  return classes.map((c) => ({ ...c, sections: sections.filter((s) => s.class_id === c.id) }))
}

export default function ClassesSections() {
  const { data: classes, error: loadError, loading, reload } = useAsyncData(fetchClassesWithSections, 'classes')

  const [form, setForm] = useState(EMPTY_CLASS_FORM)
  const [editingId, setEditingId] = useState(null)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_CLASS_FORM)
    setFormError(null)
  }

  function startEdit(cls) {
    setEditingId(cls.id)
    setForm({ name: cls.name, level: String(cls.level) })
    setFormError(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)
    const values = { name: form.name.trim(), level: Number(form.level) }
    setSaving(true)
    try {
      if (editingId) {
        await runWrite(supabase.from('classes').update(values).eq('id', editingId).select('id'))
      } else {
        await run(supabase.from('classes').insert(values))
      }
      resetForm()
      reload()
    } catch (err) {
      setFormError(friendlyDbError(err, CLASS_ERRORS))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Classes & Sections"
        subtitle="Classes are levels (e.g. JSS1, level 1). Sections are the groups within a class (e.g. A, B). The level orders classes for promotion."
      />

      <Card title={editingId ? 'Edit class' : 'New class'}>
        <form onSubmit={handleSubmit}>
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="ds-form-grid">
            <Field label="Name">
              {(p) => <TextInput {...p} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="JSS1" required />}
            </Field>
            <Field label="Level">
              {(p) => (
                <TextInput
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={form.level}
                  onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                  placeholder="1"
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
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create class'}
            </Button>
          </div>
        </form>
      </Card>

      {loading ? (
        <LoadingState lines={4} />
      ) : loadError ? (
        <Alert tone="danger">{friendlyDbError(loadError)}</Alert>
      ) : classes.length === 0 ? (
        <Card>
          <EmptyState icon="grid">No classes yet — create one above to get started.</EmptyState>
        </Card>
      ) : (
        classes.map((cls) => (
          <ClassItem
            key={cls.id}
            cls={cls}
            editing={editingId === cls.id}
            onEdit={() => startEdit(cls)}
            onChanged={reload}
            onDeleted={() => {
              if (editingId === cls.id) resetForm()
              reload()
            }}
          />
        ))
      )}
    </>
  )
}

function ClassItem({ cls, editing, onEdit, onChanged, onDeleted }) {
  const [newSection, setNewSection] = useState('')
  const [sectionError, setSectionError] = useState(null)
  const [adding, setAdding] = useState(false)

  async function addSection(event) {
    event.preventDefault()
    setSectionError(null)
    setAdding(true)
    try {
      await run(supabase.from('sections').insert({ class_id: cls.id, name: newSection.trim() }))
      setNewSection('')
      onChanged()
    } catch (err) {
      setSectionError(friendlyDbError(err, SECTION_ERRORS))
    } finally {
      setAdding(false)
    }
  }

  const sectionCount = cls.sections.length

  return (
    <details className="ds-card ds-details">
      <summary>
        <span className="ds-details-title">
          <strong>{cls.name}</strong> <span className="ds-muted ds-small">level {cls.level}</span>
          {editing && <Badge tone="info">Editing</Badge>}
        </span>
        <span className="ds-muted ds-small">
          {sectionCount} {sectionCount === 1 ? 'section' : 'sections'}
        </span>
      </summary>

      <div className="ds-details-body">
        <div className="ds-row-actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="ds-btn ds-btn-link" onClick={onEdit}>
            Edit class
          </button>
          <DeleteAction
            itemName={`class ${cls.name}`}
            buttonClassName="ds-btn ds-btn-link ds-btn-link-danger"
            dependencyChecks={[
              { table: 'sections', column: 'class_id', value: cls.id, label: ['section (delete it first)', 'sections (delete them first)'] },
              { table: 'enrollments', column: 'class_id', value: cls.id, label: ['enrollment', 'enrollments'] },
              { table: 'fee_structures', column: 'class_id', value: cls.id, label: ['fee item', 'fee items'] },
              { table: 'announcements', column: 'class_id', value: cls.id, label: ['announcement', 'announcements'] },
            ]}
            onDelete={() => runWrite(supabase.from('classes').delete().eq('id', cls.id).select('id'))}
            onDeleted={onDeleted}
          />
        </div>

        {sectionCount === 0 ? (
          <p className="ds-note">No sections yet — add one below.</p>
        ) : (
          <ul className="ds-list">
            {cls.sections.map((section) => (
              <SectionItem key={section.id} cls={cls} section={section} onChanged={onChanged} />
            ))}
          </ul>
        )}

        <form className="ds-inline-form" onSubmit={addSection}>
          <TextInput
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
            placeholder="New section, e.g. A"
            aria-label={`New section name for ${cls.name}`}
            required
          />
          <Button type="submit" disabled={adding}>
            {adding ? 'Adding…' : 'Add section'}
          </Button>
        </form>
        {sectionError && <Alert tone="danger">{sectionError}</Alert>}
      </div>
    </details>
  )
}

function SectionItem({ cls, section, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(section.name)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save(event) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await runWrite(supabase.from('sections').update({ name: name.trim() }).eq('id', section.id).select('id'))
      setEditing(false)
      onChanged()
    } catch (err) {
      setError(friendlyDbError(err, SECTION_ERRORS))
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <li className="ds-list-item" style={{ display: 'block', paddingInline: 0 }}>
        <form className="ds-inline-form" onSubmit={save}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} aria-label="Section name" required autoFocus />
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setEditing(false)
              setName(section.name)
              setError(null)
            }}
          >
            Cancel
          </Button>
        </form>
        {error && <Alert tone="danger">{error}</Alert>}
      </li>
    )
  }

  return (
    <li className="ds-list-item" style={{ paddingInline: 0, alignItems: 'center' }}>
      <span className="ds-list-main">
        <strong>
          {cls.name} {section.name}
        </strong>
      </span>
      <span className="ds-row-actions">
        <button type="button" className="ds-btn ds-btn-link" onClick={() => setEditing(true)}>
          Rename
        </button>
        <DeleteAction
          itemName={`section ${cls.name} ${section.name}`}
          buttonClassName="ds-btn ds-btn-link ds-btn-link-danger"
          dependencyChecks={[
            { table: 'enrollments', column: 'section_id', value: section.id, label: ['enrollment', 'enrollments'] },
            { table: 'timetable_slots', column: 'section_id', value: section.id, label: ['timetable slot', 'timetable slots'] },
            { table: 'assignments', column: 'section_id', value: section.id, label: ['assignment', 'assignments'] },
          ]}
          onDelete={() => runWrite(supabase.from('sections').delete().eq('id', section.id).select('id'))}
          onDeleted={onChanged}
        />
      </span>
    </li>
  )
}
