import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { PORTALS, titleFor, visibleLinks } from '../lib/portalNav'
import Crest from './public/Crest'
import Icon from './ui/Icon'
import SignOutButton from './SignOutButton'
import '../styles/app.css'

// The frame of every signed-in portal (admin, teacher, student, parent), from
// the design system (styles/app.css). `role` picks the portal's links
// (lib/portalNav.js).
//   Phones (< 768px): a top bar (crest + current page + your avatar), a fixed
//     BOTTOM bar with the portal's main pages (admin: 4 + "Menu"), and a
//     full-screen menu (opened from the avatar, or "Menu") with your name,
//     Log out and every page, grouped (with a search box when there are many).
//   Tablets / desktops: the same grouped menu as a sidebar; name + Log out in
//     the top bar.
// Both menus end with "Visit school website": a plain link to the public
// site (/). It does NOT sign you out; the site's header then offers "My portal".
// profile: { first_name, last_name, admin_level? }. `signOut`: the button to
// show (the real one in the app; the previews pass a harmless stand-in).
export default function AppShell({ role, profile, children, signOut = <SignOutButton className="ds-btn ds-btn-secondary" /> }) {
  const portal = PORTALS[role]
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const isSuper = profile.admin_level === 'super_admin'
  const title = titleFor(portal, pathname)
  const initials = `${profile.first_name?.[0] ?? ''}${profile.last_name?.[0] ?? ''}`.toUpperCase()
  const roleLabel = role === 'admin' ? (isSuper ? 'Super admin' : 'Limited admin') : portal.label
  const links = portal.nav.flatMap((g) => g.links)
  const searchable = links.length > 8
  const bottomItems = portal.bottomNav.length + (portal.menuButton ? 1 : 0)

  return (
    <div className="ds ds-shell">
      <a className="ds-skip" href="#ds-main">
        Skip to content
      </a>

      <aside className="ds-sidebar" aria-label={`${portal.label} navigation`}>
        <Link to={portal.home} className="ds-sidebar-brand">
          <Crest size={30} />
          <span>
            <strong>Jessiikong High School</strong>
            <span>{portal.label} portal</span>
          </span>
        </Link>
        <NavMenu nav={portal.nav} isSuper={isSuper} searchable={searchable} />
        <WebsiteLink />
      </aside>

      <div className="ds-main">
        <header className="ds-topbar">
          <div className="ds-topbar-brand">
            <span className="ds-crest-mark">
              <Crest size={26} />
            </span>
            <span className="ds-topbar-title">
              <strong>{title}</strong>
              <span>Jessiikong · {portal.label}</span>
            </span>
          </div>
          <button
            type="button"
            className="ds-icon-btn ds-topbar-account"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            aria-label={`Account and all pages (${profile.first_name} ${profile.last_name})`}
          >
            <span className="ds-avatar" aria-hidden="true">
              {initials}
            </span>
          </button>
          <div className="ds-topbar-user">
            <span className="ds-avatar" aria-hidden="true">
              {initials}
            </span>
            <span>
              {profile.first_name} {profile.last_name} · {roleLabel}
            </span>
            {signOut}
          </div>
        </header>

        <main id="ds-main" className="ds-content" tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav className="ds-bottomnav" aria-label="Main" style={{ gridTemplateColumns: `repeat(${bottomItems}, 1fr)` }}>
        {portal.bottomNav.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>
            <Icon name={l.icon} size={22} />
            <span className="ds-bottomnav-label">{l.label}</span>
          </NavLink>
        ))}
        {portal.menuButton && (
          <button type="button" className="ds-menu-button" aria-expanded={menuOpen} aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>
            <Icon name="menu" size={22} />
            <span className="ds-bottomnav-label">Menu</span>
          </button>
        )}
      </nav>

      {menuOpen && (
        <MenuSheet
          onClose={closeMenu}
          nav={portal.nav}
          isSuper={isSuper}
          searchable={searchable}
          profile={profile}
          initials={initials}
          roleLabel={roleLabel}
          signOut={signOut}
        />
      )}
    </div>
  )
}

// To the public website, staying signed in.
function WebsiteLink({ onNavigate }) {
  return (
    <div className="ds-nav-website">
      <Link to="/" className="ds-nav-link" onClick={onNavigate}>
        <Icon name="globe" size={20} />
        Visit school website
      </Link>
    </div>
  )
}

// Grouped links, with a quick search when there are many (admin: 25 pages).
function NavMenu({ nav, isSuper, searchable, onNavigate }) {
  const [query, setQuery] = useState('')
  const groups = visibleLinks(nav, isSuper, query)
  return (
    <div className="ds-sheet-body">
      {searchable && (
        <div className="ds-nav-search">
          <Icon name="search" size={18} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a page…" aria-label="Find a page" />
        </div>
      )}
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

// Phones: account + every page, full screen. Esc / × / choosing a page closes it.
function MenuSheet({ onClose, nav, isSuper, searchable, profile, initials, roleLabel, signOut }) {
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
      <div className="ds-sheet" role="dialog" aria-modal="true" aria-label="Menu">
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
            <span>{roleLabel}</span>
          </span>
          {signOut}
        </div>
        <NavMenu nav={nav} isSuper={isSuper} searchable={searchable} onNavigate={onClose} />
        <WebsiteLink onNavigate={onClose} />
      </div>
    </>
  )
}
