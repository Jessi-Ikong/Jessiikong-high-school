import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { formatDate, formatNaira } from '../../lib/format'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'
import DeleteAction from '../../components/DeleteAction'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, Select, TextInput } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'

const EMPTY_FORM = { name: '', amount: '', due_date: '', description: '' }
const ERRORS = {
  unique: 'This class already has a fee with that name this term.',
  check: 'The amount must be more than 0.',
}

async function fetchSetup() {
  const [terms, classes] = await Promise.all([
    run(
      supabase
        .from('terms')
        .select('id, name, is_current, start_date, end_date, sessions(name)')
        .order('start_date', { ascending: false }),
    ),
    run(supabase.from('classes').select('id, name, level').order('level')),
  ])
  return { terms, classes }
}

// The class's fee structures for the term, each with its collection summary
// (invoice counts by status and totals, worked out by the database).
async function fetchFees(termId, classId) {
  const [fees, summary] = await Promise.all([
    run(
      supabase
        .from('fee_structures')
        .select('id, name, amount, due_date, description, created_at')
        .eq('term_id', termId)
        .eq('class_id', classId)
        .order('created_at'),
    ),
    run(supabase.rpc('fee_collection_summary', { p_term_id: termId, p_class_id: classId })),
  ])
  const byFee = Object.fromEntries(summary.map((s) => [s.fee_structure_id, s]))
  return fees.map((f) => ({ ...f, summary: byFee[f.id] }))
}

export default function FeeStructures() {
  const { profile } = useAuth()
  const setup = useAsyncData(fetchSetup, 'fee-setup')

  if (profile.admin_level !== 'super_admin') {
    return (
      <>
        <PageHeader title="Fees" />
        <Alert tone="danger">Only super admins can manage fees.</Alert>
      </>
    )
  }
  if (setup.loading) return <LoadingState lines={6} />
  if (setup.error) return <Alert tone="danger">{friendlyDbError(setup.error)}</Alert>

  const { terms, classes } = setup.data
  if (terms.length === 0 || classes.length === 0) {
    return (
      <>
        <PageHeader title="Fees" />
        <Card>
          <EmptyState icon="money" title="A few things first">
            Create at least one <Link to="/admin/terms">term</Link> and one <Link to="/admin/classes">class</Link> first.
          </EmptyState>
        </Card>
      </>
    )
  }
  return <FeesEditor terms={terms} classes={classes} />
}

