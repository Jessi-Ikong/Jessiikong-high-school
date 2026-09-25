import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ADMIN_BOTTOM_NAV, pageTitle, visibleNav } from '../lib/adminNav'
import Crest from './public/Crest'
import Icon from './ui/Icon'
import SignOutButton from './SignOutButton'
import '../styles/app.css'

// The admin portal's frame (design system: styles/app.css).
//   Phones (< 768px): a top bar (crest + current page), a BOTTOM bar with the
//     four busiest pages + "Menu" (reachable with one thumb), and a
//     full-screen menu with search and every page, grouped.
//   Tablets / desktops: the same grouped menu as a sidebar.
// profile: { first_name, last_name, admin_level }. `signOut`: the button to
// show (the real one in the app; the preview passes a harmless stand-in).
export default function AdminShell({ profile, children, signOut = <SignOutButton className="ds-btn ds-btn-secondary" /> }) {
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const isSuper = profile.admin_level === 'super_admin'
  const title = pageTitle(pathname)
  const initials = `${profile.first_name?.[0] ?? ''}${profile.last_name?.[0] ?? ''}`.toUpperCase()
  const role = isSuper ? 'Super admin' : 'Limited admin'

  return (
    <div className="ds ds-shell">
      <a className="ds-skip" href="#ds-main">
        Skip to content
      </a>

      <aside className="ds-sidebar" aria-label="Admin navigation">
        <Link to="/admin" className="ds-sidebar-brand">
          <Crest size={30} />
          <span>
            <strong>Jessiikong High School</strong>
            <span>Admin portal</span>
          </span>
        </Link>
        <NavMenu isSuper={isSuper} />
      </aside>

      <div className="ds-main">
        <header className="ds-topbar">
          <div className="ds-topbar-brand">
            <span className="ds-crest-mark">
              <Crest size={26} />
            </span>
            <span className="ds-topbar-title">
              <strong>{title}</strong>
              <span>Jessiikong · Admin</span>
            </span>
          </div>
          <div className="ds-topbar-user">
            <span className="ds-avatar" aria-hidden="true">
              {initials}
            </span>
            <span>
              {profile.first_name} {profile.last_name} · {role}
            </span>
            {signOut}
          </div>
        </header>

        <main id="ds-main" className="ds-content admin-content" tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav className="ds-bottomnav" aria-label="Main">
        {ADMIN_BOTTOM_NAV.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>
            <Icon name={l.icon} size={22} />
            <span className="ds-bottomnav-label">{l.label}</span>
          </NavLink>
        ))}
        <button type="button" className="ds-menu-button" aria-expanded={menuOpen} aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>
          <Icon name="menu" size={22} />
          <span className="ds-bottomnav-label">Menu</span>
        </button>
      </nav>

      {menuOpen && (
        <MenuSheet onClose={closeMenu} isSuper={isSuper} profile={profile} initials={initials} role={role} signOut={signOut} />
      )}
    </div>
  )
}

// Grouped links with a quick search (25 pages is a lot to scroll on a phone).
function NavMenu({ isSuper, onNavigate, searchRef }) {
  const [query, setQuery] = useState('')
  const groups = visibleNav(isSuper, query)
  return (
    <div className="ds-sheet-body">
      <div className="ds-nav-search">
        <Icon name="search" size={18} />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a page…"
          aria-label="Find a page"
        />
      </div>
      {groups.length === 0 ? (
        <p className="ds-nav-empty">No page matches “{query}”.</p>
      ) : (
        groups.map((g) => (
          <div key={g.group} className="ds-nav-group">
            <h3>{g.group}</h3>
            <ul>
              {g.links.map((l) => (
                <li key={l.to}>
                  <NavLink to={l.to} end={l.end} className="ds-nav-link" onClick={onNavigate}>
                    <Icon name={l.icon} size={20} />
                    {l.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}

// Phones: every page, full screen. Esc / × / choosing a page closes it.
function MenuSheet({ onClose, isSuper, profile, initials, role, signOut }) {
  const searchRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  return (
    <>
      <div className="ds-sheet-backdrop" onClick={onClose} />
      <div className="ds-sheet" role="dialog" aria-modal="true" aria-label="All pages">
        <header className="ds-sheet-header">
          <Crest size={26} />
          <h2>Menu</h2>
          <button ref={closeRef} type="button" className="ds-icon-btn" onClick={onClose} aria-label="Close menu">
            <Icon name="x" size={24} />
          </button>
        </header>
        <div className="ds-account">
          <span className="ds-avatar" aria-hidden="true">
            {initials}
          </span>
          <span className="ds-account-text">
            <strong>
              {profile.first_name} {profile.last_name}
            </strong>
            <span>{role}</span>
          </span>
          {signOut}
        </div>
        <NavMenu isSuper={isSuper} onNavigate={onClose} searchRef={searchRef} />
      </div>
    </>
  )
}
