import { Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import AppShell from './AppShell'

// The student portal: the shared design-system shell (AppShell) with the student
// links from src/lib/portalNav.js. Pages are routed in App.jsx.
export default function StudentLayout() {
  const { profile } = useAuth()
  return (
    <AppShell role="student" profile={profile}>
      <Outlet />
    </AppShell>
  )
}
