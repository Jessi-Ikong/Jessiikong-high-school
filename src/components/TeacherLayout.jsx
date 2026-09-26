import { Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import AppShell from './AppShell'

// The teacher portal: the shared design-system shell (AppShell) with the teacher
// links from src/lib/portalNav.js. Pages are routed in App.jsx.
export default function TeacherLayout() {
  const { profile } = useAuth()
  return (
    <AppShell role="teacher" profile={profile}>
      <Outlet />
    </AppShell>
  )
}
