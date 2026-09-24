import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { fullName } from '../lib/people'
import SignOutButton from './SignOutButton'

export default function ParentLayout() {
  const { profile } = useAuth()

  return (
    <div className="portal-shell">
      <header className="portal-topbar">
        <div className="portal-brand">
          Jessiikong High School <span className="muted small">Parent</span>
        </div>
        <nav className="portal-nav" aria-label="Parent">
          <NavLink to="/parent" end>
            Home
          </NavLink>
          <NavLink to="/parent/fees">Fees</NavLink>
        </nav>
        <div className="portal-user">
          <span className="muted small">{fullName(profile)}</span>
          <SignOutButton />
        </div>
      </header>
      <div className="portal-content">
        <Outlet />
      </div>
    </div>
  )
}
