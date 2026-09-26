import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { friendlyDbError, run } from '../lib/db'
import { fullName } from '../lib/people'
import { useAsyncData } from '../hooks/useAsyncData'
import { useAuth } from '../hooks/useAuth'
import PhotoUpload from '../components/PhotoUpload'
import ChangePassword from '../components/ChangePassword'
import { Alert, Button, Card, LoadingState, PageHeader } from '../components/ui/Primitives'

const ROLE_LABELS = { teacher: 'Teacher', student: 'Student', parent: 'Parent', admin: 'Admin' }
const ADMIN_LEVELS = { super_admin: 'Super admin', limited_admin: 'Limited admin' }

// "My Profile" for every role (admins too): name, photo, change password,
// and (for teachers and students) the ID card download. Not a full profile editor.
export default function Profile() {
  const { profile } = useAuth()
  const query = useAsyncData(
    () => run(supabase.from('users').select('id, first_name, middle_name, last_name, email, role, photo_url').eq('id', profile.id).single()),
    `my-profile:${profile.id}`,
  )

  if (query.loading) return <LoadingState lines={4} />
  if (query.error) return <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
  const me = query.data

  return (
    <>
      <PageHeader title="My profile" />
      <Card>
        <div className="ds-profile">
          <PhotoUpload userId={me.id} name={fullName(me)} path={me.photo_url} size={96} onChanged={query.reload} />
          <div style={{ minWidth: 0 }}>
            <h2 className="ds-h2" style={{ fontSize: 'var(--ds-text-lg)' }}>
              {fullName(me)}
            </h2>
            <p className="ds-muted" style={{ margin: '4px 0 8px', overflowWrap: 'anywhere' }}>
              {me.role === 'admin' ? (ADMIN_LEVELS[profile.admin_level] ?? 'Admin') : (ROLE_LABELS[me.role] ?? me.role)}
              {me.email ? ` · ${me.email}` : ''}
            </p>
            <p className="ds-note" style={{ margin: 0 }}>
              {me.role === 'admin'
                ? 'Photo: JPG, PNG or WebP, up to 5 MB. To change your name or email, ask a super admin.'
                : `Photo: JPG, PNG or WebP, up to 5 MB. It appears on your ID card${me.role === 'parent' ? '' : ' and on its verification page'}. To change your name or email, contact the school office.`}
            </p>
          </div>
        </div>
      </Card>
      <ChangePassword />
      {(me.role === 'teacher' || me.role === 'student') && <MyIdCard hasPhoto={Boolean(me.photo_url)} />}
    </>
  )
}

function MyIdCard({ hasPhoto }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  async function download() {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      // Loaded only now: the PDF / QR code libraries are large.
      const { downloadCardsPdf, issueMyCard } = await import('../lib/idCards')
      const cards = await issueMyCard()
      await downloadCardsPdf(cards, `ID-card-${cards[0].card_number}.pdf`)
      setDone(`Downloaded card ${cards[0].card_number} (${cards[0].session_name}).`)
    } catch (err) {
      setError(err.code ? friendlyDbError(err) : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="ID card">
      <p className="ds-note" style={{ marginTop: 0 }}>
        Your ID card for this session, as a PDF (standard card size, 85.6 × 54 mm). Its QR code opens a public page that
        confirms the card is valid. Downloading again gives the same card.
      </p>
      {!hasPhoto && <Alert tone="info">Add a photo above first, so it appears on your card.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}
      <Button onClick={download} disabled={busy}>
        {busy ? 'Preparing…' : 'Download my ID card'}
      </Button>
    </Card>
  )
}