function FeesEditor({ terms, classes }) {
  const [chosenTermId, setChosenTermId] = useState(null)
  const [chosenClassId, setChosenClassId] = useState(null)
  const term = terms.find((t) => t.id === chosenTermId) ?? terms.find((t) => t.is_current) ?? terms[0]
  const cls = classes.find((c) => c.id === chosenClassId) ?? classes[0]

  return (
    <>
      <PageHeader
        title="Fees"
        subtitle="Fee items per class and term, e.g. Tuition, Books, PTA Levy. Adding one automatically invoices every student actively enrolled in that class (all sections) for the term's session. Students who join later are invoiced too."
      />
      <div className="ds-filters">
        <Field label="Term">
          {(p) => (
            <Select {...p} value={term.id} onChange={(e) => setChosenTermId(e.target.value)}>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}, {t.sessions.name}
                  {t.is_current ? ' (current)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Class">
          {(p) => (
            <Select {...p} value={cls.id} onChange={(e) => setChosenClassId(e.target.value)}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <ClassFees key={`${term.id}:${cls.id}`} term={term} cls={cls} />
    </>
  )
}

function ClassFees({ term, cls }) {
  const query = useAsyncData(() => fetchFees(term.id, cls.id), `fees:${term.id}:${cls.id}`)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editing, setEditing] = useState(null) // the fee being edited, or null
  const [formError, setFormError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [saving, setSaving] = useState(false)

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function resetForm() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  function startEdit(fee) {
    setEditing(fee)
    setForm({
      name: fee.name,
      amount: String(Number(fee.amount)),
      due_date: fee.due_date ?? '',
      description: fee.description ?? '',
    })
    setFormError(null)
    setNotice(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)
    setNotice(null)
    const values = {
      name: form.name.trim(),
      amount: Number(form.amount),
      due_date: form.due_date || null,
      description: form.description.trim() || null,
    }
    if (!values.name) return setFormError('Give the fee a name, e.g. Tuition.')
    if (!(values.amount > 0)) return setFormError(ERRORS.check)
    setSaving(true)
    try {
      if (editing) {
        await runWrite(supabase.from('fee_structures').update(values).eq('id', editing.id).select('id'))
        setNotice(`"${values.name}" was updated. Its invoices were updated to match.`)
      } else {
        const created = await run(
          supabase
            .from('fee_structures')
            .insert({ ...values, term_id: term.id, class_id: cls.id })
            .select('id')
            .single(),
        )
        // The database invoiced the class as part of that insert.
        const { count } = await supabase
          .from('invoices')
          .select('id', { count: 'exact', head: true })
          .eq('fee_structure_id', created.id)
        setNotice(
          `"${values.name}" was added and ${count ?? 'the'} ${count === 1 ? 'invoice was' : 'invoices were'} created for ${cls.name} students.`,
        )
      }
      resetForm()
      query.reload()
    } catch (err) {
      setFormError(friendlyDbError(err, ERRORS))
    } finally {
      setSaving(false)
    }
  }

  if (query.loading) return <LoadingState lines={4} label="Loading fees…" />
  if (query.error) return <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
  const fees = query.data
  const totals = fees.reduce(
    (t, f) => ({
      invoices: t.invoices + Number(f.summary?.invoices ?? 0),
      due: t.due + Number(f.summary?.amount_due ?? 0),
      paid: t.paid + Number(f.summary?.amount_paid ?? 0),
    }),
    { invoices: 0, due: 0, paid: 0 },
  )

  return (
    <>
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card title={`${cls.name} — ${term.name}, ${term.sessions.name}`} flush>
        <DataTable
          caption={`Fees for ${cls.name}`}
          rowKey={(f) => f.id}
          rows={fees}
          empty={<EmptyState icon="money">No fees yet for {cls.name} this term. Add one below.</EmptyState>}
          columns={[
            {
              key: 'name',
              header: 'Fee',
              primary: true,
              render: (f) => (
                <span>
                  <span className="ds-inline">
                    {f.name}
                    {editing?.id === f.id && <Badge status="editing">Editing</Badge>}
                  </span>
                  {f.description && <span className="ds-muted ds-small" style={{ display: 'block', fontWeight: 400 }}>{f.description}</span>}
                </span>
              ),
            },
            { key: 'amount', header: 'Amount', numeric: true, render: (f) => formatNaira(f.amount) },
            {
              key: 'due',
              header: 'Due',
              render: (f) => (f.due_date ? formatDate(f.due_date) : <span className="ds-muted">End of term ({formatDate(term.end_date)})</span>),
            },
            { key: 'invoices', header: 'Invoices', render: (f) => <InvoiceCounts summary={f.summary ?? {}} /> },
            { key: 'collected', header: 'Collected', numeric: true, render: (f) => formatNaira(f.summary?.amount_paid) },
            {
              key: 'outstanding',
              header: 'Outstanding',
              numeric: true,
              render: (f) => formatNaira(Number(f.summary?.amount_due ?? 0) - Number(f.summary?.amount_paid ?? 0)),
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (f) => {
                const s = f.summary ?? {}
                return (
                  <div className="ds-row-actions">
                    <button type="button" className="ds-btn ds-btn-link" onClick={() => startEdit(f)}>
                      Edit
                    </button>
                    <DeleteAction
                      itemName={`"${f.name}" and its ${Number(s.invoices ?? 0)} ${Number(s.invoices) === 1 ? 'invoice' : 'invoices'}`}
                      buttonClassName="ds-btn ds-btn-link ds-btn-link-danger"
                      dependencyChecks={[]}
                      onDelete={() => runWrite(supabase.from('fee_structures').delete().eq('id', f.id).select('id'))}
                      onDeleted={() => {
                        if (editing?.id === f.id) resetForm()
                        setNotice(`"${f.name}" and its invoices were deleted.`)
                        query.reload()
                      }}
                    />
                  </div>
                )
              },
            },
          ]}
        />
        {fees.length > 1 && (
          <p className="ds-card-body ds-small" style={{ margin: 0, borderTop: '1px solid var(--ds-border)' }}>
            <strong>Total:</strong> {totals.invoices} invoices · collected <strong>{formatNaira(totals.paid)}</strong> · outstanding{' '}
            <strong>{formatNaira(totals.due - totals.paid)}</strong>
          </p>
        )}
        <div className="ds-card-body" style={{ borderTop: '1px solid var(--ds-border)' }}>
          <p className="ds-note">
            A fee can&apos;t be deleted, and its amount can&apos;t be changed, once any payment has been recorded against its invoices, so payment records are
            always kept. Its name, description and due date can still be changed.
          </p>

          <form onSubmit={handleSubmit}>
            <h3 className="ds-h2" style={{ marginBottom: 12 }}>
              {editing ? `Edit "${editing.name}"` : 'Add a fee'}
            </h3>
            {formError && <Alert tone="danger">{formError}</Alert>}
            <div className="ds-form-grid">
              <Field label="Name">
                {(p) => <TextInput {...p} value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="e.g. Tuition, Books, PTA Levy" required />}
              </Field>
              <Field label="Amount (₦)">
                {(p) => (
                  <TextInput {...p} type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount} onChange={(e) => update('amount', e.target.value)} placeholder="50000" required />
                )}
              </Field>
              <Field label="Due date" hint={`Optional. Leave empty to use the end of term (${formatDate(term.end_date)}).`}>
                {(p) => <TextInput {...p} type="date" value={form.due_date} onChange={(e) => update('due_date', e.target.value)} />}
              </Field>
              <Field label="Description" hint="Optional">
                {(p) => <TextInput {...p} value={form.description} onChange={(e) => update('description', e.target.value)} />}
              </Field>
            </div>
            <div className="ds-form-actions">
              {editing && (
                <Button variant="secondary" onClick={resetForm}>
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Add fee and create invoices'}
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </>
  )
}

function InvoiceCounts({ summary }) {
  const total = Number(summary.invoices ?? 0)
  if (total === 0) return <span className="ds-muted ds-small">None yet</span>
  const parts = ['paid', 'partial', 'unpaid', 'overdue'].filter((key) => Number(summary[key]) > 0)
  return (
    <span className="ds-inline" style={{ justifyContent: 'inherit' }}>
      <span className="ds-small">{total} ·</span>
      {parts.map((key) => (
        <Badge key={key} status={key}>
          {Number(summary[key])} {key}
        </Badge>
      ))}
    </span>
  )
}
