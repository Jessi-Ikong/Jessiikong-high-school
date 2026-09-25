import { useState } from 'react'
import { friendlyDbError } from '../../lib/db'
import { formatDateTime } from '../../lib/assignments'
import { INQUIRY_STATUSES, deleteInquiry, fetchInquiries, updateInquiry } from '../../lib/publicContent'
import { useAsyncData } from '../../hooks/useAsyncData'
import DeleteAction from '../../components/DeleteAction'

// Admissions inquiries sent from the public website (both admin tiers).
// Families' contact details: only admins can read these (the database lets
// anyone SUBMIT one, never read one). Internal notes are staff-only.

const STATUS_BADGE = { new: 'badge-warning', contacted: 'badge-info', enrolled: '', declined: 'badge-muted' }
const statusLabel = (value) => INQUIRY_STATUSES.find((s) => s.value === value)?.label ?? value

export default function AdmissionsInquiries() {
  const query = useAsyncData(fetchInquiries, 'admin-inquiries')
  const [statusFilter, setStatusFilter] = useState('')
  const [openId, setOpenId] = useState(null)
  const [message, setMessage] = useState(null)

  const all = query.data ?? []
  const shown = statusFilter ? all.filter((i) => i.status === statusFilter) : all
  const newCount = all.filter((i) => i.status === 'new').length

  return (
    <>
      <h1>Admissions Inquiries</h1>
      <p className="muted">
        Inquiries from families using the public website, newest first. These contain private contact details: only
        admins can see them.
      </p>
      {message && <p className="alert alert-success" role="status">{message}</p>}
      <div className="filter-bar">
        <label className="inline-field">
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            {INQUIRY_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {!query.loading && !query.error && (
          <span className="muted small">
            {all.length} {all.length === 1 ? 'inquiry' : 'inquiries'} · {newCount} new
          </span>
        )}
      </div>

      {query.loading ? (
        <p className="muted">Loading inquiries…</p>
      ) : query.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
      ) : shown.length === 0 ? (
        <p className="empty-state">{all.length === 0 ? 'No inquiries yet.' : 'No inquiries with this status.'}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Parent / guardian</th>
                <th>Child</th>
                <th>Class wanted</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <InquiryRow
                  key={i.id}
                  inquiry={i}
                  open={openId === i.id}
                  onToggle={() => setOpenId(openId === i.id ? null : i.id)}
                  onChanged={(text) => {
                    setMessage(text)
                    query.reload()
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function InquiryRow({ inquiry: i, open, onToggle, onChanged }) {
  return (
    <>
      <tr className={i.status === 'new' ? 'is-new' : ''}>
        <td className="small">{formatDateTime(i.submitted_at)}</td>
        <td>{i.parent_name}</td>
        <td>{i.child_name}</td>
        <td>{i.desired_class}</td>
        <td>
          <span className={`badge ${STATUS_BADGE[i.status] ?? ''}`}>{statusLabel(i.status)}</span>
        </td>
        <td>
          <button type="button" className="button-link" onClick={onToggle} aria-expanded={open}>
            {open ? 'Close' : 'View'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="inquiry-details-row">
          <td colSpan={6}>
            <InquiryDetails key={i.updated_at} inquiry={i} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  )
}

function InquiryDetails({ inquiry: i, onChanged }) {
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
    <form className="inquiry-details" onSubmit={save}>
      <dl className="inquiry-facts">
        <dt>Email</dt>
        <dd>
          <a href={`mailto:${i.email}`}>{i.email}</a>
        </dd>
        <dt>Phone</dt>
        <dd>{i.phone ? <a href={`tel:${i.phone}`}>{i.phone}</a> : <span className="muted">—</span>}</dd>
        <dt>Child</dt>
        <dd>
          {i.child_name} · {i.desired_class}
        </dd>
        <dt>Message</dt>
        <dd className="submission-text">{i.message ?? <span className="muted">—</span>}</dd>
        <dt>Received</dt>
        <dd>{formatDateTime(i.submitted_at)}</dd>
      </dl>
      <div className="form-grid">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {INQUIRY_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="span-all">
          Internal notes <span className="muted small">(staff only, never shown to the family or the public)</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
        </label>
      </div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="row-actions">
        <button type="submit" disabled={saving || !changed}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <DeleteAction
          itemName={`the inquiry from ${i.parent_name}`}
          dependencyChecks={[]}
          onDelete={() => deleteInquiry(i.id)}
          onDeleted={() => onChanged(`Deleted the inquiry from ${i.parent_name}.`)}
        />
      </div>
    </form>
  )
}
