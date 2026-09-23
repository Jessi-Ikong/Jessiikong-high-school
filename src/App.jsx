import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { ROLES } from './lib/roles'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import SetPassword from './pages/SetPassword'
import AdminDashboard from './pages/AdminDashboard'
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
        <Route path="/admin/*" element={<AdminDashboard />} />
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
