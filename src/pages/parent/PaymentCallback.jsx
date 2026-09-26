import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError } from '../../lib/db'
import { callFunction } from '../../lib/functions'
import { formatNaira } from '../../lib/format'
import { InvoiceStatusBadge } from '../../components/PaymentBadges'
import { Alert, Button, Card, PageHeader } from '../../components/ui/Primitives'

// Paystack sends the parent here after checkout: /parent/payment-callback?reference=...
// A payment is confirmed on our server either by Paystack's webhook
// (paystack-webhook) or by asking our server to check with Paystack directly
// (verify-payment). This page does both: it asks the server to verify on
// arrival (and once more halfway), and checks the payment every 2 seconds for
// up to ~20 seconds, then stops and says so.
const POLL_EVERY_MS = 2000
const MAX_CHECKS = 10

async function fetchPayment(reference) {
  const { data, error } = await supabase
    .from('payments')
    .select('status, amount, paid_at, invoices(student_id, amount_due, amount_paid, status, fee_structures(name))')
    .eq('provider', 'paystack')
    .eq('provider_ref', reference)
    .maybeSingle()
  if (error) throw error
  return data
}

export default function PaymentCallback() {
  const [params] = useSearchParams()
  // Paystack adds both ?reference= and ?trxref= (the same value).
  const reference = params.get('reference') ?? params.get('trxref')
  const [round, setRound] = useState(0) // bumped by "Check again"
  const [state, setState] = useState({ phase: 'checking', payment: null, error: null })

  function checkAgain() {
    setState({ phase: 'checking', payment: null, error: null })
    setRound((r) => r + 1)
  }

  useEffect(() => {
    if (!reference) return undefined
    let cancelled = false
    let timer = null
    let checks = 0

    async function check() {
      checks += 1
      // Ask the server to confirm with Paystack now, rather than only waiting
      // for the webhook. A failure here is fine: the webhook can still do it.
      if (checks === 1 || checks === Math.ceil(MAX_CHECKS / 2)) {
        try {
          await callFunction('verify-payment', { reference })
        } catch (err) {
          console.warn('verify-payment:', err.message)
        }
        if (cancelled) return
      }
      try {
        const payment = await fetchPayment(reference)
        if (cancelled) return
        if (payment?.status === 'successful' || payment?.status === 'failed') {
          setState({ phase: payment.status, payment, error: null })
          return
        }
        if (checks >= MAX_CHECKS) {
          setState({ phase: payment ? 'pending' : 'not-found', payment, error: null })
          return
        }
        setState({ phase: 'checking', payment, error: null })
        timer = setTimeout(check, POLL_EVERY_MS)
      } catch (err) {
        if (!cancelled) setState({ phase: 'error', payment: null, error: friendlyDbError(err) })
      }
    }

    check()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [reference, round])

  const feesLink = state.payment?.invoices?.student_id ? `/parent/fees?child=${state.payment.invoices.student_id}` : '/parent/fees'
  const invoice = state.payment?.invoices

  return (
    <div className="ds-narrow">
      <PageHeader title="Payment" />
      {!reference ? (
        <Alert tone="danger">This page is opened by Paystack after a payment, but no payment reference was given.</Alert>
      ) : state.phase === 'checking' ? (
        <Card>
          <div role="status" aria-live="polite">
            <p className="ds-inline" style={{ marginTop: 0, fontWeight: 700 }}>
              <span className="ds-spinner" aria-hidden="true" /> Confirming your payment…
            </p>
            <p className="ds-note" style={{ marginBottom: 0 }}>
              This usually takes a few seconds. Please don&apos;t close this page.
            </p>
          </div>
        </Card>
      ) : state.phase === 'successful' ? (
        <Card className="ds-edge-success">
          <div role="status">
          <h2 className="ds-h2" style={{ fontSize: 'var(--ds-text-lg)' }}>✅ Payment successful</h2>
          <p>
            {formatNaira(state.payment.amount)} was paid for <strong>{invoice?.fee_structures?.name}</strong>.
          </p>
          {invoice && (
            <p>
              This fee is now <InvoiceStatusBadge status={invoice.status} />
              {Number(invoice.amount_due) > Number(invoice.amount_paid) &&
                ` (${formatNaira(Number(invoice.amount_due) - Number(invoice.amount_paid))} still to pay)`}
              .
            </p>
          )}
          </div>
        </Card>
      ) : state.phase === 'failed' ? (
        <Card className="ds-edge-danger">
          <div role="alert">
            <h2 className="ds-h2" style={{ fontSize: 'var(--ds-text-lg)' }}>Payment not completed</h2>
            <p style={{ marginBottom: 0 }}>
              Paystack reported that this payment did not go through, so you have not been charged. You can try again from the fees page.
            </p>
          </div>
        </Card>
      ) : state.phase === 'pending' ? (
        <Card className="ds-edge-warning">
          <div role="status">
          <h2 className="ds-h2" style={{ fontSize: 'var(--ds-text-lg)' }}>Still waiting for confirmation</h2>
          <p>
            Paystack hasn&apos;t confirmed this payment yet. If you completed the payment, it will show as
            &quot;Successful&quot; on the fees page within a few minutes; you don&apos;t need to pay again. If you
            closed the checkout without paying, nothing was charged.
          </p>
          <Button variant="secondary" onClick={checkAgain}>
            Check again
          </Button>
          </div>
        </Card>
      ) : state.phase === 'not-found' ? (
        <Alert tone="danger">
          We couldn&apos;t find a payment with reference {reference} on your account. If money was taken, please contact the school with this reference.
        </Alert>
      ) : (
        <Alert tone="danger">
          {state.error}{' '}
          <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm" onClick={checkAgain}>
            Try again
          </button>
        </Alert>
      )}
      {reference && <p className="ds-note" style={{ overflowWrap: 'anywhere' }}>Reference: {reference}</p>}
      <Link to={feesLink} className="ds-btn ds-btn-link" style={{ paddingLeft: 0 }}>
        ← Back to school fees
      </Link>
    </div>
  )
}
