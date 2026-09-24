import { fileNameOf } from '../lib/assignments'

// Status badges shared by the teacher and student Assignments pages.
export function SubmissionBadges({ status }) {
  const className = {
    'not-submitted': 'badge badge-muted',
    submitted: 'badge badge-info',
    graded: 'badge',
  }[status.key]
  return (
    <span className="badge-row">
      <span className={className}>{status.key === 'submitted' ? 'Submitted — awaiting grade' : status.label}</span>
      {status.late && <span className="badge badge-late">Late</span>}
      {status.overdue && <span className="badge badge-warning">Overdue</span>}
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
    <span className="muted small">📎 {fileNameOf(path)} (link unavailable — refresh the page)</span>
  )
}
