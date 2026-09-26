import { Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import AppShell from './AppShell'

// The parent portal: the shared design-system shell (AppShell) with the parent
// links from src/lib/portalNav.js. Pages are routed in App.jsx.
export default function ParentLayout() {
  const { profile } = useAuth()
  return (
    <AppShell role="parent" profile={profile}>
      <Outlet />
    </AppShell>
  )
}
