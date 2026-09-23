import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { ROLE_HOME } from '../lib/roles'

// Renders child routes only if the signed-in user has one of `allowedRoles`.
// Signed-out users (or users without a usable profile) go to /login; users with
// the wrong role go to their own dashboard.
export default function ProtectedRoute({ allowedRoles }) {
  const { user, profile, loading } = useAuth()

  // Wait for the initial session check instead of flashing the login page.
  if (loading) return <p className="page-loading">Loading…</p>
  if (!user || !profile) return <Navigate to="/login" replace />
  if (!allowedRoles.includes(profile.role)) {
    return <Navigate to={ROLE_HOME[profile.role]} replace />
  }
  return <Outlet />
}
