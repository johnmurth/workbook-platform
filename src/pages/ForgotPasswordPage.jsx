// src/pages/ForgotPasswordPage.jsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../lib/firebase'
import Navbar from '../components/shared/Navbar'
import './AuthPage.css'

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('')
  const [error, setError]     = useState('')
  const [sent, setSent]       = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // Reset link opens OUR reset-password page directly (not Firebase's
      // hosted page), carrying the oobCode as a query param.
      const actionCodeSettings = {
        url: `${window.location.origin}/reset-password`,
        handleCodeInApp: true,
      }

      await sendPasswordResetEmail(auth, email, actionCodeSettings)
      // Always show success, regardless of whether the email is registered —
      // Firebase's enumeration protection means we can't (and shouldn't)
      // distinguish this case anyway.
      setSent(true)
    } catch (err) {
      if (err.code === 'auth/invalid-email') {
        setError('Please enter a valid email address.')
      } else if (err.code === 'auth/too-many-requests') {
        setError('Too many attempts. Please wait a bit and try again.')
      } else {
        // Still show success for any other error to avoid leaking
        // account-existence information.
        setSent(true)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Navbar />
      <div className="auth-page">
        <div className="auth-card card">
          {sent ? (
            <>
              <h2 className="auth-title">Check your email</h2>
              <p className="auth-sub">
                If an account exists for <strong>{email}</strong>, a password
                reset link has been sent. It may take a few minutes to arrive —
                check your spam folder too.
              </p>
              <p className="auth-footer-text">
                <Link to="/login" className="auth-link">Back to sign in</Link>
              </p>
            </>
          ) : (
            <>
              <h2 className="auth-title">Reset your password</h2>
              <p className="auth-sub">
                Enter the email associated with your account and we'll send
                you a link to reset your password.
              </p>

              {error && <div className="error-msg">{error}</div>}

              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>Email</label>
                  <input className="form-control" type="email" required
                    value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" />
                </div>
                <button className="btn btn-primary btn-lg" style={{width:'100%'}}
                  type="submit" disabled={loading}>
                  {loading ? <><span className="spinner" /> Sending…</> : 'Send reset link'}
                </button>
              </form>

              <p className="auth-footer-text">
                Remembered it? <Link to="/login" className="auth-link">Back to sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}