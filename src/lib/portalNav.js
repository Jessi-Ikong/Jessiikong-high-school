// Navigation for every portal, as used by the shared shell (AppShell).
// Each portal config:
//   nav:       grouped links [{ group, links: [{ to, label, icon, end?, superAdminOnly? }] }]
//              (the sidebar on tablets/desktops and the full-screen menu on phones)
//   bottomNav: the phone bottom bar (at most 5 items)
//   menuButton: add a "Menu" item to the bottom bar (4 links + Menu), for
//              portals with too many pages for it. Every portal can also open
//              the full menu (all pages + account + Log out) from the avatar
//              in the phone top bar.
//   titles:    extra page names for routes that aren't menu links
//              (e.g. the teacher's "Mark attendance" page, opened from Today)
// The admin portal's lists live in adminNav.js.
import { ADMIN_BOTTOM_NAV, ADMIN_NAV } from './adminNav'

export const PORTALS = {
  admin: {
    label: 'Admin',
    home: '/admin',
    nav: ADMIN_NAV,
    bottomNav: ADMIN_BOTTOM_NAV,
    menuButton: true, // 25 pages: the bottom bar's 5th item opens the full menu
    titles: [],
  },
  teacher: {
    label: 'Teacher',
    home: '/teacher',
    nav: [
      {
        group: 'Teaching',
        links: [
          { to: '/teacher', label: 'Today', icon: 'home', end: true },
          { to: '/teacher/gradebook', label: 'Gradebook', icon: 'chart' },
          { to: '/teacher/assignments', label: 'Assignments', icon: 'file' },
        ],
      },
      {
        group: 'Communication',
        links: [
          { to: '/teacher/messages', label: 'Messages', icon: 'inbox' },
          { to: '/teacher/announcements', label: 'Announcements', icon: 'megaphone' },
        ],
      },
      { group: 'Account', links: [{ to: '/teacher/profile', label: 'My Profile', icon: 'user' }] },
    ],
    bottomNav: [
      { to: '/teacher', label: 'Today', icon: 'home', end: true },
      { to: '/teacher/gradebook', label: 'Gradebook', icon: 'chart' },
      { to: '/teacher/assignments', label: 'Assignments', icon: 'file' },
      { to: '/teacher/messages', label: 'Messages', icon: 'inbox' },
      { to: '/teacher/announcements', label: 'News', icon: 'megaphone' },
    ],
    titles: [{ to: '/teacher/attendance', label: 'Mark attendance' }],
  },
  student: {
    label: 'Student',
    home: '/student',
    nav: [
      {
        group: 'School',
        links: [
          { to: '/student', label: 'Home', icon: 'home', end: true },
          { to: '/student/assignments', label: 'Assignments', icon: 'file' },
          { to: '/student/announcements', label: 'Announcements', icon: 'megaphone' },
        ],
      },
      { group: 'Account', links: [{ to: '/student/profile', label: 'My Profile', icon: 'user' }] },
    ],
    bottomNav: [
      { to: '/student', label: 'Home', icon: 'home', end: true },
      { to: '/student/assignments', label: 'Assignments', icon: 'file' },
      { to: '/student/announcements', label: 'News', icon: 'megaphone' },
    ],
    titles: [],
  },
  parent: {
    label: 'Parent',
    home: '/parent',
    nav: [
      {
        group: 'My children',
        links: [
          { to: '/parent', label: 'Home', icon: 'home', end: true },
          { to: '/parent/fees', label: 'Fees', icon: 'money' },
        ],
      },
      {
        group: 'Communication',
        links: [
          { to: '/parent/messages', label: 'Messages', icon: 'inbox' },
          { to: '/parent/announcements', label: 'Announcements', icon: 'megaphone' },
        ],
      },
      { group: 'Account', links: [{ to: '/parent/profile', label: 'My Profile', icon: 'user' }] },
    ],
    bottomNav: [
      { to: '/parent', label: 'Home', icon: 'home', end: true },
      { to: '/parent/fees', label: 'Fees', icon: 'money' },
      { to: '/parent/messages', label: 'Messages', icon: 'inbox' },
      { to: '/parent/announcements', label: 'News', icon: 'megaphone' },
    ],
    titles: [{ to: '/parent/payment-callback', label: 'Payment' }],
  },
}

// The links this user may see, per group (empty groups dropped), matching `query`.
export function visibleLinks(nav, isSuperAdmin, query = '') {
  const q = query.trim().toLowerCase()
  return nav
    .map((g) => ({
      ...g,
      links: g.links.filter(
        (l) => (!l.superAdminOnly || isSuperAdmin) && (!q || l.label.toLowerCase().includes(q) || g.group.toLowerCase().includes(q)),
      ),
    }))
    .filter((g) => g.links.length > 0)
}

// The name of the page at `pathname` (the longest matching link or title).
export function titleFor(portal, pathname) {
  let best = null
  const candidates = [...portal.nav.flatMap((g) => g.links), ...portal.titles]
  for (const l of candidates) {
    const match = l.end ? pathname === l.to || pathname === `${l.to}/` : pathname === l.to || pathname.startsWith(`${l.to}/`)
    if (match && (!best || l.to.length > best.to.length)) best = l
  }
  return best?.label ?? portal.label
}
