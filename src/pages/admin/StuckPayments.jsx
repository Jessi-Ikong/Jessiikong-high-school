import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { callFunction } from '../../lib/functions'
import { formatNaira } from '../../lib/format'
import { formatDateTime } from '../../lib/assignments'
import { fullName } from '../../lib/people'
import { useAsyncData } from '../../hooks/useAsyncData'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Checkbox } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'

// Same numbers as the scheduled sweep (migration 029 / reconcile-pending-payments).
const STUCK_AFTER_MINUTES = 15
const EXPIRE_AFTER_HOURS = 48

const PAYMENT_FIELDS =
  'id, amount, status, provider_ref, created_at, paid_at, provider_response, users(first_name, last_name, email), ' +
  'invoices(amount_due, amount_paid, status, fee_structures(name), terms(name), students(admission_number, users(first_name, middle_name, last_name)))'

async function fetchStuck(includeRecent) {
  let pendingQuery = supabase
    .from('payments')
    .select(PAYMENT_FIELDS)
    .eq('status', 'pending')
    .eq('provider', 'paystack')
    .order('created_at', { ascending: true })
  if (!includeRecent) {
    pendingQuery = pendingQuery.lt('created_at', new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000).toISOString())
  }
  const weekAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString()
  const [pending, resolved] = await Promise.all([
    run(pendingQuery),
    // Payments the automatic sweep settled in the last 7 days.
    run(
      supabase
        .from('payments')
        .select(PAYMENT_FIELDS)
        .eq('provider', 'paystack')
        .in('status', ['successful', 'failed'])
        .eq('provider_response->last_check->>source', 'reconcile')
        .gte('updated_at', weekAgo)
        .order('updated_at', { ascending: false }),
    ),
  ])
  // "Now" for this load, so the page shows stable durations.
  return { pending, resolved, loadedAt: Date.now() }
}

