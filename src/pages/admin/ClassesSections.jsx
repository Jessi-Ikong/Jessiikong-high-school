import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'

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
      <h1>Classes &amp; Sections</h1>
      <p className="muted">
        Classes are levels (e.g. JSS1, level 1). Sections are the groups within a class (e.g. A, B). The level
        orders classes for promotion.
      </p>

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h2>{editingId ? 'Edit class' : 'New class'}</h2>
        {formError && <p className="alert alert-error" role="alert">{formError}</p>}
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="JSS1" required />
        </label>
        <label>
          Level
          <input
            type="number"
            min="1"
            step="1"
            value={form.level}
            onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
            placeholder="1"
            required
          />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create class'}
          </button>
          {editingId && (
            <button type="button" className="button-secondary" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <p className="muted">Loading classes…</p>
      ) : loadError ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(loadError)}</p>
      ) : classes.length === 0 ? (
        <p className="empty-state">No classes yet — create one above to get started.</p>
      ) : (
        <div className="class-list">
          {classes.map((cls) => (
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
          ))}
        </div>
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
    <details className={`class-item${editing ? ' row-editing' : ''}`}>
      <summary>
        <span className="class-title">
          {cls.name} <span className="muted small">level {cls.level}</span>
        </span>
        <span className="muted small">
          {sectionCount} {sectionCount === 1 ? 'section' : 'sections'}
        </span>
      </summary>

      <div className="class-body">
        <div className="row-actions">
          <button type="button" className="button-link" onClick={onEdit}>
            Edit class
          </button>
          <DeleteAction
            itemName={`class ${cls.name}`}
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
          <p className="muted small">No sections yet — add one below.</p>
        ) : (
          <ul className="section-list">
            {cls.sections.map((section) => (
              <SectionItem key={section.id} cls={cls} section={section} onChanged={onChanged} />
            ))}
          </ul>
        )}

        <form className="inline-form" onSubmit={addSection}>
          <input
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
            placeholder="New section, e.g. A"
            aria-label={`New section name for ${cls.name}`}
            required
          />
          <button type="submit" disabled={adding}>
            {adding ? 'Adding…' : 'Add section'}
          </button>
        </form>
        {sectionError && <p className="alert alert-error" role="alert">{sectionError}</p>}
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
      <li>
        <form className="inline-form" onSubmit={save}>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Section name" required autoFocus />
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setEditing(false)
              setName(section.name)
              setError(null)
            }}
          >
            Cancel
          </button>
        </form>
        {error && <p className="alert alert-error" role="alert">{error}</p>}
      </li>
    )
  }

  return (
    <li>
      <span>
        {cls.name} {section.name}
      </span>
      <span className="row-actions">
        <button type="button" className="button-link" onClick={() => setEditing(true)}>
          Rename
        </button>
        <DeleteAction
          itemName={`section ${cls.name} ${section.name}`}
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
