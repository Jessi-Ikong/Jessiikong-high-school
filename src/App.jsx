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
import Staff from './pages/admin/Staff'
import Students from './pages/admin/Students'
import Parents from './pages/admin/Parents'
import TeacherDashboard from './pages/TeacherDashboard'
import StudentDashboard from './pages/StudentDashboard'
import ParentDashboard from './pages/ParentDashboard'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/set-password" element={<SetPassword />} />

      <Route element={<ProtectedRoute allowedRoles={[ROLES.ADMIN]} />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="terms" element={<Terms />} />
          <Route path="classes" element={<ClassesSections />} />
          <Route path="subjects" element={<Subjects />} />
          <Route path="periods" element={<Periods />} />
          <Route path="timetable" element={<Timetable />} />
          <Route path="staff" element={<Staff />} />
          <Route path="students" element={<Students />} />
          <Route path="parents" element={<Parents />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute allowedRoles={[ROLES.TEACHER]} />}>
        <Route path="/teacher/*" element={<TeacherDashboard />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={[ROLES.STUDENT]} />}>
        <Route path="/student/*" element={<StudentDashboard />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={[ROLES.PARENT]} />}>
        <Route path="/parent/*" element={<ParentDashboard />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
