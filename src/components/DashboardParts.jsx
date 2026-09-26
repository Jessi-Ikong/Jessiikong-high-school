import { Link } from 'react-router-dom'
import { friendlyDbError } from '../lib/db'
import { fetchAnnouncements } from '../lib/announcements'
import { fetchThreads, snippet } from '../lib/messages'
import { formatDateTime, formatMark } from '../lib/assignments'
import { formatDate } from '../lib/format'
import { toIsoDate } from '../lib/dates'
import { useAsyncData } from '../hooks/useAsyncData'
import { Alert, Badge, Card, LoadingState, StatCard } from './ui/Primitives'

// Building blocks shared by the teacher / student / parent dashboards
// (design system: styles/app.css).

// A dashboard panel: a Card with a heading, optional "see all" link, body.
export function DashPanel({ title, to, linkText = 'See all →', children, className = '' }) {
  return (
    <Card title={title} className={className} action={to && <Link to={to}>{linkText}</Link>}>
      {children}
    </Card>
  )
}

// Loading / error states for one useAsyncData query; renders children(data)
// once loaded. Each panel loads on its own, so one failing doesn't blank the page.
export function Loaded({ query, children }) {
  if (query.loading) return <LoadingState lines={3} />
  if (query.error) return <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
  return children(query.data)
}

// tone: undefined | 'warn' (shown with the design system's warning edge)
export function Stat({ label, value, hint, tone }) {
  return <StatCard label={label} value={value} hint={hint} tone={tone === 'warn' ? 'warning' : tone} />
}

// The newest 3 announcements meant for the viewer (the database filters them).
export function AnnouncementsPreview({ base }) {
  const query = useAsyncData(() => fetchAnnouncements(3), 'dash-announcements')
  return (
    <DashPanel title="Announcements" to={`${base}/announcements`}>
      <Loaded query={query}>
        {(items) =>
          items.length === 0 ? (
            <p className="ds-note">No announcements yet.</p>
          ) : (
            <ul className="ds-dash-list">
              {items.map((a) => (
                <li key={a.id}>
                  <Link to={`${base}/announcements`}>
                    <strong>{a.title}</strong>
                  </Link>
                  <span className="ds-muted ds-small"> · {formatDateTime(a.published_at)}</span>
                  <div className="ds-small">{snippet(a.body, 120)}</div>
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
              <p className={`ds-small${unread ? '' : ' ds-muted'}`} style={{ marginTop: 0 }}>
                {unread ? (
                  <strong>
                    {unread} unread {unread === 1 ? 'message' : 'messages'}
                  </strong>
                ) : (
                  'No unread messages.'
                )}
              </p>
              {recent.length === 0 ? (
                <p className="ds-note">No conversations yet.</p>
              ) : (
                <ul className="ds-dash-list">
                  {recent.map((t) => (
                    <li key={t.thread_id}>
                      <span className="ds-inline">
                        <Link to={`${base}/messages?thread=${t.thread_id}`}>
                          <strong>{t.other_name}</strong>
                        </Link>
                        {Number(t.unread_count) > 0 && <Badge status="unread">{t.unread_count} new</Badge>}
                      </span>
                      <div className="ds-small ds-muted" style={{ overflowWrap: 'anywhere' }}>
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
  if (items.length === 0) return <p className="ds-note">{empty}</p>
  return (
    <ul className="ds-dash-list">
      {items.map((g) => (
        <li key={g.key} className="ds-dash-row">
          <span>
            {g.subject && <strong>{g.subject}</strong>} {g.subject && '— '}
            {g.label}
          </span>
          <span>
            <strong>{formatMark(g.mark)}</strong>
            {g.max !== null && <span className="ds-muted"> / {formatMark(g.max)}</span>}
            {g.at && <span className="ds-muted ds-small"> · {formatDate(toIsoDate(new Date(g.at)))}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}
