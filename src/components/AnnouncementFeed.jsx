import { friendlyDbError } from '../lib/db'
import { audienceLabel, fetchAnnouncements } from '../lib/announcements'
import { formatDateTime } from '../lib/assignments'
import { useAsyncData } from '../hooks/useAsyncData'

// Newest-first announcements for the signed-in teacher / student / parent.
// The database only returns the ones meant for them.
export default function AnnouncementFeed() {
  const query = useAsyncData(fetchAnnouncements, 'announcement-feed')

  return (
    <>
      <h1>Announcements</h1>
      {query.loading ? (
        <p className="muted">Loading…</p>
      ) : query.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
      ) : query.data.length === 0 ? (
        <p className="empty-state">No announcements yet.</p>
      ) : (
        <div className="announcement-list">
          {query.data.map((a) => (
            <article key={a.id} className="panel announcement">
              <header className="announcement-header">
                <h2>{a.title}</h2>
                {a.audience !== 'all' && <span className="badge badge-info">{audienceLabel(a)}</span>}
              </header>
              <p className="muted small">
                Posted by {a.author_name ?? 'the school'} · {formatDateTime(a.published_at)}
              </p>
              <div className="announcement-body">{a.body}</div>
            </article>
          ))}
        </div>
      )}
    </>
  )
}
