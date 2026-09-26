import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { formatDateTime } from '../../lib/assignments'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, Select, TextArea } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'
import Dialog from '../../components/ui/Dialog'

// General messages sent from the public website's Contact page (both admin
// tiers). Only admins can read them; anyone can send one (migration 41).
// Admissions questions have their own page (Admissions Inquiries).

const STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'replied', label: 'Replied' },
  { value: 'closed', label: 'Closed' },
]
const statusOf = (value) => STATUSES.find((s) => s.value === value) ?? { label: value }
function fetchMessages() {
  return run(
    supabase
      .from('contact_messages')
      .select('id, name, email, phone, subject, message, status, internal_notes, submitted_at, updated_at')
      .order('submitted_at', { ascending: false }),
  )
}

export default function ContactMessages() {
  const query = useAsyncData(fetchMessages, 'admin-contact-messages')
  const [statusFilter, setStatusFilter] = useState('')
  const [openId, setOpenId] = useState(null)
  const [message, setMessage] = useState(null)

  const all = query.data ?? []
  const shown = statusFilter ? all.filter((m) => m.status === statusFilter) : all

  const open = openId ? shown.find((m) => m.id === openId) : null

  return (
    <>
      <PageHeader title="Contact Messages" subtitle="Messages sent from the public website's Contact page, newest first. Only admins can see them." />
      {message && <Alert tone="success">{message}</Alert>}
      <div className="ds-filters">
        <Field
          label="Status"
          hint={
            !query.loading && !query.error
              ? `${all.length} ${all.length === 1 ? 'message' : 'messages'} · ${all.filter((m) => m.status === 'new').length} new`
              : undefined
          }
        >
          {(p) => (
            <Select {...p} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {query.loading ? (
        <LoadingState lines={5} label="Loading messages…" />
      ) : query.error ? (
        <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
      ) : (
        <Card flush>
          <DataTable
            caption="Contact messages"
            rowKey={(m) => m.id}
            rows={shown}
            empty={<EmptyState icon="inbox">{all.length === 0 ? 'No messages yet.' : 'No messages with this status.'}</EmptyState>}
            columns={[
              { key: 'from', header: 'From', primary: true, render: (m) => m.name },
              { key: 'received', header: 'Received', render: (m) => <span className="ds-small">{formatDateTime(m.submitted_at)}</span> },
              { key: 'subject', header: 'Subject', render: (m) => m.subject ?? <span className="ds-muted">—</span> },
              { key: 'status', header: 'Status', render: (m) => <Badge status={m.status}>{statusOf(m.status).label}</Badge> },
              {
                key: 'actions',
                header: 'Actions',
                render: (m) => (
                  <div className="ds-row-actions">
                    <button type="button" className="ds-btn ds-btn-link" onClick={() => setOpenId(openId === m.id ? null : m.id)} aria-expanded={openId === m.id}>
                      View
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </Card>
      )}
      {open && (
        <MessageDetails
          key={open.updated_at}
          m={open}
          onClose={() => setOpenId(null)}
          onChanged={(text) => {
            setMessage(text)
            query.reload()
          }}
        />
      )}
    </>
  )
}

function MessageDetails({ m, onClose, onChanged }) {
  const [status, setStatus] = useState(m.status)
  const [notes, setNotes] = useState(m.internal_notes ?? '')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const changed = status !== m.status || notes.trim() !== (m.internal_notes ?? '')

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await runWrite(
        supabase.from('contact_messages').update({ status, internal_notes: notes.trim() || null }).eq('id', m.id).select('id'),
      )
      onChanged(`Saved the message from ${m.name}.`)
    } catch (err) {
      setError(friendlyDbError(err))
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={`Message from ${m.name}`}
      onClose={onClose}
      busy={saving}
      footer={
        <div className="ds-form-actions" style={{ margin: 0, width: '100%' }}>
          <DeleteAction
            itemName={`the message from ${m.name}`}
            buttonClassName="ds-btn ds-btn-secondary"
            dependencyChecks={[]}
            onDelete={() => runWrite(supabase.from('contact_messages').delete().eq('id', m.id).select('id'))}
            onDeleted={() => onChanged(`Deleted the message from ${m.name}.`)}
          />
          <Button type="submit" form="contact-message-form" disabled={saving || !changed}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <form id="contact-message-form" onSubmit={save}>
        <dl className="ds-facts">
          <dt>Email</dt>
          <dd>
            <a href={`mailto:${m.email}${m.subject ? `?subject=${encodeURIComponent(`Re: ${m.subject}`)}` : ''}`}>{m.email}</a>
          </dd>
          <dt>Phone</dt>
          <dd>{m.phone ? <a href={`tel:${m.phone}`}>{m.phone}</a> : <span className="ds-muted">—</span>}</dd>
          {m.subject && (
            <>
              <dt>Subject</dt>
              <dd>{m.subject}</dd>
            </>
          )}
          <dt>Message</dt>
          <dd>{m.message}</dd>
        </dl>
        <Field label="Status">
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Internal notes" hint="Staff only, never shown to the sender or the public.">
          {(p) => <TextArea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  )
}
