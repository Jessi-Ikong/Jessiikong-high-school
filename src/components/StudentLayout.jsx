import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { fullName } from '../lib/people'
import SignOutButton from './SignOutButton'

export default function StudentLayout() {
  const { profile } = useAuth()

  return (
    <div className="portal-shell">
      <header className="portal-topbar">
        <div className="portal-brand">
          Jessiikong High School <span className="muted small">Student</span>
        </div>
        <nav className="portal-nav" aria-label="Student">
          <NavLink to="/student" end>
            Home
          </NavLink>
          <NavLink to="/student/assignments">Assignments</NavLink>
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
