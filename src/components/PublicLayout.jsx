import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { ROLE_HOME } from '../lib/roles'
import { contact, school } from '../content/siteContent'
import Crest from './public/Crest'
import '../styles/public.css'

// The PUBLIC website's frame: its own look (not the internal dashboards'),
// navigation, a "Portal login" button to the existing /login page for staff,
// students and parents, and the footer. No sign-in needed for anything here.

const PUBLIC_NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/about', label: 'About' },
  { to: '/academics', label: 'Academics' },
  { to: '/admissions', label: 'Admissions' },
  { to: '/news', label: 'News' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/contact', label: 'Contact' },
]

const telHref = (phone) => `tel:${phone.replace(/[^+\d]/g, '')}`

export default function PublicLayout() {
  const { profile } = useAuth()
  const { pathname, hash } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  // New page: start at the top (or at #section).
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0)
      return
    }
    // the section may only exist once the page has rendered
    const timer = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 60)
    return () => clearTimeout(timer)
  }, [pathname, hash])

  // Already signed in: the button takes you back to your own portal.
  const portal = profile ? { to: ROLE_HOME[profile.role], label: 'My portal' } : { to: '/login', label: 'Portal login' }

  return (
    <div className="pub">
      <a className="pub-skip" href="#pub-main">
        Skip to content
      </a>
      <div className="pub-topbar">
        <div className="pub-wrap pub-topbar-inner">
          <span>{school.motto}</span>
          <span className="pub-topbar-contact">
            <a href={telHref(contact.phone)}>{contact.phone}</a>
            <a href={`mailto:${contact.email}`}>{contact.email}</a>
          </span>
        </div>
      </div>

      <header className="pub-header">
        <div className="pub-wrap pub-header-inner">
          <Link to="/" className="pub-brand" aria-label={`${school.name} home`} onClick={() => setMenuOpen(false)}>
            <Crest size={40} />
            <span className="pub-brand-text">
              <span className="pub-brand-name">{school.shortName}</span>
              <span className="pub-brand-sub">High School</span>
            </span>
          </Link>

          <button
            type="button"
            className="pub-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="pub-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="pub-menu-icon" aria-hidden="true" />
            <span className="pub-visually-hidden">Menu</span>
          </button>

          <nav
            id="pub-nav"
            className={`pub-nav${menuOpen ? ' is-open' : ''}`}
            aria-label="Main"
            // choosing a page closes the mobile menu
            onClick={(e) => e.target.closest('a') && setMenuOpen(false)}
          >
            {PUBLIC_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            ))}
            <Link to={portal.to} className="pub-btn pub-btn-portal">
              {portal.label}
            </Link>
          </nav>
        </div>
      </header>

      <main id="pub-main" className="pub-main">
        <Outlet />
      </main>

      <footer className="pub-footer">
        <div className="pub-wrap pub-footer-grid">
          <div>
            <div className="pub-footer-brand">
              <Crest size={36} />
              <span>{school.name}</span>
            </div>
            <p className="pub-footer-tagline">{school.tagline}</p>
          </div>
          <div>
            <h2>Visit us</h2>
            <address>
              {contact.addressLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </address>
          </div>
          <div>
            <h2>Get in touch</h2>
            <p>
              <a href={telHref(contact.phone)}>{contact.phone}</a>
              <br />
              <a href={`mailto:${contact.email}`}>{contact.email}</a>
            </p>
          </div>
          <div>
            <h2>Explore</h2>
            <ul>
              {PUBLIC_NAV.slice(1).map((item) => (
                <li key={item.to}>
                  <Link to={item.to}>{item.label}</Link>
                </li>
              ))}
              <li>
                <Link to={portal.to}>Staff, student &amp; parent portal</Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="pub-wrap pub-footer-bottom">
          © {new Date().getFullYear()} {school.name}. All rights reserved.
        </div>
      </footer>
    </div>
  )
}
