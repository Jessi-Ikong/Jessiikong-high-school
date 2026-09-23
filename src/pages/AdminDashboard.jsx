import { Link } from 'react-router-dom'

export default function AdminDashboard() {
  return (
    <>
      <h1>Admin overview</h1>
      <p className="muted">Set up the school&apos;s structure. Start with a session, then its terms.</p>
      <ul className="link-list">
        <li>
          <Link to="/admin/sessions">Sessions</Link> — academic years, e.g. 2026/2027
        </li>
        <li>
          <Link to="/admin/terms">Terms</Link> — the terms within each session
        </li>
        <li>
          <Link to="/admin/classes">Classes &amp; Sections</Link> — e.g. JSS1 with sections A and B
        </li>
        <li>
          <Link to="/admin/subjects">Subjects</Link> — e.g. Mathematics (MTH)
        </li>
        <li>
          <Link to="/admin/staff">Staff</Link> — add teachers (and, for super admins, other admins)
        </li>
        <li>
          <Link to="/admin/students">Students</Link> — add and enroll students
        </li>
        <li>
          <Link to="/admin/parents">Parents</Link> — add parents and link them to their children
        </li>
      </ul>
    </>
  )
}
