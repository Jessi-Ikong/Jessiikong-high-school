import { Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import AdminShell from './AdminShell'

// The admin portal: the design-system shell (AdminShell) around each admin
// page. Pages are listed in src/lib/adminNav.js and routed in App.jsx.
export default function AdminLayout() {
  const { profile } = useAuth()
  return (
    <AdminShell profile={profile}>
      <Outlet />
    </AdminShell>
  )
}
