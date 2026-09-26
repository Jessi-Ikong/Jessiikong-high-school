import { useState } from 'react'
import { friendlyDbError } from '../../lib/db'
import { formatDateTime } from '../../lib/assignments'
import { INQUIRY_STATUSES, deleteInquiry, fetchInquiries, updateInquiry } from '../../lib/publicContent'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, Select, TextArea } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'
import Dialog from '../../components/ui/Dialog'

// Admissions inquiries sent from the public website (both admin tiers).
// Families' contact details: only admins can read these (the database lets
// anyone SUBMIT one, never read one). Internal notes are staff-only.


const statusLabel = (value) => INQUIRY_STATUSES.find((s) => s.value === value)?.label ?? value

export default function AdmissionsInquiries() {
  const query = useAsyncData(fetchInquiries, 'admin-inquiries')
  const [statusFilter, setStatusFilter] = useState('')
  const [openId, setOpenId] = useState(null)
  const [message, setMessage] = useState(null)

  const all = query.data ?? []
  const shown = statusFilter ? all.filter((i) => i.status === statusFilter) : all
  const newCount = all.filter((i) => i.status === 'new').length

  const open = openId ? shown.find((i) => i.id === openId) : null
  const onChanged = (text) => {
    setMessage(text)
    query.reload()
  }

  return (
    <>
      <PageHeader
        title="Admissions Inquiries"
        subtitle="Inquiries from families using the public website, newest first. These contain private contact details: only admins can see them."
      />
      {message && <Alert tone="success">{message}</Alert>}
      <div className="ds-filters">
        <Field
          label="Status"
          hint={!query.loading && !query.error ? `${all.length} ${all.length === 1 ? 'inquiry' : 'inquiries'} · ${newCount} new` : undefined}
        >
          {(p) => (
            <Select {...p} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              {INQUIRY_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {query.loading ? (
        <LoadingState lines={5} label="Loading inquiries…" />
      ) : query.error ? (
        <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
      ) : (
        <Card flush>
          <DataTable
            caption="Admissions inquiries"
            rowKey={(i) => i.id}
            rows={shown}
            empty={<EmptyState icon="inbox">{all.length === 0 ? 'No inquiries yet.' : 'No inquiries with this status.'}</EmptyState>}
            columns={[
              { key: 'parent', header: 'Parent / guardian', primary: true, render: (i) => i.parent_name },
              { key: 'received', header: 'Received', render: (i) => <span className="ds-small">{formatDateTime(i.submitted_at)}</span> },
              { key: 'child', header: 'Child', render: (i) => i.child_name },
              { key: 'class', header: 'Class wanted', render: (i) => i.desired_class },
              { key: 'status', header: 'Status', render: (i) => <Badge status={i.status}>{statusLabel(i.status)}</Badge> },
              {
                key: 'actions',
                header: 'Actions',
                render: (i) => (
                  <div className="ds-row-actions">
                    <button type="button" className="ds-btn ds-btn-link" onClick={() => setOpenId(openId === i.id ? null : i.id)} aria-expanded={openId === i.id}>
                      View
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </Card>
      )}
      {open && <InquiryDetails key={open.updated_at} inquiry={open} onClose={() => setOpenId(null)} onChanged={onChanged} />}
    </>
  )
}

function InquiryDetails({ inquiry: i, onClose, onChanged }) {
  const [status, setStatus] = useState(i.status)
  const [notes, setNotes] = useState(i.internal_notes ?? '')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const changed = status !== i.status || notes.trim() !== (i.internal_notes ?? '')

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await updateInquiry(i.id, { status, internal_notes: notes.trim() || null })
      onChanged(`Saved the inquiry from ${i.parent_name}.`)
    } catch (err) {
      setError(friendlyDbError(err))
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={`Inquiry from ${i.parent_name}`}
      onClose={onClose}
      busy={saving}
      footer={
        <div className="ds-form-actions" style={{ margin: 0, width: '100%' }}>
          <DeleteAction
            itemName={`the inquiry from ${i.parent_name}`}
            buttonClassName="ds-btn ds-btn-secondary"
            dependencyChecks={[]}
            onDelete={() => deleteInquiry(i.id)}
            onDeleted={() => onChanged(`Deleted the inquiry from ${i.parent_name}.`)}
          />
          <Button type="submit" form="inquiry-form" disabled={saving || !changed}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <form id="inquiry-form" onSubmit={save}>
        <dl className="ds-facts">
          <dt>Email</dt>
          <dd>
            <a href={`mailto:${i.email}`}>{i.email}</a>
          </dd>
          <dt>Phone</dt>
          <dd>{i.phone ? <a href={`tel:${i.phone}`}>{i.phone}</a> : <span className="ds-muted">—</span>}</dd>
          <dt>Child</dt>
          <dd>
            {i.child_name} · {i.desired_class}
          </dd>
          <dt>Message</dt>
          <dd>{i.message ?? <span className="ds-muted">—</span>}</dd>
          <dt>Received</dt>
          <dd>{formatDateTime(i.submitted_at)}</dd>
        </dl>
        <Field label="Status">
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}>
              {INQUIRY_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Internal notes" hint="Staff only, never shown to the family or the public.">
          {(p) => <TextArea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  )
}
