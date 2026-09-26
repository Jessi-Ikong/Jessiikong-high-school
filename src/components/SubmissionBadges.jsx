import { fileNameOf } from '../lib/assignments'
import { Badge } from './ui/Primitives'

// Status badges shared by the teacher and student Assignments pages.
// Colours come from lib/statusTones.js (not-submitted / submitted / graded / late / overdue).
export function SubmissionBadges({ status }) {
  return (
    <span className="ds-inline" style={{ gap: 4 }}>
      <Badge status={status.key}>{status.key === 'submitted' ? 'Submitted — awaiting grade' : status.label}</Badge>
      {status.late && <Badge status="late">Late</Badge>}
      {status.overdue && <Badge status="overdue">Overdue</Badge>}
    </span>
  )
}

// Link to a file in the private bucket (`urls` comes from signedUrls()).
export function FileLink({ path, urls }) {
  if (!path) return null
  const url = urls[path]
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      📎 {fileNameOf(path)}
    </a>
  ) : (
    <span className="ds-muted ds-small">📎 {fileNameOf(path)} (link unavailable — refresh the page)</span>
  )
}
