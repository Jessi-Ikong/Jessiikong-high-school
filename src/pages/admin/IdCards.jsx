import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { fullName, byName } from '../../lib/people'
import { formatDateTime } from '../../lib/assignments'
// The card code (jsPDF + qrcode) is loaded only when cards are made.
const loadCardTools = () => import('../../lib/idCards')
import { useAsyncData } from '../../hooks/useAsyncData'
import ConfirmDialog from '../../components/ConfirmDialog'

async function fetchPage() {
  const session = await run(supabase.from('sessions').select('id, name').eq('is_current', true).maybeSingle())
  const [classes, cards] = await Promise.all([
    run(supabase.from('classes').select('id, name, level').order('level')),
    session
      ? run(
          supabase
            .from('id_cards')
            .select('id, card_number, issued_at, is_active, revoked_at, revoked_reason, users!id_cards_user_id_fkey(id, first_name, middle_name, last_name, role)')
            .eq('session_id', session.id)
            .order('issued_at', { ascending: false }),
        )
      : [],
  ])
  return { session, classes, cards }
}

// The people a bulk run covers: active teachers, or students actively enrolled
// in one class this session.
async function targetUserIds(target, sessionId) {
  if (target === 'staff') {
    const teachers = await run(supabase.from('teachers').select('users!inner(id, is_active)').eq('users.is_active', true))
    return teachers.map((t) => t.users.id)
  }
  const enrollments = await run(
    supabase
      .from('enrollments')
      .select('students(users!inner(id, is_active))')
      .eq('session_id', sessionId)
      .eq('class_id', target)
      .eq('status', 'active'),
  )
  return enrollments.map((e) => e.students?.users).filter((u) => u?.is_active).map((u) => u.id)
}

// Both admin tiers: issue / download ID cards in bulk, and revoke cards.
export default function IdCards() {
  const query = useAsyncData(fetchPage, 'admin-id-cards')
  const [target, setTarget] = useState('staff')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [revoking, setRevoking] = useState(null)

  if (query.loading) return <p className="muted">Loading…</p>
  if (query.error) return <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
  const { session, classes, cards } = query.data

  if (!session) {
    return (
      <>
        <h1>ID cards</h1>
        <p className="empty-state">No session is marked as current, so ID cards can&apos;t be issued yet.</p>
      </>
    )
  }

  const targetName = target === 'staff' ? 'all staff' : classes.find((c) => c.id === target)?.name

  async function generate() {
    setBusy(true)
    setMessage(null)
    try {
      const userIds = await targetUserIds(target, session.id)
      if (userIds.length === 0) throw new Error(`There is no one to issue cards for in ${targetName}.`)
      const { issueCards, downloadCardsPdf } = await loadCardTools()
      const details = await issueCards(userIds)
      await downloadCardsPdf(details, `ID-cards-${targetName.replace(/\s+/g, '-')}-${session.name.replace('/', '-')}.pdf`)
      const photos = details.filter((d) => d.photo_path).length
      setMessage({
        ok: true,
        text: `Downloaded ${details.length} ID ${details.length === 1 ? 'card' : 'cards'} for ${targetName} (one per page). ${
          details.length - photos > 0 ? `${details.length - photos} without a photo (initials shown instead).` : 'All have photos.'
        }`,
      })
      query.reload()
    } catch (err) {
      setMessage({ ok: false, text: err.code ? friendlyDbError(err) : err.message })
    } finally {
      setBusy(false)
    }
  }

  async function downloadOne(card) {
    setMessage(null)
    try {
      const { fetchCardDetails, downloadCardsPdf } = await loadCardTools()
      const details = await fetchCardDetails([card.id])
      await downloadCardsPdf(details, `ID-card-${card.card_number}.pdf`)
    } catch (err) {
      setMessage({ ok: false, text: err.code ? friendlyDbError(err) : err.message })
    }
  }

  const sorted = [...cards].sort((a, b) => Number(b.is_active) - Number(a.is_active) || byName(a.users, b.users))

  return (
    <>
      <h1>ID cards</h1>
      <p className="muted">
        Cards are issued per session ({session.name}); each person has at most one active card. Issuing again reuses
        their active card. The QR code on each card opens a public page that shows only name, photo, role, class /
        department and session.
      </p>

      <section className="panel">
        <h2>Generate cards</h2>
        <div className="filter-bar">
          <label className="inline-field">
            For
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="staff">All staff (active teachers)</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  Class {c.name} (active students)
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={generate} disabled={busy}>
            {busy ? 'Preparing PDF…' : 'Issue & download PDF'}
          </button>
        </div>
        {message && (
          <p className={message.ok ? 'alert alert-success' : 'alert alert-error'} role={message.ok ? 'status' : 'alert'}>
            {message.text}
          </p>
        )}
        <p className="muted small">
          One PDF, one card per page (85.6 × 54 mm), ready to print. People without a photo get their initials; set
          photos on the Students / Staff pages first.
        </p>
      </section>

      <h2>
        Cards issued for {session.name} <span className="muted small">({cards.length})</span>
      </h2>
      {cards.length === 0 ? (
        <p className="empty-state">No cards issued yet this session.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Card no.</th>
                <th>Issued</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id}>
                  <td>{fullName(c.users)}</td>
                  <td>{c.users.role === 'student' ? 'Student' : 'Teacher'}</td>
                  <td>{c.card_number}</td>
                  <td className="small">{formatDateTime(c.issued_at)}</td>
                  <td>
                    {c.is_active ? (
                      <span className="badge">Active</span>
                    ) : (
                      <>
                        <span className="badge badge-late">Revoked</span>
                        {c.revoked_reason && <div className="muted small">{c.revoked_reason}</div>}
                      </>
                    )}
                  </td>
                  <td className="row-actions">
                    {c.is_active && (
                      <>
                        <button type="button" className="button-link" onClick={() => downloadOne(c)}>
                          Download
                        </button>
                        <button type="button" className="button-link danger" onClick={() => setRevoking(c)}>
                          Revoke
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revoking && (
        <RevokeDialog
          card={revoking}
          onClose={() => setRevoking(null)}
          onRevoked={() => {
            setRevoking(null)
            setMessage({ ok: true, text: `Card ${revoking.card_number} was revoked. Its QR code now shows "not valid".` })
            query.reload()
          }}
        />
      )}
    </>
  )
}

function RevokeDialog({ card, onClose, onRevoked }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function revoke() {
    setBusy(true)
    setError(null)
    try {
      await runWrite(
        supabase
          .from('id_cards')
          .update({ is_active: false, revoked_at: new Date().toISOString(), revoked_reason: reason.trim() || null })
          .eq('id', card.id)
          .select('id'),
      )
      onRevoked()
    } catch (err) {
      setError(friendlyDbError(err))
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      title={`Revoke card ${card.card_number}?`}
      confirmLabel="Revoke card"
      danger
      busy={busy}
      error={error}
      onConfirm={revoke}
      onCancel={onClose}
    >
      <p>
        {fullName(card.users)}&apos;s card stops working at once: scanning its QR code will show &quot;not valid&quot;. A
        new card can be issued afterwards (it gets a new number and QR code).
      </p>
      <label className="span-all">
        Reason (optional)
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. lost, left the school" maxLength={200} />
      </label>
    </ConfirmDialog>
  )
}
