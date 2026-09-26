import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run, runWrite } from '../../lib/db'
import { fullName, byName } from '../../lib/people'
import { formatDateTime } from '../../lib/assignments'
// The card code (jsPDF + qrcode) is loaded only when cards are made.
const loadCardTools = () => import('../../lib/idCards')
import { useAsyncData } from '../../hooks/useAsyncData'
import ConfirmDialog from '../../components/ConfirmDialog'
import { Alert, Badge, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, Select, TextInput } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'

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

  if (query.loading) return <LoadingState lines={6} />
  if (query.error) return <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
  const { session, classes, cards } = query.data

  if (!session) {
    return (
      <>
        <PageHeader title="ID cards" />
        <Card>
          <EmptyState icon="card">No session is marked as current, so ID cards can&apos;t be issued yet.</EmptyState>
        </Card>
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
      <PageHeader
        title="ID cards"
        subtitle={`Cards are issued per session (${session.name}); each person has at most one active card. Issuing again reuses their active card. The QR code on each card opens a public page that shows only name, photo, role, class / department and session.`}
      />

      <Card title="Generate cards">
        <div className="ds-filters">
          <Field label="For">
            {(p) => (
              <Select {...p} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="staff">All staff (active teachers)</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    Class {c.name} (active students)
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Button onClick={generate} disabled={busy}>
          {busy ? 'Preparing PDF…' : 'Issue & download PDF'}
        </Button>
        {message && (
          <div style={{ marginTop: 12 }}>
            <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>
          </div>
        )}
        <p className="ds-note" style={{ marginTop: 12 }}>
          One PDF, one card per page (85.6 × 54 mm), ready to print. People without a photo get their initials; set photos on the Students / Staff pages first.
        </p>
      </Card>

      <Card title={`Cards issued for ${session.name} (${cards.length})`} flush>
        <DataTable
          caption={`ID cards issued for ${session.name}`}
          rowKey={(c) => c.id}
          rows={sorted}
          empty={<EmptyState icon="card">No cards issued yet this session.</EmptyState>}
          columns={[
            { key: 'name', header: 'Name', primary: true, render: (c) => fullName(c.users) },
            { key: 'role', header: 'Role', render: (c) => (c.users.role === 'student' ? 'Student' : 'Teacher') },
            { key: 'number', header: 'Card no.', render: (c) => c.card_number },
            { key: 'issued', header: 'Issued', render: (c) => <span className="ds-small">{formatDateTime(c.issued_at)}</span> },
            {
              key: 'status',
              header: 'Status',
              render: (c) =>
                c.is_active ? (
                  <Badge status="active">Active</Badge>
                ) : (
                  <span>
                    <Badge status="revoked">Revoked</Badge>
                    {c.revoked_reason && <span className="ds-muted ds-small" style={{ display: 'block' }}>{c.revoked_reason}</span>}
                  </span>
                ),
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (c) =>
                c.is_active ? (
                  <div className="ds-row-actions">
                    <button type="button" className="ds-btn ds-btn-link" onClick={() => downloadOne(c)}>
                      Download
                    </button>
                    <button type="button" className="ds-btn ds-btn-link ds-btn-link-danger" onClick={() => setRevoking(c)}>
                      Revoke
                    </button>
                  </div>
                ) : (
                  <span className="ds-muted">—</span>
                ),
            },
          ]}
        />
      </Card>
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
      <Field label="Reason" hint="Optional">
        {(p) => <TextInput {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. lost, left the school" maxLength={200} />}
      </Field>
    </ConfirmDialog>
  )
}
