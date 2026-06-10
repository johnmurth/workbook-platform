// src/components/shared/Navbar.jsx
import { Link, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { useAuth } from '../../lib/AuthContext'
import './Navbar.css'

export default function Navbar() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/')
  }

  return (
    <nav className="navbar">
      <div className="container navbar-inner">
        <Link to="/" className="navbar-brand">
          <span className="brand-icon">📖</span>
          <span className="brand-name">WorkBook</span>
        </Link>

        <div className="navbar-links">
          <Link to="/store" className="nav-link">Browse</Link>

          {!user && <>
            <Link to="/login"    className="nav-link">Log in</Link>
            <Link to="/register" className="btn btn-primary btn-sm">Get Started</Link>
          </>}

          {user && profile?.role === 'student' && <>
            <Link to="/student" className="nav-link">My Workbooks</Link>
            <button onClick={handleLogout} className="btn btn-ghost btn-sm">Log out</button>
          </>}

          {user && profile?.role === 'lecturer' && <>
            <Link to="/lecturer"          className="nav-link">Dashboard</Link>
            <Link to="/lecturer/payments" className="nav-link">Payments</Link>
            <button onClick={handleLogout} className="btn btn-ghost btn-sm">Log out</button>
          </>}
        </div>
      </div>
    </nav>
  )
}