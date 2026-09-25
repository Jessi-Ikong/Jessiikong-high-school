import { Link } from 'react-router-dom'
import { friendlyDbError } from '../lib/db'
import { fetchAnnouncements } from '../lib/announcements'
import { fetchThreads, snippet } from '../lib/messages'
import { formatDateTime, formatMark } from '../lib/assignments'
import { formatDate } from '../lib/format'
import { toIsoDate } from '../lib/dates'
import { useAsyncData } from '../hooks/useAsyncData'

// Building blocks shared by the dashboards.

// A dashboard panel: heading, optional "see all" link, body.
export function DashPanel({ title, to, linkText = 'See all →', children, className = '' }) {
  return (
    <section className={`panel dash-panel ${className}`}>
      <header className="dash-panel-header">
        <h2>{title}</h2>
        {to && (
          <Link to={to} className="small">
            {linkText}
          </Link>
        )}
      </header>
      {children}
    </section>
  )
}

// Loading / error states for one useAsyncData query; renders children(data)
// once loaded. Each panel loads on its own, so one failing doesn't blank the page.
export function Loaded({ query, children }) {
  if (query.loading) return <p className="muted small">Loading…</p>
  if (query.error) return <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
  return children(query.data)
}

export function Stat({ label, value, hint, tone }) {
  return (
    <div className={`dash-stat${tone ? ` dash-stat-${tone}` : ''}`}>
      <span className="dash-stat-value">{value}</span>
      <span className="dash-stat-label">{label}</span>
      {hint && <span className="dash-stat-hint">{hint}</span>}
    </div>
  )
}

// The newest 3 announcements meant for the viewer (the database filters them).
export function AnnouncementsPreview({ base }) {
  const query = useAsyncData(() => fetchAnnouncements(3), 'dash-announcements')
  return (
    <DashPanel title="Announcements" to={`${base}/announcements`}>
      <Loaded query={query}>
        {(items) =>
          items.length === 0 ? (
            <p className="muted small">No announcements yet.</p>
          ) : (
            <ul className="dash-list">
              {items.map((a) => (
                <li key={a.id}>
                  <Link to={`${base}/announcements`}>
                    <strong>{a.title}</strong>
                  </Link>
                  <span className="muted small"> · {formatDateTime(a.published_at)}</span>
                  <div className="small">{snippet(a.body, 120)}</div>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
    </DashPanel>
  )
}

// Unread count and the 3 most recent conversations (the caller's own only).
export function MessagesPreview({ base }) {
  const query = useAsyncData(fetchThreads, 'dash-threads')
  return (
    <DashPanel title="Messages" to={`${base}/messages`}>
      <Loaded query={query}>
        {(threads) => {
          const unread = threads.reduce((n, t) => n + Number(t.unread_count ?? 0), 0)
          const recent = threads.filter((t) => t.last_message_at).slice(0, 3)
          return (
            <>
              <p className={`small${unread ? '' : ' muted'}`}>
                {unread ? (
                  <strong>
                    {unread} unread {unread === 1 ? 'message' : 'messages'}
                  </strong>
                ) : (
                  'No unread messages.'
                )}
              </p>
              {recent.length === 0 ? (
                <p className="muted small">No conversations yet.</p>
              ) : (
                <ul className="dash-list">
                  {recent.map((t) => (
                    <li key={t.thread_id}>
                      <Link to={`${base}/messages?thread=${t.thread_id}`}>
                        <strong>{t.other_name}</strong>
                      </Link>
                      {Number(t.unread_count) > 0 && <span className="badge badge-warning">{t.unread_count} new</span>}
                      <div className="small muted">
                        {t.last_sender_is_me ? 'You: ' : ''}
                        {snippet(t.last_message, 80)} · {formatDateTime(t.last_message_at)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )
        }}
      </Loaded>
    </DashPanel>
  )
}

// Output of recentGrades(): "Mathematics — CA 1: 18 / 20"
export function GradeList({ items, empty = 'No grades recorded yet.' }) {
  if (items.length === 0) return <p className="muted small">{empty}</p>
  return (
    <ul className="dash-list">
      {items.map((g) => (
        <li key={g.key} className="dash-row">
          <span>
            {g.subject && <strong>{g.subject}</strong>} {g.subject && '— '}
            {g.label}
          </span>
          <span>
            <strong>{formatMark(g.mark)}</strong>
            {g.max !== null && <span className="muted"> / {formatMark(g.max)}</span>}
            {g.at && <span className="muted small"> · {formatDate(toIsoDate(new Date(g.at)))}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}
