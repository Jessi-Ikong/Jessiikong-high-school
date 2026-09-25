// The admin portal's navigation, grouped. Add new admin pages here (and as a
// child route of /admin in App.jsx). superAdminOnly links are hidden from
// limited admins (the database enforces the actual permissions).
export const ADMIN_NAV = [
  {
    group: 'Home',
    links: [{ to: '/admin', label: 'Overview', icon: 'home', end: true }],
  },
  {
    group: 'People',
    links: [
      { to: '/admin/students', label: 'Students', icon: 'users' },
      { to: '/admin/staff', label: 'Staff', icon: 'user' },
      { to: '/admin/parents', label: 'Parents', icon: 'users' },
      { to: '/admin/id-cards', label: 'ID Cards', icon: 'card' },
    ],
  },
  {
    group: 'School setup',
    links: [
      { to: '/admin/sessions', label: 'Sessions', icon: 'calendar' },
      { to: '/admin/terms', label: 'Terms', icon: 'calendar' },
      { to: '/admin/classes', label: 'Classes & Sections', icon: 'grid' },
      { to: '/admin/subjects', label: 'Subjects', icon: 'book' },
      { to: '/admin/periods', label: 'Periods', icon: 'clock' },
      { to: '/admin/timetable', label: 'Timetable', icon: 'calendar' },
    ],
  },
  {
    group: 'Grading',
    links: [
      { to: '/admin/assessment', label: 'Assessment', icon: 'chart' },
      { to: '/admin/grade-scale', label: 'Grade Scale', icon: 'chart' },
      { to: '/admin/ranking', label: 'Class Ranking', icon: 'chart' },
    ],
  },
  {
    group: 'Corrections',
    links: [
      { to: '/admin/correct-attendance', label: 'Correct Attendance', icon: 'check' },
      { to: '/admin/correct-scores', label: 'Correct Scores', icon: 'edit' },
      { to: '/admin/correct-grades', label: 'Correct Grades', icon: 'edit' },
    ],
  },
  {
    group: 'Fees',
    links: [
      { to: '/admin/fees', label: 'Fees', icon: 'money', superAdminOnly: true },
      { to: '/admin/stuck-payments', label: 'Stuck Payments', icon: 'alert' },
    ],
  },
  {
    group: 'Communication',
    links: [
      { to: '/admin/announcements', label: 'Announcements', icon: 'megaphone' },
      { to: '/admin/admissions-inquiries', label: 'Admissions Inquiries', icon: 'inbox' },
      { to: '/admin/contact-messages', label: 'Contact Messages', icon: 'inbox' },
    ],
  },
  {
    group: 'Website',
    links: [
      { to: '/admin/website-news', label: 'News & Events', icon: 'globe' },
      { to: '/admin/website-gallery', label: 'Gallery', icon: 'globe' },
    ],
  },
  {
    group: 'System',
    links: [{ to: '/admin/audit-log', label: 'Audit Log', icon: 'shield' }],
  },
]

// The phone bottom bar: the most-used destinations (a "Menu" button is added
// as the 5th item and opens everything else).
export const ADMIN_BOTTOM_NAV = [
  { to: '/admin', label: 'Overview', icon: 'home', end: true },
  { to: '/admin/students', label: 'Students', icon: 'users' },
  { to: '/admin/correct-attendance', label: 'Attendance', icon: 'check' },
  { to: '/admin/admissions-inquiries', label: 'Inquiries', icon: 'inbox' },
]

// The links this admin may see, per group (empty groups dropped).
export function visibleNav(isSuperAdmin, query = '') {
  const q = query.trim().toLowerCase()
  return ADMIN_NAV.map((g) => ({
    ...g,
    links: g.links.filter(
      (l) => (!l.superAdminOnly || isSuperAdmin) && (!q || l.label.toLowerCase().includes(q) || g.group.toLowerCase().includes(q)),
    ),
  })).filter((g) => g.links.length > 0)
}

// The label of the page at `pathname` (the longest matching link).
export function pageTitle(pathname) {
  let best = null
  for (const g of ADMIN_NAV) {
    for (const l of g.links) {
      const match = l.end ? pathname === l.to || pathname === `${l.to}/` : pathname === l.to || pathname.startsWith(`${l.to}/`)
      if (match && (!best || l.to.length > best.to.length)) best = l
    }
  }
  return best?.label ?? 'Admin'
}
