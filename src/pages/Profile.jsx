import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { friendlyDbError, run } from '../lib/db'
import { fullName } from '../lib/people'
import { useAsyncData } from '../hooks/useAsyncData'
import { useAuth } from '../hooks/useAuth'
import PhotoUpload from '../components/PhotoUpload'

const ROLE_LABELS = { teacher: 'Teacher', student: 'Student', parent: 'Parent', admin: 'Admin' }

// "My Profile" for teachers, students and parents: name, photo, and (for
// teachers and students) the ID card download. Not a full profile editor.
export default function Profile() {
  const { profile } = useAuth()
  const query = useAsyncData(
    () => run(supabase.from('users').select('id, first_name, middle_name, last_name, email, role, photo_url').eq('id', profile.id).single()),
    `my-profile:${profile.id}`,
  )

  if (query.loading) return <p className="muted">Loading…</p>
  if (query.error) return <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
  const me = query.data

  return (
    <>
      <h1>My profile</h1>
      <section className="panel profile-panel">
        <PhotoUpload userId={me.id} name={fullName(me)} path={me.photo_url} size={96} onChanged={query.reload} />
        <div>
          <h2>{fullName(me)}</h2>
          <p className="muted">
            {ROLE_LABELS[me.role] ?? me.role}
            {me.email ? ` · ${me.email}` : ''}
          </p>
          <p className="muted small">
            Photo: JPG, PNG or WebP, up to 5 MB. It appears on your ID card
            {me.role === 'parent' ? '' : ' and on its verification page'}. To change your name or email, contact the school
            office.
          </p>
        </div>
      </section>
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
    <section className="panel">
      <h2>ID card</h2>
      <p className="muted small">
        Your ID card for this session, as a PDF (standard card size, 85.6 × 54 mm). Its QR code opens a public page that
        confirms the card is valid. Downloading again gives the same card.
      </p>
      {!hasPhoto && <p className="alert alert-info-plain small">Add a photo above first, so it appears on your card.</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {done && <p className="alert alert-success" role="status">{done}</p>}
      <button type="button" onClick={download} disabled={busy}>
        {busy ? 'Preparing…' : 'Download my ID card'}
      </button>
    </section>
  )
}
