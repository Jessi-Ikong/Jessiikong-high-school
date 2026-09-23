import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'
import ConfirmDialog from '../../components/ConfirmDialog'
import { weightTotal } from '../../lib/grading'

const EMPTY_FORM = { name: '', max_score: '', weight: '' }
const ERRORS = {
  unique: 'This subject already has a component with that name this term.',
  check: 'Max score must be more than 0, and weight between 0 and 100.',
}
const DEFAULT_COMPONENTS = [
  { name: 'CA', max_score: 30, weight: 30, sort_order: 1 },
  { name: 'Exam', max_score: 70, weight: 70, sort_order: 2 },
]

async function fetchSetup() {
  const [terms, subjects] = await Promise.all([
    run(supabase.from('terms').select('id, name, is_current, start_date, sessions(name)').order('start_date', { ascending: false })),
    run(supabase.from('subjects').select('id, name, code').order('name')),
  ])
  return { terms, subjects }
}

export default function AssessmentComponents() {
  const setup = useAsyncData(fetchSetup, 'assessment-setup')

  if (setup.loading) return <p className="muted">Loading…</p>
  if (setup.error) return <p className="alert alert-error" role="alert">{friendlyDbError(setup.error)}</p>

  const { terms, subjects } = setup.data
  if (terms.length === 0 || subjects.length === 0) {
    return (
      <>
        <h1>Assessment components</h1>
        <p className="empty-state">
          Create at least one <Link to="/admin/terms">term</Link> and some <Link to="/admin/subjects">subjects</Link>{' '}
          first.
        </p>
      </>
    )
  }
  return <ComponentsEditor terms={terms} subjects={subjects} />
}

