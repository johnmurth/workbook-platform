// src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/AuthContext'
import NavbarSpacer from './components/shared/NavbarSpacer'

// Pages
import LandingPage        from './pages/LandingPage'
import LoginPage          from './pages/LoginPage'
import RegisterPage       from './pages/RegisterPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage  from './pages/ResetPasswordPage'
import LecturerDashboard  from './pages/LecturerDashboard'
import UploadWorkbook     from './pages/UploadWorkbook'
import EditWorkbook       from './pages/EditWorkbook'
import ViewWorkbook       from './pages/ViewWorkbook'
import StudentDashboard   from './pages/StudentDashboard'
import WorkbookStore      from './pages/WorkbookStore'
import PaymentPage        from './pages/PaymentPage'
import SessionPage        from './pages/SessionPage'
import WatchSession       from './pages/WatchSession'
import PaymentConfirm     from './pages/PaymentConfirm'

function RequireAuth({ children, role }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <div className="page-loader"><span className="spinner" /> Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (role && profile?.role !== role) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <>
      {/* NavbarSpacer ensures content doesn't hide behind navbar */}
      <NavbarSpacer />
      
      <Routes>
        {/* Public */}
        <Route path="/"                element={<LandingPage />} />
        <Route path="/login"           element={<LoginPage />} />
        <Route path="/register"        element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password"  element={<ResetPasswordPage />} />
        <Route path="/store"           element={<WorkbookStore />} />

        {/* Payment flow (auth required) */}
        <Route path="/pay/:workbookId" element={
          <RequireAuth><PaymentPage /></RequireAuth>
        }/>

        {/* Student */}
        <Route path="/student" element={
          <RequireAuth role="student"><StudentDashboard /></RequireAuth>
        }/>
        <Route path="/session/:sessionId" element={
          <RequireAuth role="student"><SessionPage /></RequireAuth>
        }/>

        {/* Lecturer */}
        <Route path="/lecturer" element={
          <RequireAuth role="lecturer"><LecturerDashboard /></RequireAuth>
        }/>
        <Route path="/lecturer/upload" element={
          <RequireAuth role="lecturer"><UploadWorkbook /></RequireAuth>
        }/>
        <Route path="/lecturer/workbook/:workbookId/edit" element={
          <RequireAuth role="lecturer"><EditWorkbook /></RequireAuth>
        }/>
        <Route path="/lecturer/workbook/:workbookId/view" element={
          <RequireAuth role="lecturer"><ViewWorkbook /></RequireAuth>
        }/>
        <Route path="/lecturer/payments" element={
          <RequireAuth role="lecturer"><PaymentConfirm /></RequireAuth>
        }/>
        <Route path="/lecturer/watch/:sessionId" element={
          <RequireAuth role="lecturer"><WatchSession /></RequireAuth>
        }/>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}