import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { formatDate, formatNaira } from '../../lib/format'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'
import DeleteAction from '../../components/DeleteAction'

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
        <h1>Fees</h1>
        <p className="alert alert-error" role="alert">Only super admins can manage fees.</p>
      </>
    )
  }
  if (setup.loading) return <p className="muted">Loading…</p>
  if (setup.error) return <p className="alert alert-error" role="alert">{friendlyDbError(setup.error)}</p>

  const { terms, classes } = setup.data
  if (terms.length === 0 || classes.length === 0) {
    return (
      <>
        <h1>Fees</h1>
        <p className="empty-state">
          Create at least one <Link to="/admin/terms">term</Link> and one <Link to="/admin/classes">class</Link> first.
        </p>
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
      <h1>Fees</h1>
      <p className="muted">
        Fee items per class and term, e.g. Tuition, Books, PTA Levy. Adding one automatically invoices every student
        actively enrolled in that class (all sections) for the term&apos;s session. Students who join later are invoiced
        too.
      </p>
      <div className="filter-bar">
        <label className="inline-field">
          Term
          <select value={term.id} onChange={(e) => setChosenTermId(e.target.value)}>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}, {t.sessions.name}
                {t.is_current ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          Class
          <select value={cls.id} onChange={(e) => setChosenClassId(e.target.value)}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
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

  if (query.loading) return <p className="muted">Loading fees…</p>
  if (query.error) return <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>

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
      {notice && <p className="alert alert-success" role="status">{notice}</p>}
      <section className="panel">
        <h2>
          {cls.name} — {term.name}, {term.sessions.name}
        </h2>
        {fees.length === 0 ? (
          <p className="empty-state">No fees yet for {cls.name} this term. Add one below.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table fee-table">
              <thead>
                <tr>
                  <th>Fee</th>
                  <th>Amount</th>
                  <th>Due</th>
                  <th>Invoices</th>
                  <th>Collected</th>
                  <th>Outstanding</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {fees.map((f) => {
                  const s = f.summary ?? {}
                  const outstanding = Number(s.amount_due ?? 0) - Number(s.amount_paid ?? 0)
                  return (
                    <tr key={f.id} className={editing?.id === f.id ? 'row-editing' : undefined}>
                      <td>
                        {f.name}
                        {f.description && <div className="muted small">{f.description}</div>}
                      </td>
                      <td>{formatNaira(f.amount)}</td>
                      <td className="small">
                        {f.due_date ? formatDate(f.due_date) : <span className="muted">End of term ({formatDate(term.end_date)})</span>}
                      </td>
                      <td>
                        <InvoiceCounts summary={s} />
                      </td>
                      <td>{formatNaira(s.amount_paid)}</td>
                      <td>{formatNaira(outstanding)}</td>
                      <td className="row-actions">
                        <button type="button" className="button-link" onClick={() => startEdit(f)}>
                          Edit
                        </button>
                        <DeleteAction
                          itemName={`"${f.name}" and its ${Number(s.invoices ?? 0)} ${Number(s.invoices) === 1 ? 'invoice' : 'invoices'}`}
                          dependencyChecks={[]}
                          onDelete={() => runWrite(supabase.from('fee_structures').delete().eq('id', f.id).select('id'))}
                          onDeleted={() => {
                            if (editing?.id === f.id) resetForm()
                            setNotice(`"${f.name}" and its invoices were deleted.`)
                            query.reload()
                          }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {fees.length > 1 && (
                <tfoot>
                  <tr>
                    <th scope="row">Total</th>
                    <td />
                    <td />
                    <td className="small">{totals.invoices} invoices</td>
                    <td>{formatNaira(totals.paid)}</td>
                    <td>{formatNaira(totals.due - totals.paid)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        <p className="muted small">
          A fee can&apos;t be deleted, and its amount can&apos;t be changed, once any payment has been recorded against its
          invoices, so payment records are always kept. Its name, description and due date can still be changed.
        </p>

        <form className="form-grid" onSubmit={handleSubmit}>
          <h3>{editing ? `Edit "${editing.name}"` : 'Add a fee'}</h3>
          {formError && <p className="alert alert-error" role="alert">{formError}</p>}
          <label>
            Name
            <input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="e.g. Tuition, Books, PTA Levy" required />
          </label>
          <label>
            Amount (₦)
            <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => update('amount', e.target.value)} placeholder="50000" required />
          </label>
          <label>
            Due date (optional)
            <input type="date" value={form.due_date} onChange={(e) => update('due_date', e.target.value)} />
            <span className="muted small">Leave empty to use the end of term ({formatDate(term.end_date)}).</span>
          </label>
          <label>
            Description (optional)
            <input value={form.description} onChange={(e) => update('description', e.target.value)} />
          </label>
          <div className="form-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add fee and create invoices'}
            </button>
            {editing && (
              <button type="button" className="button-secondary" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>
    </>
  )
}

function InvoiceCounts({ summary }) {
  const total = Number(summary.invoices ?? 0)
  if (total === 0) return <span className="muted small">None yet</span>
  const parts = [
    ['paid', 'paid', 'badge'],
    ['partial', 'partial', 'badge badge-info'],
    ['unpaid', 'unpaid', 'badge badge-muted'],
    ['overdue', 'overdue', 'badge badge-late'],
  ].filter(([key]) => Number(summary[key]) > 0)
  return (
    <span className="badge-row">
      <span className="small">{total} ·</span>
      {parts.map(([key, label, className]) => (
        <span key={key} className={className}>
          {Number(summary[key])} {label}
        </span>
      ))}
    </span>
  )
}
