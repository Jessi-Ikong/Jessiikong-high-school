import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { formatDateTime } from '../../lib/assignments'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'

// General messages sent from the public website's Contact page (both admin
// tiers). Only admins can read them; anyone can send one (migration 41).
// Admissions questions have their own page (Admissions Inquiries).

const STATUSES = [
  { value: 'new', label: 'New', badge: 'badge-warning' },
  { value: 'replied', label: 'Replied', badge: 'badge-info' },
  { value: 'closed', label: 'Closed', badge: 'badge-muted' },
]
const statusOf = (value) => STATUSES.find((s) => s.value === value) ?? { label: value, badge: '' }

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

  return (
    <>
      <h1>Contact Messages</h1>
      <p className="muted">
        Messages sent from the public website&apos;s Contact page, newest first. Only admins can see them.
      </p>
      {message && <p className="alert alert-success" role="status">{message}</p>}
      <div className="filter-bar">
        <label className="inline-field">
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {!query.loading && !query.error && (
          <span className="muted small">
            {all.length} {all.length === 1 ? 'message' : 'messages'} · {all.filter((m) => m.status === 'new').length} new
          </span>
        )}
      </div>

      {query.loading ? (
        <p className="muted">Loading messages…</p>
      ) : query.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
      ) : shown.length === 0 ? (
        <p className="empty-state">{all.length === 0 ? 'No messages yet.' : 'No messages with this status.'}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>From</th>
                <th>Subject</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const open = openId === m.id
                const status = statusOf(m.status)
                return (
                  <FragmentRows
                    key={m.id}
                    m={m}
                    open={open}
                    status={status}
                    onToggle={() => setOpenId(open ? null : m.id)}
                    onChanged={(text) => {
                      setMessage(text)
                      query.reload()
                    }}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function FragmentRows({ m, open, status, onToggle, onChanged }) {
  return (
    <>
      <tr className={m.status === 'new' ? 'is-new' : ''}>
        <td className="small">{formatDateTime(m.submitted_at)}</td>
        <td>{m.name}</td>
        <td>{m.subject ?? <span className="muted">—</span>}</td>
        <td>
          <span className={`badge ${status.badge}`}>{status.label}</span>
        </td>
        <td>
          <button type="button" className="button-link" onClick={onToggle} aria-expanded={open}>
            {open ? 'Close' : 'View'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="inquiry-details-row">
          <td colSpan={5}>
            <MessageDetails key={m.updated_at} m={m} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  )
}

function MessageDetails({ m, onChanged }) {
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
    <form className="inquiry-details" onSubmit={save}>
      <dl className="inquiry-facts">
        <dt>Email</dt>
        <dd>
          <a href={`mailto:${m.email}${m.subject ? `?subject=${encodeURIComponent(`Re: ${m.subject}`)}` : ''}`}>{m.email}</a>
        </dd>
        <dt>Phone</dt>
        <dd>{m.phone ? <a href={`tel:${m.phone}`}>{m.phone}</a> : <span className="muted">—</span>}</dd>
        <dt>Message</dt>
        <dd className="submission-text">{m.message}</dd>
      </dl>
      <div className="form-grid">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="span-all">
          Internal notes <span className="muted small">(staff only, never shown to the sender or the public)</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
        </label>
      </div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="row-actions">
        <button type="submit" disabled={saving || !changed}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <DeleteAction
          itemName={`the message from ${m.name}`}
          dependencyChecks={[]}
          onDelete={() => runWrite(supabase.from('contact_messages').delete().eq('id', m.id).select('id'))}
          onDeleted={() => onChanged(`Deleted the message from ${m.name}.`)}
        />
      </div>
    </form>
  )
}
