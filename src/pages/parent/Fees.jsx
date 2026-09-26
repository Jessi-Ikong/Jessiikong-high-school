import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { callFunction } from '../../lib/functions'
import { formatDate, formatNaira } from '../../lib/format'
import { formatDateTime } from '../../lib/assignments'
import { fullName } from '../../lib/people'
import { fetchMyChildren } from '../../lib/parentChildren'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'
import ChildSwitcher from '../../components/ChildSwitcher'
import { useChosenChild } from '../../hooks/useChosenChild'
import { InvoiceStatusBadge, PaymentStatusBadge } from '../../components/PaymentBadges'
import { Alert, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import DataTable from '../../components/ui/DataTable'

// The child's invoices (every term) and the payments made against them.
// RLS only returns invoices / payments for the parent's own children.
async function fetchChildFees(studentId) {
  const [invoices, payments] = await Promise.all([
    run(
      supabase
        .from('invoices')
        .select('id, amount_due, amount_paid, status, due_date, created_at, fee_structures(name), terms(name, start_date, sessions(name))')
        .eq('student_id', studentId),
    ),
    run(
      supabase
        .from('payments')
        .select('id, amount, status, provider, provider_ref, paid_at, created_at, invoices!inner(student_id, fee_structures(name), terms(name))')
        .eq('invoices.student_id', studentId)
        .order('created_at', { ascending: false }),
    ),
  ])
  // Newest term first, then by due date.
  invoices.sort(
    (a, b) =>
      (b.terms?.start_date ?? '').localeCompare(a.terms?.start_date ?? '') ||
      (a.due_date ?? '').localeCompare(b.due_date ?? ''),
  )
  return { invoices, payments }
}

export default function Fees() {
  const { profile } = useAuth()
  const query = useAsyncData(() => fetchMyChildren(profile.id), `my-children:${profile.id}`)

  if (query.loading) return <LoadingState lines={5} />
  if (query.error) return <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
  if (query.data.length === 0) {
    return (
      <>
        <PageHeader title="School fees" />
        <Card>
          <EmptyState icon="users">No children are linked to your account yet. Please contact the school office.</EmptyState>
        </Card>
      </>
    )
  }
  return <FeesForChildren list={query.data} />
}

function FeesForChildren({ list }) {
  const [child, chooseChild] = useChosenChild(list)
  return (
    <>
      <PageHeader title="School fees" />
      <ChildSwitcher list={list} chosen={child} onChoose={chooseChild} />
      <ChildFees key={child.id} child={child} />
    </>
  )
}

function ChildFees({ child }) {
  const query = useAsyncData(() => fetchChildFees(child.id), `child-fees:${child.id}`)

  if (query.loading) return <LoadingState lines={5} label="Loading fees…" />
  if (query.error) return <Alert tone="danger">{friendlyDbError(query.error)}</Alert>

  const { invoices, payments } = query.data
  const outstanding = invoices.reduce((sum, i) => sum + Math.max(Number(i.amount_due) - Number(i.amount_paid), 0), 0)

  return (
    <>
      <p className="ds-subtitle" style={{ marginTop: 0 }}>
        {fullName(child)}
        {child.className ? ` · ${child.className}` : ''} · Admission no. {child.admissionNumber}
      </p>

      <Card title="Invoices" flush>
        {invoices.length === 0 ? (
          <EmptyState icon="money">No fees have been billed for {child.first_name} yet.</EmptyState>
        ) : (
          <>
            <div className="ds-card-body" style={{ paddingBottom: 0 }}>
              <Alert tone={outstanding > 0 ? 'warning' : 'success'}>
                {outstanding > 0 ? (
                  <>
                    Total outstanding: <strong>{formatNaira(outstanding)}</strong>
                  </>
                ) : (
                  'All fees are paid. Thank you!'
                )}
              </Alert>
            </div>
            <DataTable
              caption={`Invoices for ${fullName(child)}`}
              rowKey={(inv) => inv.id}
              rows={invoices}
              columns={[
                {
                  key: 'fee',
                  header: 'Fee',
                  primary: true,
                  render: (inv) => (
                    <span>
                      {inv.fee_structures?.name}
                      <span className="ds-muted ds-small" style={{ display: 'block', fontWeight: 400 }}>
                        {inv.terms?.name}, {inv.terms?.sessions?.name}
                      </span>
                    </span>
                  ),
                },
                { key: 'due', header: 'Amount due', numeric: true, render: (inv) => formatNaira(inv.amount_due) },
                {
                  key: 'paid',
                  header: 'Paid so far',
                  numeric: true,
                  render: (inv) => {
                    const balance = Number(inv.amount_due) - Number(inv.amount_paid)
                    return (
                      <span>
                        {formatNaira(inv.amount_paid)}
                        {balance < 0 && (
                          <span className="ds-small ds-text-danger" style={{ display: 'block' }}>
                            Overpaid by {formatNaira(-balance)}: the school will contact you.
                          </span>
                        )}
                      </span>
                    )
                  },
                },
                { key: 'status', header: 'Status', render: (inv) => <InvoiceStatusBadge status={inv.status} /> },
                { key: 'due-date', header: 'Due date', render: (inv) => (inv.due_date ? formatDate(inv.due_date) : '—') },
                { key: 'pay', header: 'Pay', render: (inv) => <PayButton invoice={inv} /> },
              ]}
            />
            <p className="ds-note ds-card-body" style={{ margin: 0 }}>
              Payments are made securely through Paystack. &quot;Pay&quot; charges the full remaining balance of that fee. A payment shows here as soon as
              Paystack confirms it (usually within a minute).
            </p>
          </>
        )}
      </Card>

      <Card title="Payment history" flush>
        <DataTable
          caption="Payment history"
          rowKey={(p) => p.id}
          rows={payments}
          empty={<EmptyState icon="money">No payments yet.</EmptyState>}
          columns={[
            {
              key: 'fee',
              header: 'Fee',
              primary: true,
              render: (p) => (
                <span>
                  {p.invoices.fee_structures?.name}
                  <span className="ds-muted ds-small" style={{ fontWeight: 400 }}>
                    {' '}
                    · {p.invoices.terms?.name}
                  </span>
                </span>
              ),
            },
            { key: 'date', header: 'Date', render: (p) => <span className="ds-small">{formatDateTime(p.paid_at ?? p.created_at)}</span> },
            { key: 'amount', header: 'Amount', numeric: true, render: (p) => formatNaira(p.amount) },
            {
              key: 'method',
              header: 'Method',
              render: (p) => (
                <span className="ds-small">
                  {p.provider === 'manual' ? 'At the school' : 'Paystack'}
                  {p.provider_ref && (
                    <span className="ds-muted" style={{ display: 'block', overflowWrap: 'anywhere' }}>
                      {p.provider_ref}
                    </span>
                  )}
                </span>
              ),
            },
            { key: 'status', header: 'Status', render: (p) => <PaymentStatusBadge status={p.status} /> },
          ]}
        />
        {payments.some((p) => p.status === 'pending') && (
          <p className="ds-note ds-card-body" style={{ margin: 0 }}>
            &quot;Pending&quot; means the payment was started but Paystack hasn&apos;t confirmed it (for example, the checkout was closed before paying).
            You are only charged for payments marked &quot;Successful&quot;.
          </p>
        )}
      </Card>
    </>
  )
}

// "Pay ₦…" for one invoice (the full remaining balance), via Paystack's checkout.
function PayButton({ invoice }) {
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState(null)
  const balance = Number(invoice.amount_due) - Number(invoice.amount_paid)

  async function pay() {
    setPaying(true)
    setError(null)
    try {
      const result = await callFunction('initialize-payment', { invoice_id: invoice.id })
      // Leave the app for Paystack's checkout; Paystack brings the parent back
      // to /parent/payment-callback afterwards.
      window.location.assign(result.authorization_url)
    } catch (err) {
      setError(err.message)
      setPaying(false)
    }
  }

  if (balance <= 0 && !error) return <span className="ds-muted">—</span>
  return (
    <span style={{ display: 'block' }}>
      {balance > 0 && (
        <Button onClick={pay} disabled={paying}>
          {paying ? 'Opening Paystack…' : `Pay ${formatNaira(balance)}`}
        </Button>
      )}
      {error && (
        <span style={{ display: 'block', marginTop: 8 }}>
          <Alert tone="danger">{error}</Alert>
        </span>
      )}
    </span>
  )
}
