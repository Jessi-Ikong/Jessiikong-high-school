import { useAuth } from '../hooks/useAuth'
import SignOutButton from './SignOutButton'

// Temporary dashboard frame: who is signed in, and a way to log out.
// Real dashboard UI comes in later tasks.
export default function DashboardPlaceholder({ title }) {
  const { profile } = useAuth()
  const role = profile.admin_level ? profile.admin_level.replace('_', ' ') : profile.role

  return (
    <main>
      <header className="dashboard-header">
        <div>
          <h1>{title}</h1>
          <p className="muted">
            Signed in as {profile.first_name} {profile.last_name} ({role})
          </p>
        </div>
        <SignOutButton />
      </header>
      <p>Placeholder page.</p>
    </main>
  )
}
