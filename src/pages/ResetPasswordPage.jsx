// src/pages/ResetPasswordPage.jsx
import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth'
import { auth } from '../lib/firebase'
import Navbar from '../components/shared/Navbar'
import './AuthPage.css'

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const oobCode = searchParams.get('oobCode')
  const mode    = searchParams.get('mode')

  const [checking, setChecking] = useState(true)
  const [codeValid, setCodeValid] = useState(false)
  const [email, setEmail] = useState('')

  const [password, setPassword]               = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)

  // Validate the code as soon as the page loads.
  useEffect(() => {
    if (mode !== 'resetPassword' || !oobCode) {
      setChecking(false)
      setCodeValid(false)
      return
    }
    verifyPasswordResetCode(auth, oobCode)
      .then((verifiedEmail) => {
        setEmail(verifiedEmail)
        setCodeValid(true)
      })
      .catch(() => {
        setCodeValid(false)
      })
      .finally(() => setChecking(false))
  }, [mode, oobCode])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      await confirmPasswordReset(auth, oobCode, password)
      setDone(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (err) {
      if (err.code === 'auth/expired-action-code') {
        setError('This reset link has expired. Please request a new one.')
      } else if (err.code === 'auth/weak-password') {
        setError('Please choose a stronger password.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Loading state while we verify the code ──
  if (checking) {
    return (
      <div>
        <Navbar />
        <div className="auth-page">
          <div className="auth-card card" style={{textAlign:'center'}}>
            <span className="spinner" /> Verifying link…
          </div>
        </div>
      </div>
    )
  }

  // ── Invalid or expired link ──
  if (!codeValid) {
    return (
      <div>
        <Navbar />
        <div className="auth-page">
          <div className="auth-card card">
            <h2 className="auth-title">Link invalid or expired</h2>
            <p className="auth-sub">
              This password reset link is no longer valid. Reset links expire
              after a while or can only be used once.
            </p>
            <Link to="/forgot-password" className="btn btn-primary btn-lg" style={{width:'100%', display:'block', textAlign:'center'}}>
              Request a new link
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ── Success state ──
  if (done) {
    return (
      <div>
        <Navbar />
        <div className="auth-page">
          <div className="auth-card card">
            <h2 className="auth-title">Password updated</h2>
            <p className="auth-sub">
              Your password has been reset. Redirecting you to sign in…
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Set new password form ──
  return (
    <div>
      <Navbar />
      <div className="auth-page">
        <div className="auth-card card">
          <h2 className="auth-title">Set a new password</h2>
          <p className="auth-sub">Resetting password for <strong>{email}</strong></p>

          {error && <div className="error-msg">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>New password</label>
              <input className="form-control" type="password" required
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" />
            </div>
            <div className="form-group">
              <label>Confirm new password</label>
              <input className="form-control" type="password" required
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••" />
            </div>
            <button className="btn btn-primary btn-lg" style={{width:'100%'}}
              type="submit" disabled={loading}>
              {loading ? <><span className="spinner" /> Updating…</> : 'Update password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}