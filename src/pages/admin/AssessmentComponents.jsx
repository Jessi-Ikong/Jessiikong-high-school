import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'
import ConfirmDialog from '../../components/ConfirmDialog'
import { weightTotal } from '../../lib/grading'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, Select, TextInput } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'

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

  if (setup.loading) return <LoadingState lines={6} />
  if (setup.error) return <Alert tone="danger">{friendlyDbError(setup.error)}</Alert>

  const { terms, subjects } = setup.data
  if (terms.length === 0 || subjects.length === 0) {
    return (
      <>
        <PageHeader title="Assessment components" />
        <Card>
          <EmptyState icon="chart" title="A few things first">
            Create at least one <Link to="/admin/terms">term</Link> and some <Link to="/admin/subjects">subjects</Link> first.
          </EmptyState>
        </Card>
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
      <PageHeader
        title="Assessment components"
        subtitle="How each subject is graded per term, e.g. CA 30% + Exam 70%. The weights for a subject must add up to exactly 100% before teachers can enter scores for it, and before it counts in the class ranking."
      />

      <div className="ds-filters">
        <Field label="Term">
          {(p) => (
            <Select
              {...p}
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
            </Select>
          )}
        </Field>
        <Field label="Subject">
          {(p) => (
            <Select {...p} value={subject.id} onChange={(e) => setChosenSubjectId(e.target.value)}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}

      {componentsQuery.loading ? (
        <LoadingState lines={5} />
      ) : componentsQuery.error ? (
        <Alert tone="danger">{friendlyDbError(componentsQuery.error)}</Alert>
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

          <Card title={`All subjects in ${term.name}, ${term.sessions.name}`} flush>
            <div className="ds-card-body">
              <div className="ds-inline">
                <Button variant="secondary" onClick={() => setBulkOpen(true)} disabled={unconfigured.length === 0}>
                  Apply default (CA 30%, Exam 70%) to all subjects for this term
                </Button>
                {unconfigured.length === 0 && <span className="ds-muted ds-small">Every subject already has components.</span>}
              </div>
            </div>
            <DataTable
              caption={`Grading setup for all subjects in ${term.name}`}
              rowKey={(s) => s.id}
              rows={subjects}
              columns={[
                {
                  key: 'subject',
                  header: 'Subject',
                  primary: true,
                  render: (s) => (
                    <span className="ds-inline">
                      {s.name}
                      {s.id === subject.id && <Badge status="editing">Selected</Badge>}
                    </span>
                  ),
                },
                {
                  key: 'components',
                  header: 'Components',
                  render: (s) => {
                    const list = bySubject(s.id)
                    return list.length === 0 ? <span className="ds-muted">—</span> : list.map((c) => `${c.name} ${Number(c.weight)}%`).join(', ')
                  },
                },
                {
                  key: 'total',
                  header: 'Total weight',
                  render: (s) => {
                    const list = bySubject(s.id)
                    return list.length === 0 ? <span className="ds-muted">—</span> : `${weightTotal(list)}%`
                  },
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (s) => {
                    const list = bySubject(s.id)
                    return list.length === 0 ? (
                      <Badge status="not set up">Not set up</Badge>
                    ) : weightTotal(list) === 100 ? (
                      <Badge status="complete">Complete</Badge>
                    ) : (
                      <Badge status="incomplete">Incomplete</Badge>
                    )
                  },
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (s) => (
                    <div className="ds-row-actions">
                      <button type="button" className="ds-btn ds-btn-link" onClick={() => setChosenSubjectId(s.id)}>
                        Configure
                      </button>
                    </div>
                  ),
                },
              ]}
            />
          </Card>

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
    <Card title={`${subject.name} — ${term.name}, ${term.sessions.name}`} flush>
      <DataTable
        caption={`${subject.name} components`}
        rowKey={(c) => c.id}
        rows={components}
        empty={
          <p className="ds-note ds-card-body">
            No components yet for {subject.name} this term. Add them below, or use the default button further down.
          </p>
        }
        columns={[
          {
            key: 'name',
            header: 'Component',
            primary: true,
            render: (c) => (
              <span className="ds-inline">
                {c.name}
                {editingId === c.id && <Badge status="editing">Editing</Badge>}
              </span>
            ),
          },
          { key: 'max', header: 'Max score', numeric: true, render: (c) => Number(c.max_score) },
          { key: 'weight', header: 'Weight', numeric: true, render: (c) => `${Number(c.weight)}%` },
          {
            key: 'actions',
            header: 'Actions',
            render: (c) => (
              <div className="ds-row-actions">
                <button type="button" className="ds-btn ds-btn-link" onClick={() => startEdit(c)}>
                  Edit
                </button>
                <DeleteAction
                  itemName={`${c.name} (${subject.name}, ${term.name})`}
                  buttonClassName="ds-btn ds-btn-link ds-btn-link-danger"
                  dependencyChecks={[{ table: 'scores', column: 'component_id', value: c.id, label: ['score', 'scores'] }]}
                  onDelete={() => runWrite(supabase.from('assessment_components').delete().eq('id', c.id).select('id'))}
                  onDeleted={() => {
                    if (editingId === c.id) resetForm()
                    onChanged()
                  }}
                />
              </div>
            ),
          },
        ]}
      />

      <div className="ds-card-body">
        <Alert tone={total === 100 ? 'success' : 'warning'}>
          Total weight: <strong>{total}%</strong>
          {total === 100
            ? ' — complete. Teachers can enter scores for this subject.'
            : components.length === 0
              ? ''
              : ` — must be exactly 100%. Until it is, teachers can't enter ${subject.name} scores and it won't count in the class ranking.`}
        </Alert>

        <form onSubmit={handleSubmit}>
          <h3 className="ds-h2" style={{ marginBottom: 12 }}>
            {editingId ? 'Edit component' : 'Add component'}
          </h3>
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="ds-form-grid">
            <Field label="Name" className="ds-span-2">
              {(p) => <TextInput {...p} value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="e.g. CA, Exam, Project" required />}
            </Field>
            <Field label="Max score">
              {(p) => (
                <TextInput {...p} type="number" inputMode="decimal" min="0.5" step="any" value={form.max_score} onChange={(e) => update('max_score', e.target.value)} placeholder="30" required />
              )}
            </Field>
            <Field label="Weight (%)">
              {(p) => (
                <TextInput {...p} type="number" inputMode="decimal" min="0.5" max="100" step="any" value={form.weight} onChange={(e) => update('weight', e.target.value)} placeholder="30" required />
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
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add component'}
            </Button>
          </div>
        </form>
      </div>
    </Card>
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
      <p className="ds-note">{subjects.map((s) => s.name).join(', ')}</p>
      {configuredCount > 0 && (
        <p className="ds-note">
          The {configuredCount} {configuredCount === 1 ? 'subject that already has' : 'subjects that already have'}{' '}
          components will not be changed.
        </p>
      )}
    </ConfirmDialog>
  )
}
