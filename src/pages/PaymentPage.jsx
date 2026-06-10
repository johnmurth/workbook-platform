// src/pages/PaymentPage.jsx
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore'
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

  const handlePurchase = async () => {
    setProcessing(true)
    setError('')

    try {
      // 1. Check if already purchased
      const purchaseId = `${user.uid}_${workbookId}`
      const purchaseRef = doc(db, 'purchases', purchaseId)
      const existingPurchase = await getDoc(purchaseRef)
      
      if (existingPurchase.exists()) {
        // Already purchased - redirect to existing session
        const sessionId = existingPurchase.data().sessionId
        navigate(`/session/${sessionId}`)
        return
      }

      // 2. Create a new session for this workbook
      const sessionData = {
        workbookId: workbook.id,
        workbookTitle: workbook.title,
        workbookUrl: workbook.fileUrl,
        studentUid: user.uid,
        studentName: profile?.name || 'Student',
        lecturerUid: workbook.lecturerUid,
        lecturerName: workbook.lecturerName,
        downloadLimit: workbook.downloadLimit || 3,
        downloadCount: 0,
        active: true,
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp(),
        answers: {} // Will store student's answers
      }
      
      const sessionRef = await addDoc(collection(db, 'sessions'), sessionData)

      // 3. Create purchase record
      const purchaseData = {
        workbookId: workbook.id,
        workbookTitle: workbook.title,
        price: workbook.price,
        studentUid: user.uid,
        studentName: profile?.name || 'Student',
        lecturerUid: workbook.lecturerUid,
        lecturerName: workbook.lecturerName,
        sessionId: sessionRef.id,
        purchaseDate: serverTimestamp(),
        status: 'completed'
      }
      
      await setDoc(doc(db, 'purchases', purchaseId), purchaseData)

      // 4. Update workbook purchase count
      const workbookRef = doc(db, 'workbooks', workbookId)
      const currentPurchases = workbook.totalPurchases || 0
      await setDoc(workbookRef, { totalPurchases: currentPurchases + 1 }, { merge: true })

      // 5. Redirect to the session
      navigate(`/session/${sessionRef.id}`)
      
    } catch (err) {
      console.error('Purchase error:', err)
      setError('Payment failed. Please try again.')
    } finally {
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

  if (error || !workbook) {
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

            <div className="payment-methods">
              <h4>Demo Payment</h4>
              <p className="demo-note">
                🔧 This is a demo. In production, M-Pesa/Stripe would be integrated.
                <br />
                Click "Confirm Demo Purchase" to simulate payment.
              </p>
            </div>

            {error && <div className="error-msg">{error}</div>}

            <div className="payment-actions">
              <button 
                onClick={handlePurchase} 
                className="btn btn-primary"
                disabled={processing}
              >
                {processing ? (
                  <><span className="spinner" /> Processing...</>
                ) : (
                  '✅ Confirm Demo Purchase'
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