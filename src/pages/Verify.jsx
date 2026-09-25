import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAsyncData } from '../hooks/useAsyncData'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROLE_LABELS = { teacher: 'Staff (teacher)', student: 'Student' }

// Public ID card verification (no login): /verify/<token from the QR code>.
// The verify-card Edge Function returns ONLY display-safe fields, and only for
// an active card of an active person, with a 2-minute signed link to THAT
// card's photo (the avatars bucket is private). Otherwise: not valid.
async function verify(token) {
  if (!UUID_RE.test(token ?? '')) return null
  const { data, error } = await supabase.functions.invoke('verify-card', { body: { token } })
  if (error) throw error
  return data?.valid ? data.card : null
}

export default function Verify() {
  const { token } = useParams()
  const query = useAsyncData(() => verify(token), `verify:${token}`)
  const card = query.data

  return (
    <main className="verify-page">
      <div className="verify-card">
        <p className="verify-school">Jessiikong High School · ID card check</p>
        {query.loading ? (
          <p className="muted">Checking…</p>
        ) : query.error ? (
          <p className="alert alert-error" role="alert">
            The card couldn&apos;t be checked right now. Please try again in a moment.
          </p>
        ) : card ? (
          <>
            <p className="verify-status is-valid" role="status">
              ✅ Valid ID card
            </p>
            <div className="verify-person">
              {card.photo_url ? (
                <img className="verify-photo" src={card.photo_url} alt={`Photo of ${card.full_name}`} />
              ) : (
                <div className="verify-photo verify-photo-empty" aria-hidden="true">
                  No photo
                </div>
              )}
              <dl>
                <dt>Name</dt>
                <dd>{card.full_name}</dd>
                <dt>Role</dt>
                <dd>{ROLE_LABELS[card.role] ?? card.role}</dd>
                {card.role === 'student' ? (
                  <>
                    <dt>Class</dt>
                    <dd>{card.class_name ? `${card.class_name} ${card.section_name ?? ''}`.trim() : 'Not enrolled this session'}</dd>
                  </>
                ) : (
                  card.department && (
                    <>
                      <dt>Department</dt>
                      <dd>{card.department}</dd>
                    </>
                  )
                )}
                <dt>Session</dt>
                <dd>{card.session_name}</dd>
                <dt>Card number</dt>
                <dd>{card.card_number}</dd>
              </dl>
            </div>
          </>
        ) : (
          <>
            <p className="verify-status is-invalid" role="alert">
              ❌ This ID card is not valid
            </p>
            <p className="muted small">
              The code doesn&apos;t match an active Jessiikong High School ID card. It may have been revoked or replaced,
              or the link may be incomplete. Please contact the school office.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