// "2 h 5 min", "3 days 4 h" (from fromIso until now, a timestamp in ms)
function duration(fromIso, now) {
  const minutes = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ${minutes % 60} min`
  return `${Math.floor(hours / 24)} days ${hours % 24} h`
}

// What we know from the last check with Paystack (provider_response.last_check).
function CheckSummary({ payment }) {
  const check = payment.provider_response?.last_check
  if (!check) {
    return (
      <>
        <Badge tone="warning">Never checked</Badge>
        <div className="ds-muted ds-small">Not checked with Paystack yet (the next sweep will).</div>
      </>
    )
  }
  const times = `checked ${check.check_count ?? 1}×`
  if (check.outcome === 'paystack-unreachable') {
    return (
      <>
        <Badge tone="danger">Paystack unreachable</Badge>
        <div className="ds-muted ds-small">
          {times}, last {formatDateTime(check.at)}. Will retry.
        </div>
      </>
    )
  }
  const repeated = (check.check_count ?? 1) >= 3
  return (
    <>
      <Badge tone={repeated ? 'neutral' : 'info'}>{check.paystack_status ? `Paystack: ${check.paystack_status}` : 'Paystack: no status'}</Badge>
      <div className="ds-muted ds-small">
        {times}
        {check.first_checked_at && (check.check_count ?? 1) > 1 ? ` since ${formatDateTime(check.first_checked_at)}` : ''}, last{' '}
        {formatDateTime(check.at)} ({check.source === 'reconcile' ? 'automatic' : check.source})
      </div>
      {check.gateway_response && <div className="ds-muted ds-small">&quot;{check.gateway_response}&quot;</div>}
      {repeated && <div className="ds-small">Consistently not completed on Paystack: the parent most likely left the checkout. Nothing was charged.</div>}
    </>
  )
}

// The student / parent / fee / amount columns shared by both tables.
const PAYER_COLUMNS = [
  {
    key: 'student',
    header: 'Student',
    primary: true,
    render: (p) => {
      const student = p.invoices?.students
      return (
        <span>
          {student ? fullName(student.users) : '—'}
          <span className="ds-muted ds-small" style={{ display: 'block', fontWeight: 400 }}>
            {student?.admission_number}
          </span>
        </span>
      )
    },
  },
  {
    key: 'parent',
    header: 'Parent',
    render: (p) => (
      <span>
        {p.users ? fullName(p.users) : '—'}
        {p.users?.email && <span className="ds-muted ds-small" style={{ display: 'block' }}>{p.users.email}</span>}
      </span>
    ),
  },
  {
    key: 'fee',
    header: 'Fee',
    render: (p) => (
      <span>
        {p.invoices?.fee_structures?.name ?? '—'}
        <span className="ds-muted ds-small" style={{ display: 'block' }}>
          {p.invoices?.terms?.name}
        </span>
      </span>
    ),
  },
  { key: 'amount', header: 'Amount', numeric: true, render: (p) => formatNaira(p.amount) },
]
export default function StuckPayments() {
  const [includeRecent, setIncludeRecent] = useState(false)
  const query = useAsyncData(() => fetchStuck(includeRecent), `stuck-payments:${includeRecent}`)
  const [busyRef, setBusyRef] = useState(null)
  const [message, setMessage] = useState(null)

  async function recheck(payment) {
    setBusyRef(payment.provider_ref)
    setMessage(null)
    try {
      const result = await callFunction('verify-payment', { reference: payment.provider_ref })
      const text = {
        successful: 'Paystack confirmed it: the payment is now marked successful and the invoice updated.',
        'already-successful': 'It was already successful.',
        failed: 'Paystack reports this payment failed. It is now marked failed.',
        mismatch: 'Paystack reports success but for a DIFFERENT amount/currency. Marked failed for review; NOT counted as paid.',
        pending: `Still not completed on Paystack (${result.paystack_status ?? 'no status'}). It stays pending.`,
      }[result.outcome]
      setMessage({ ok: true, text: `${payment.provider_ref}: ${text ?? result.outcome}` })
      query.reload()
    } catch (err) {
      setMessage({ ok: false, text: `${payment.provider_ref}: ${err.message}` })
    } finally {
      setBusyRef(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Stuck payments"
        subtitle={`Online (Paystack) payments still waiting for confirmation ${STUCK_AFTER_MINUTES}+ minutes after they were started, usually because the parent left the checkout or Paystack's confirmation didn't reach us. The system re-checks them with Paystack automatically every 15 minutes, and a payment is only ever marked paid if Paystack confirms it. Payments Paystack still reports as not completed after ${EXPIRE_AFTER_HOURS} hours are marked failed automatically.`}
      />
      <div className="ds-inline" style={{ marginBottom: 12 }}>
        <Checkbox
          label={`Also show payments started in the last ${STUCK_AFTER_MINUTES} minutes`}
          checked={includeRecent}
          onChange={(e) => setIncludeRecent(e.target.checked)}
        />
        <Button variant="secondary" onClick={query.reload} disabled={query.refreshing}>
          {query.refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {message && <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>}

      {query.loading ? (
        <LoadingState lines={5} />
      ) : query.error ? (
        <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
      ) : (
        <>
          <Card title={`Waiting for confirmation (${query.data.pending.length})`} flush>
            <DataTable
              caption="Payments waiting for confirmation"
              rowKey={(p) => p.id}
              rows={query.data.pending}
              empty={<EmptyState icon="check">No stuck payments. 🎉</EmptyState>}
              columns={[
                ...PAYER_COLUMNS,
                {
                  key: 'pending',
                  header: 'Pending for',
                  render: (p) => {
                    const hoursLeft = EXPIRE_AFTER_HOURS - (query.data.loadedAt - new Date(p.created_at).getTime()) / 3_600_000
                    return (
                      <span className="ds-small">
                        {duration(p.created_at, query.data.loadedAt)}
                        <span className="ds-muted" style={{ display: 'block' }}>since {formatDateTime(p.created_at)}</span>
                        <span className="ds-muted" style={{ display: 'block', overflowWrap: 'anywhere' }}>{p.provider_ref}</span>
                        {hoursLeft > 0 && hoursLeft < 24 && <span style={{ display: 'block' }}>Auto-fails in about {Math.ceil(hoursLeft)} h if still not completed</span>}
                      </span>
                    )
                  },
                },
                { key: 'check', header: 'Last Paystack check', stack: true, render: (p) => <CheckSummary payment={p} /> },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (p) => (
                    <div className="ds-row-actions">
                      <Button onClick={() => recheck(p)} disabled={busyRef !== null}>
                        {busyRef === p.provider_ref ? 'Checking…' : 'Re-check now'}
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </Card>

          <Card title={`Settled by the automatic check (last 7 days) (${query.data.resolved.length})`} flush>
            <DataTable
              caption="Payments settled by the automatic check"
              rowKey={(p) => p.id}
              rows={query.data.resolved}
              empty={<p className="ds-note ds-card-body">None.</p>}
              columns={[
                ...PAYER_COLUMNS,
                {
                  key: 'result',
                  header: 'Result',
                  stack: true,
                  render: (p) => (
                    <span>
                      <Badge status={p.status}>{p.status.charAt(0).toUpperCase() + p.status.slice(1)}</Badge>
                      <span className="ds-muted ds-small" style={{ display: 'block' }}>
                        {p.provider_response?.expired
                          ? `Expired: never completed on Paystack (checked ${p.provider_response?.last_check?.check_count ?? 1}×)`
                          : p.provider_response?.review
                            ? 'Amount mismatch: needs review'
                            : `Paystack: ${p.provider_response?.last_check?.paystack_status ?? '—'}`}
                      </span>
                      <span className="ds-muted ds-small" style={{ display: 'block' }}>
                        {formatDateTime(p.provider_response?.last_check?.at)}
                      </span>
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}
    </>
  )
}
