import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import SignOutButton from './SignOutButton'

// Add new admin pages here and as child routes of /admin in App.jsx.
const NAV_LINKS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/sessions', label: 'Sessions' },
  { to: '/admin/terms', label: 'Terms' },
  { to: '/admin/classes', label: 'Classes & Sections' },
  { to: '/admin/subjects', label: 'Subjects' },
  { to: '/admin/periods', label: 'Periods' },
  { to: '/admin/timetable', label: 'Timetable' },
  { to: '/admin/assessment', label: 'Assessment' },
  { to: '/admin/grade-scale', label: 'Grade Scale' },
  { to: '/admin/ranking', label: 'Class Ranking' },
  { to: '/admin/staff', label: 'Staff' },
  { to: '/admin/students', label: 'Students' },
  { to: '/admin/parents', label: 'Parents' },
  { to: '/admin/audit-log', label: 'Audit Log' },
]

export default function AdminLayout() {
  const { profile } = useAuth()

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          Jessiikong High School
          <span className="muted small">Admin</span>
        </div>
        <nav className="admin-nav" aria-label="Admin">
          {NAV_LINKS.filter((link) => !link.superAdminOnly || profile.admin_level === 'super_admin').map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end}>
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <span className="muted">
            {profile.first_name} {profile.last_name} ({profile.admin_level.replace('_', ' ')})
          </span>
          <SignOutButton />
        </header>
        <div className="admin-content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
