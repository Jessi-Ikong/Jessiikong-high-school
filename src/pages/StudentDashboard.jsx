import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Student home. More sections (timetable, results...) come in later tasks.
export default function StudentDashboard() {
  const { profile } = useAuth()

  return (
    <>
      <h1>Welcome, {profile.first_name}</h1>
      <ul className="link-list">
        <li>
          <Link to="/student/assignments">Assignments</Link>
          <span className="muted small"> — see work set for your subjects, hand it in, and read your marks and feedback.</span>
        </li>
      </ul>
    </>
  )
}
