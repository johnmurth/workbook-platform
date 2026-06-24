// src/pages/RegisterPage.jsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import Navbar from '../components/shared/Navbar'
import './AuthPage.css'

export default function RegisterPage() {
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole]         = useState('student')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setError(''); setLoading(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      await setDoc(doc(db, 'WBusers', cred.user.uid), {
        uid: cred.user.uid,
        name, email, role,
        createdAt: new Date().toISOString()
      })
      navigate(role === 'lecturer' ? '/lecturer' : '/student')
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') setError('This email is already registered.')
      else setError('Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Navbar />
      <div className="auth-page">
        <div className="auth-card card">
          <h2 className="auth-title">Create account</h2>
          <p className="auth-sub">Join WorkBook today</p>

          {error && <div className="error-msg">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Full Name</label>
              <input className="form-control" type="text" required
                value={name} onChange={e => setName(e.target.value)}
                placeholder="Your full name" />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input className="form-control" type="email" required
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input className="form-control" type="password" required
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Minimum 6 characters" />
            </div>

            <div className="form-group">
              <label>I am a…</label>
              <div className="role-toggle">
                <button type="button"
                  className={`role-btn ${role === 'student' ? 'active' : ''}`}
                  onClick={() => setRole('student')}>
                  🎓 Student
                </button>
                <button type="button"
                  className={`role-btn ${role === 'lecturer' ? 'active' : ''}`}
                  onClick={() => setRole('lecturer')}>
                  👩‍🏫 Lecturer
                </button>
              </div>
            </div>

            <button className="btn btn-primary btn-lg" style={{width:'100%'}}
              type="submit" disabled={loading}>
              {loading ? <><span className="spinner" /> Creating account…</> : 'Create Account'}
            </button>
          </form>

          <p className="auth-footer-text">
            Already have an account? <Link to="/login" className="auth-link">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}