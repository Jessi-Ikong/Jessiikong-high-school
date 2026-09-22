import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { ROLE_HOME } from '../lib/roles'

// Renders child routes only if the signed-in user has one of `allowedRoles`.
// Signed-out users go to /login; users with the wrong role go to their own dashboard.
export default function ProtectedRoute({ allowedRoles }) {
  const { user, role, loading } = useAuth()

  if (loading) return <p>Loading…</p>
  if (!user) return <Navigate to="/login" replace />
  if (!allowedRoles.includes(role)) {
    return <Navigate to={ROLE_HOME[role] ?? '/login'} replace />
  }
  return <Outlet />
}
