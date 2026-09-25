import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { ROLES } from './lib/roles'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import SetPassword from './pages/SetPassword'
import AdminLayout from './components/AdminLayout'
import AdminDashboard from './pages/AdminDashboard'
import Sessions from './pages/admin/Sessions'
import Terms from './pages/admin/Terms'
import ClassesSections from './pages/admin/ClassesSections'
import Subjects from './pages/admin/Subjects'
import Periods from './pages/admin/Periods'
import Timetable from './pages/admin/Timetable'
import AssessmentComponents from './pages/admin/AssessmentComponents'
import ClassRanking from './pages/admin/ClassRanking'
import GradeScale from './pages/admin/GradeScale'
import Staff from './pages/admin/Staff'
import Students from './pages/admin/Students'
import Parents from './pages/admin/Parents'
import AuditLog from './pages/admin/AuditLog'
import FeeStructures from './pages/admin/FeeStructures'
import StuckPayments from './pages/admin/StuckPayments'
import AdminAnnouncements from './pages/admin/Announcements'
import TeacherLayout from './components/TeacherLayout'
import TeacherDashboard from './pages/TeacherDashboard'
import MarkAttendance from './pages/teacher/MarkAttendance'
import Gradebook from './pages/teacher/Gradebook'
import TeacherAssignments from './pages/teacher/Assignments'
import TeacherMessages from './pages/teacher/Messages'
import TeacherAnnouncements from './pages/teacher/Announcements'
import StudentLayout from './components/StudentLayout'
import StudentDashboard from './pages/StudentDashboard'
import StudentAssignments from './pages/student/Assignments'
import StudentAnnouncements from './pages/student/Announcements'
import ParentLayout from './components/ParentLayout'
import ParentDashboard from './pages/ParentDashboard'
import ParentFees from './pages/parent/Fees'
import PaymentCallback from './pages/parent/PaymentCallback'
import ParentMessages from './pages/parent/Messages'
import ParentAnnouncements from './pages/parent/Announcements'
import NotFound from './pages/NotFound'
import Profile from './pages/Profile'
import Verify from './pages/Verify'
import IdCards from './pages/admin/IdCards'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/set-password" element={<SetPassword />} />
      {/* Public: ID card QR verification (no login) */}
      <Route path="/verify/:token" element={<Verify />} />

      <Route element={<ProtectedRoute allowedRoles={[ROLES.ADMIN]} />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="terms" element={<Terms />} />
          <Route path="classes" element={<ClassesSections />} />
          <Route path="subjects" element={<Subjects />} />
          <Route path="periods" element={<Periods />} />
          <Route path="timetable" element={<Timetable />} />
          <Route path="assessment" element={<AssessmentComponents />} />
          <Route path="grade-scale" element={<GradeScale />} />
          <Route path="ranking" element={<ClassRanking />} />
          <Route path="staff" element={<Staff />} />
          <Route path="students" element={<Students />} />
          <Route path="parents" element={<Parents />} />
          <Route path="fees" element={<FeeStructures />} />
          <Route path="stuck-payments" element={<StuckPayments />} />
          <Route path="announcements" element={<AdminAnnouncements />} />
          <Route path="id-cards" element={<IdCards />} />
          <Route path="audit-log" element={<AuditLog />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute allowedRoles={[ROLES.TEACHER]} />}>
        <Route path="/teacher" element={<TeacherLayout />}>
          <Route index element={<TeacherDashboard />} />
          <Route path="attendance/:slotId" element={<MarkAttendance />} />
          <Route path="gradebook" element={<Gradebook />} />
          <Route path="assignments" element={<TeacherAssignments />} />
          <Route path="messages" element={<TeacherMessages />} />
          <Route path="announcements" element={<TeacherAnnouncements />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute allowedRoles={[ROLES.STUDENT]} />}>
        <Route path="/student" element={<StudentLayout />}>
          <Route index element={<StudentDashboard />} />
          <Route path="assignments" element={<StudentAssignments />} />
          <Route path="announcements" element={<StudentAnnouncements />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute allowedRoles={[ROLES.PARENT]} />}>
        <Route path="/parent" element={<ParentLayout />}>
          <Route index element={<ParentDashboard />} />
          <Route path="fees" element={<ParentFees />} />
          <Route path="payment-callback" element={<PaymentCallback />} />
          <Route path="messages" element={<ParentMessages />} />
          <Route path="announcements" element={<ParentAnnouncements />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
