// src/pages/LoginPage.jsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../lib/firebase'
import Navbar from '../components/shared/Navbar'
import './AuthPage.css'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
      navigate('/')
    } catch (err) {
      setError('Invalid email or password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Navbar />
      <div className="auth-page">
        <div className="auth-card card">
          <h2 className="auth-title">Welcome back</h2>
          <p className="auth-sub">Sign in to your WorkBook account</p>

          {error && <div className="error-msg">{error}</div>}

          <form onSubmit={handleSubmit}>
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
                placeholder="••••••••" />
            </div>
            <div style={{textAlign:'right', marginTop:'-8px', marginBottom:'20px'}}>
              <Link to="/forgot-password" className="auth-link" style={{fontSize:'0.85rem'}}>
                Forgot password?
              </Link>
            </div>
            <button className="btn btn-primary btn-lg" style={{width:'100%'}}
              type="submit" disabled={loading}>
              {loading ? <><span className="spinner" /> Signing in…</> : 'Sign In'}
            </button>
          </form>

          <p className="auth-footer-text">
            Don't have an account? <Link to="/register" className="auth-link">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  )
}