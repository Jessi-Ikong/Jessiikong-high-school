import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { fullName } from '../lib/people'
import SignOutButton from './SignOutButton'

export default function TeacherLayout() {
  const { profile } = useAuth()

  return (
    <div className="portal-shell">
      <header className="portal-topbar">
        <div className="portal-brand">
          Jessiikong High School <span className="muted small">Teacher</span>
        </div>
        <nav className="portal-nav" aria-label="Teacher">
          <NavLink to="/teacher" end>
            Today
          </NavLink>
          <NavLink to="/teacher/gradebook">Gradebook</NavLink>
          <NavLink to="/teacher/assignments">Assignments</NavLink>
          <NavLink to="/teacher/messages">Messages</NavLink>
          <NavLink to="/teacher/announcements">Announcements</NavLink>
          <NavLink to="/teacher/profile">My Profile</NavLink>
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