function ComponentsEditor({ terms, subjects }) {
  const [chosenTermId, setChosenTermId] = useState(null)
  const [chosenSubjectId, setChosenSubjectId] = useState(null)
  const term = terms.find((t) => t.id === chosenTermId) ?? terms.find((t) => t.is_current) ?? terms[0]
  const subject = subjects.find((s) => s.id === chosenSubjectId) ?? subjects[0]

  // All components for the term (every subject), for the overview and the editor.
  const componentsQuery = useAsyncData(
    () =>
      run(
        supabase
          .from('assessment_components')
          .select('id, subject_id, name, max_score, weight, sort_order')
          .eq('term_id', term.id)
          .order('sort_order')
          .order('name'),
      ),
    `components:${term.id}`,
  )
  const [bulkOpen, setBulkOpen] = useState(false)
  const [notice, setNotice] = useState(null)

  const all = componentsQuery.data ?? []
  const bySubject = (subjectId) => all.filter((c) => c.subject_id === subjectId)
  const unconfigured = subjects.filter((s) => bySubject(s.id).length === 0)

  return (
    <>
      <h1>Assessment components</h1>
      <p className="muted">
        How each subject is graded per term, e.g. CA 30% + Exam 70%. The weights for a subject must add up to exactly
        100% before teachers can enter scores for it, and before it counts in the class ranking.
      </p>

      <div className="filter-bar">
        <label className="inline-field">
          Term
          <select
            value={term.id}
            onChange={(e) => {
              setChosenTermId(e.target.value)
              setNotice(null)
            }}
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}, {t.sessions.name}
                {t.is_current ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          Subject
          <select value={subject.id} onChange={(e) => setChosenSubjectId(e.target.value)}>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {notice && <p className="alert alert-success" role="status">{notice}</p>}

      {componentsQuery.loading ? (
        <p className="muted">Loading components…</p>
      ) : componentsQuery.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(componentsQuery.error)}</p>
      ) : (
        <>
          <SubjectComponents
            key={`${term.id}:${subject.id}`}
            term={term}
            subject={subject}
            components={bySubject(subject.id)}
            onChanged={() => {
              setNotice(null)
              componentsQuery.reload()
            }}
          />

          <h2>All subjects in {term.name}, {term.sessions.name}</h2>
          <div className="toolbar">
            <button type="button" className="button-secondary" onClick={() => setBulkOpen(true)} disabled={unconfigured.length === 0}>
              Apply default (CA 30%, Exam 70%) to all subjects for this term
            </button>
            {unconfigured.length === 0 && <span className="muted small">Every subject already has components.</span>}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Components</th>
                  <th>Total weight</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {subjects.map((s) => {
                  const list = bySubject(s.id)
                  const total = weightTotal(list)
                  return (
                    <tr key={s.id} className={s.id === subject.id ? 'row-editing' : undefined}>
                      <td>{s.name}</td>
                      <td>{list.length === 0 ? <span className="muted">—</span> : list.map((c) => `${c.name} ${Number(c.weight)}%`).join(', ')}</td>
                      <td>{list.length === 0 ? <span className="muted">—</span> : `${total}%`}</td>
                      <td>
                        {list.length === 0 ? (
                          <span className="badge badge-muted">Not set up</span>
                        ) : total === 100 ? (
                          <span className="badge">Complete</span>
                        ) : (
                          <span className="badge badge-warning">Incomplete</span>
                        )}
                      </td>
                      <td className="row-actions">
                        <button type="button" className="button-link" onClick={() => setChosenSubjectId(s.id)}>
                          Configure
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {bulkOpen && (
            <BulkDefaultDialog
              term={term}
              subjects={unconfigured}
              configuredCount={subjects.length - unconfigured.length}
              onClose={() => setBulkOpen(false)}
              onDone={(count) => {
                setBulkOpen(false)
                setNotice(`Default CA 30% / Exam 70% added to ${count} ${count === 1 ? 'subject' : 'subjects'}.`)
                componentsQuery.reload()
              }}
            />
          )}
        </>
      )}
    </>
  )
}

function SubjectComponents({ term, subject, components, onChanged }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  const total = weightTotal(components)

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  function startEdit(component) {
    setEditingId(component.id)
    setForm({ name: component.name, max_score: String(Number(component.max_score)), weight: String(Number(component.weight)) })
    setFormError(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)
    const values = { name: form.name.trim(), max_score: Number(form.max_score), weight: Number(form.weight) }
    if (!(values.max_score > 0) || !(values.weight > 0 && values.weight <= 100)) {
      setFormError(ERRORS.check)
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await runWrite(supabase.from('assessment_components').update(values).eq('id', editingId).select('id'))
      } else {
        await run(
          supabase.from('assessment_components').insert({
            ...values,
            term_id: term.id,
            subject_id: subject.id,
            sort_order: components.length + 1,
          }),
        )
      }
      resetForm()
      onChanged()
    } catch (err) {
      setFormError(friendlyDbError(err, ERRORS))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel">
      <h2>
        {subject.name} — {term.name}, {term.sessions.name}
      </h2>

      {components.length === 0 ? (
        <p className="empty-state">
          No components yet for {subject.name} this term. Add them below, or use the default button further down.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Max score</th>
                <th>Weight</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {components.map((c) => (
                <tr key={c.id} className={editingId === c.id ? 'row-editing' : undefined}>
                  <td>{c.name}</td>
                  <td>{Number(c.max_score)}</td>
                  <td>{Number(c.weight)}%</td>
                  <td className="row-actions">
                    <button type="button" className="button-link" onClick={() => startEdit(c)}>
                      Edit
                    </button>
                    <DeleteAction
                      itemName={`${c.name} (${subject.name}, ${term.name})`}
                      dependencyChecks={[{ table: 'scores', column: 'component_id', value: c.id, label: ['score', 'scores'] }]}
                      onDelete={() => runWrite(supabase.from('assessment_components').delete().eq('id', c.id).select('id'))}
                      onDeleted={() => {
                        if (editingId === c.id) resetForm()
                        onChanged()
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className={`weight-total ${total === 100 ? 'is-complete' : 'is-incomplete'}`} role="status">
        Total weight: <strong>{total}%</strong>
        {total === 100
          ? ' — complete. Teachers can enter scores for this subject.'
          : components.length === 0
            ? ''
            : ` — must be exactly 100%. Until it is, teachers can't enter ${subject.name} scores and it won't count in the class ranking.`}
      </p>

      <form className="form-grid" onSubmit={handleSubmit}>
        <h3>{editingId ? 'Edit component' : 'Add component'}</h3>
        {formError && <p className="alert alert-error" role="alert">{formError}</p>}
        <label>
          Name
          <input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="e.g. CA, Exam, Project" required />
        </label>
        <label>
          Max score
          <input type="number" min="0.5" step="any" value={form.max_score} onChange={(e) => update('max_score', e.target.value)} placeholder="30" required />
        </label>
        <label>
          Weight (%)
          <input type="number" min="0.5" max="100" step="any" value={form.weight} onChange={(e) => update('weight', e.target.value)} placeholder="30" required />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add component'}
          </button>
          {editingId && (
            <button type="button" className="button-secondary" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </section>
  )
}

function BulkDefaultDialog({ term, subjects, configuredCount, onClose, onDone }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      // One insert = all or nothing.
      await run(
        supabase.from('assessment_components').insert(
          subjects.flatMap((s) => DEFAULT_COMPONENTS.map((d) => ({ ...d, term_id: term.id, subject_id: s.id }))),
        ),
      )
      onDone(subjects.length)
    } catch (err) {
      setError(friendlyDbError(err, ERRORS))
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      title="Apply the default grading?"
      confirmLabel="Apply default"
      busy={busy}
      error={error}
      onConfirm={apply}
      onCancel={onClose}
    >
      <p>
        Add <strong>CA (max 30, 30%)</strong> and <strong>Exam (max 70, 70%)</strong> to the {subjects.length}{' '}
        {subjects.length === 1 ? 'subject' : 'subjects'} with no components in {term.name}, {term.sessions.name}:
      </p>
      <p className="muted small">{subjects.map((s) => s.name).join(', ')}</p>
      {configuredCount > 0 && (
        <p className="muted small">
          The {configuredCount} {configuredCount === 1 ? 'subject that already has' : 'subjects that already have'}{' '}
          components will not be changed.
        </p>
      )}
    </ConfirmDialog>
  )
}
