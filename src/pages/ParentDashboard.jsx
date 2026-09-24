import { Link } from 'react-router-dom'
import { friendlyDbError } from '../lib/db'
import { fullName } from '../lib/people'
import { fetchMyChildren } from '../lib/parentChildren'
import { useAsyncData } from '../hooks/useAsyncData'
import { useAuth } from '../hooks/useAuth'

// Parent home: their children, with links into each child's pages.
// More per-child summaries (attendance, grades) come in later tasks.
export default function ParentDashboard() {
  const { profile } = useAuth()
  const query = useAsyncData(() => fetchMyChildren(profile.id), `my-children:${profile.id}`)

  return (
    <>
      <h1>Welcome, {profile.first_name}</h1>
      {query.loading ? (
        <p className="muted">Loading…</p>
      ) : query.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
      ) : query.data.length === 0 ? (
        <p className="empty-state">No children are linked to your account yet. Please contact the school office.</p>
      ) : (
        <div className="card-list">
          {query.data.map((c) => (
            <div key={c.id} className="panel">
              <h2>{fullName(c)}</h2>
              <p className="muted small">
                {c.className ?? 'Not enrolled this session'} · Admission no. {c.admissionNumber}
              </p>
              <Link to={`/parent/fees?child=${c.id}`}>School fees →</Link>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
