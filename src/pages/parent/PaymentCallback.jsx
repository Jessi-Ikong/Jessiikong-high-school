import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError } from '../../lib/db'
import { callFunction } from '../../lib/functions'
import { formatNaira } from '../../lib/format'
import { InvoiceStatusBadge } from '../../components/PaymentBadges'

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
    <div className="payment-callback">
      <h1>Payment</h1>
      {!reference ? (
        <p className="alert alert-error" role="alert">
          This page is opened by Paystack after a payment, but no payment reference was given.
        </p>
      ) : state.phase === 'checking' ? (
        <div className="panel payment-status" role="status" aria-live="polite">
          <p className="spinner-line">
            <span className="spinner" aria-hidden="true" /> Confirming your payment…
          </p>
          <p className="muted small">This usually takes a few seconds. Please don&apos;t close this page.</p>
        </div>
      ) : state.phase === 'successful' ? (
        <div className="panel payment-status is-success" role="status">
          <h2>✅ Payment successful</h2>
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
      ) : state.phase === 'failed' ? (
        <div className="panel payment-status is-failed" role="alert">
          <h2>Payment not completed</h2>
          <p>
            Paystack reported that this payment did not go through, so you have not been charged. You can try again from
            the fees page.
          </p>
        </div>
      ) : state.phase === 'pending' ? (
        <div className="panel payment-status" role="status">
          <h2>Still waiting for confirmation</h2>
          <p>
            Paystack hasn&apos;t confirmed this payment yet. If you completed the payment, it will show as
            &quot;Successful&quot; on the fees page within a few minutes; you don&apos;t need to pay again. If you
            closed the checkout without paying, nothing was charged.
          </p>
          <button type="button" className="button-secondary" onClick={checkAgain}>
            Check again
          </button>
        </div>
      ) : state.phase === 'not-found' ? (
        <p className="alert alert-error" role="alert">
          We couldn&apos;t find a payment with reference {reference} on your account. If money was taken, please contact
          the school with this reference.
        </p>
      ) : (
        <p className="alert alert-error" role="alert">
          {state.error}{' '}
          <button type="button" className="button-link" onClick={checkAgain}>
            Try again
          </button>
        </p>
      )}
      {reference && <p className="muted small">Reference: {reference}</p>}
      <p>
        <Link to={feesLink}>← Back to school fees</Link>
      </p>
    </div>
  )
}
