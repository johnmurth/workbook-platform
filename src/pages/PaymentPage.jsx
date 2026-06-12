// src/pages/PaymentPage.jsx
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import Navbar from '../components/shared/Navbar'
import './PaymentPage.css'

export default function PaymentPage() {
  const { workbookId } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()

  const [workbook, setWorkbook] = useState(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [phone, setPhone] = useState('')
  const [waitingForPayment, setWaitingForPayment] = useState(false)

  // Fetch workbook details
  useEffect(() => {
    const fetchWorkbook = async () => {
      try {
        const docRef = doc(db, 'workbooks', workbookId)
        const docSnap = await getDoc(docRef)
        if (docSnap.exists()) {
          setWorkbook({ id: docSnap.id, ...docSnap.data() })
        } else {
          setError('Workbook not found')
        }
      } catch (err) {
        setError('Failed to load workbook details')
      } finally {
        setLoading(false)
      }
    }
    fetchWorkbook()
  }, [workbookId])

  // Check if user has already purchased this workbook (redirect straight to session)
  useEffect(() => {
    const checkExisting = async () => {
      if (!user) return
      const purchaseId = `${user.uid}_${workbookId}`
      const purchaseRef = doc(db, 'purchases', purchaseId)
      const existingPurchase = await getDoc(purchaseRef)
      if (existingPurchase.exists()) {
        navigate(`/session/${existingPurchase.data().sessionId}`)
      }
    }
    checkExisting()
  }, [user, workbookId, navigate])

  // While waiting for payment, listen for the purchase doc to be created by mpesaCallback
  useEffect(() => {
    if (!waitingForPayment || !user) return

    const purchaseId = `${user.uid}_${workbookId}`
    const purchaseRef = doc(db, 'purchases', purchaseId)

    const unsubscribe = onSnapshot(purchaseRef, (snap) => {
      if (snap.exists() && snap.data().status === 'completed') {
        navigate(`/session/${snap.data().sessionId}`)
      }
    })

    return () => unsubscribe()
  }, [waitingForPayment, user, workbookId, navigate])

  const handlePurchase = async () => {
    setError('')

    // Basic phone validation
    const trimmed = phone.trim()
    if (!trimmed) {
      setError('Please enter your M-Pesa phone number.')
      return
    }
    const normalized = trimmed.replace(/^0/, '254').replace(/^\+/, '')
    if (!/^254\d{9}$/.test(normalized)) {
      setError('Enter a valid phone number, e.g. 07XXXXXXXX or 2547XXXXXXXX.')
      return
    }

    setProcessing(true)

    try {
      const functions = getFunctions()
      const initiateMpesaPayment = httpsCallable(functions, 'initiateMpesaPayment')

      const result = await initiateMpesaPayment({
        phone: normalized,
        amount: workbook.price,
        workbookId: workbook.id,
      })

      if (result.data?.success) {
        setWaitingForPayment(true)
      } else {
        setError('Failed to initiate payment. Please try again.')
        setProcessing(false)
      }
    } catch (err) {
      console.error('Purchase error:', err)
      setError(err.message || 'Payment failed. Please try again.')
      setProcessing(false)
    }
  }

  if (loading) {
    return (
      <div>
        <Navbar />
        <div className="page-loader">
          <span className="spinner" /> Loading...
        </div>
      </div>
    )
  }

  if (error && !workbook) {
    return (
      <div>
        <Navbar />
        <div className="payment-page">
          <div className="container">
            <div className="error-msg">{error || 'Workbook not found'}</div>
            <button onClick={() => navigate('/store')} className="btn btn-secondary">
              ← Back to Store
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Navbar />
      <div className="payment-page">
        <div className="container">
          <div className="payment-card card">
            <div className="payment-header">
              <h1>Complete Your Purchase</h1>
              <p>You're about to purchase this workbook</p>
            </div>

            <div className="workbook-summary">
              <div className="summary-icon">📚</div>
              <div className="summary-details">
                <h3>{workbook.title}</h3>
                <p className="lecturer">by {workbook.lecturerName}</p>
                <p className="description">{workbook.description}</p>
              </div>
            </div>

            <div className="price-breakdown">
              <div className="price-row">
                <span>Workbook Price:</span>
                <span className="price-amount">KES {workbook.price?.toLocaleString()}</span>
              </div>
              <div className="price-row total">
                <span>Total:</span>
                <span className="total-amount">KES {workbook.price?.toLocaleString()}</span>
              </div>
            </div>

            {waitingForPayment ? (
              <div className="payment-methods">
                <h4>📱 Check Your Phone</h4>
                <p className="demo-note">
                  An M-Pesa prompt has been sent to <strong>{phone}</strong>.
                  <br />
                  Enter your M-Pesa PIN to complete the payment.
                  <br />
                  This page will update automatically once payment is confirmed.
                </p>
                <div className="payment-actions">
                  <span className="spinner" /> Waiting for payment confirmation...
                </div>
              </div>
            ) : (
              <>
                <div className="payment-methods">
                  <h4>M-Pesa Payment</h4>
                  <div className="form-group">
                    <label htmlFor="phone">M-Pesa Phone Number</label>
                    <input
                      id="phone"
                      type="tel"
                      className="form-control"
                      placeholder="e.g. 0712345678"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={processing}
                    />
                  </div>
                </div>

                {error && <div className="error-msg">{error}</div>}

                <div className="payment-actions">
                  <button
                    onClick={handlePurchase}
                    className="btn btn-primary"
                    disabled={processing}
                  >
                    {processing ? (
                      <><span className="spinner" /> Sending request...</>
                    ) : (
                      `📲 Pay KES ${workbook.price?.toLocaleString()} with M-Pesa`
                    )}
                  </button>
                  <button
                    onClick={() => navigate('/store')}
                    className="btn btn-secondary"
                    disabled={processing}
                  >
                    ← Back to Store
                  </button>
                </div>
              </>
            )}

            <div className="payment-info">
              <p>💡 After purchase, you'll get immediate access to fill your workbook online.</p>
              <p>📥 You can download your completed workbook up to {workbook.downloadLimit} times.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}