import { friendlyDbError } from '../lib/db'
import { audienceLabel, fetchAnnouncements } from '../lib/announcements'
import { formatDateTime } from '../lib/assignments'
import { useAsyncData } from '../hooks/useAsyncData'
import { Alert, Badge, Card, EmptyState, LoadingState, PageHeader } from './ui/Primitives'

// Newest-first announcements for the signed-in teacher / student / parent.
// The database only returns the ones meant for them.
export default function AnnouncementFeed() {
  const query = useAsyncData(fetchAnnouncements, 'announcement-feed')

  return (
    <>
      <PageHeader title="Announcements" />
      {query.loading ? (
        <LoadingState lines={4} />
      ) : query.error ? (
        <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
      ) : query.data.length === 0 ? (
        <Card>
          <EmptyState icon="megaphone">No announcements yet.</EmptyState>
        </Card>
      ) : (
        query.data.map((a) => (
          <Card
            key={a.id}
            title={a.title}
            action={a.audience !== 'all' && <Badge tone="info">{audienceLabel(a)}</Badge>}
          >
            <p className="ds-muted ds-small" style={{ marginTop: 0 }}>
              Posted by {a.author_name ?? 'the school'} · {formatDateTime(a.published_at)}
            </p>
            <div className="ds-pre" style={{ overflowWrap: 'anywhere' }}>
              {a.body}
            </div>
          </Card>
        ))
      )}
    </>
  )
}
