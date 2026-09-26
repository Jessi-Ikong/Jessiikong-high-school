import { Badge } from './ui/Primitives'

// Invoice and payment status pills; colours come from lib/statusTones.js.
const INVOICE_LABELS = { paid: 'Paid', partial: 'Part paid', unpaid: 'Unpaid', overdue: 'Overdue' }
const PAYMENT_LABELS = { successful: 'Successful', pending: 'Pending', failed: 'Failed' }

export function InvoiceStatusBadge({ status }) {
  return <Badge status={status}>{INVOICE_LABELS[status] ?? status}</Badge>
}

export function PaymentStatusBadge({ status }) {
  return <Badge status={status}>{PAYMENT_LABELS[status] ?? status}</Badge>
}
