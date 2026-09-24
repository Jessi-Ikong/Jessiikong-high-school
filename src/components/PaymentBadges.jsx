const INVOICE = {
  paid: ['badge', 'Paid'],
  partial: ['badge badge-info', 'Part paid'],
  unpaid: ['badge badge-muted', 'Unpaid'],
  overdue: ['badge badge-late', 'Overdue'],
}

const PAYMENT = {
  successful: ['badge', 'Successful'],
  pending: ['badge badge-warning', 'Pending'],
  failed: ['badge badge-late', 'Failed'],
}

export function InvoiceStatusBadge({ status }) {
  const [className, label] = INVOICE[status] ?? ['badge badge-muted', status]
  return <span className={className}>{label}</span>
}

export function PaymentStatusBadge({ status }) {
  const [className, label] = PAYMENT[status] ?? ['badge badge-muted', status]
  return <span className={className}>{label}</span>
}
