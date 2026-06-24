// src/pages/PaymentPage.jsx
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore'
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
  const [paymentStatus, setPaymentStatus] = useState('idle')
  const [checkingPurchase, setCheckingPurchase] = useState(true)
  const [checkingManually, setCheckingManually] = useState(false)
  const [purchaseId, setPurchaseId] = useState(null)
  const [checkoutRequestId, setCheckoutRequestId] = useState(null)
  const [unsubscribeListener, setUnsubscribeListener] = useState(null)

  // STEP 1: Check if user already has a purchase
  useEffect(() => {
    const checkExistingPurchase = async () => {
      if (!user || !workbookId) {
        setCheckingPurchase(false)
        return
      }

      try {
        const compositeId = `${user.uid}_${workbookId}`
        console.log('🔍 Checking existing purchase:', compositeId)
        const purchaseRef = doc(db, 'WBpurchases', compositeId)
        const purchaseSnap = await getDoc(purchaseRef)
        
        if (purchaseSnap.exists()) {
          const data = purchaseSnap.data()
          console.log('✅ Purchase found:', data.status)
          setPurchaseId(purchaseSnap.id)
          
          if (data.status === 'completed') {
            console.log('✅ Purchase completed! Redirecting...')
            navigate(`/session/${data.sessionId}`)
            return
          }
          
          if (data.status === 'pending') {
            console.log('⏳ Purchase pending')
            setWaitingForPayment(true)
            setPaymentStatus('pending')
            setPhone(data.phone || '')
            setupPendingPurchaseListener(purchaseRef)
            setCheckingPurchase(false)
            return
          }
          
          if (data.status === 'failed') {
            setError('Your previous payment attempt failed. Please try again.')
          }
        } else {
          console.log('❌ No purchase found')
        }
        
      } catch (err) {
        console.error('Error checking purchase:', err)
      } finally {
        setCheckingPurchase(false)
      }
    }

    checkExistingPurchase()

    return () => {
      if (unsubscribeListener) {
        unsubscribeListener()
      }
    }
  }, [user, workbookId, navigate])

  // STEP 2: Fetch workbook details
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

  // STEP 3: Setup listener for pending purchase
  const setupPendingPurchaseListener = (purchaseRef) => {
    if (unsubscribeListener) {
      unsubscribeListener()
    }
    
    const unsubscribe = onSnapshot(purchaseRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data()
        console.log('📡 Purchase update:', data.status)
        
        if (data.status === 'completed') {
          setPaymentStatus('completed')
          setWaitingForPayment(false)
          navigate(`/session/${data.sessionId}`)
        } else if (data.status === 'failed') {
          setPaymentStatus('failed')
          setWaitingForPayment(false)
          setError('Payment failed. Please try again.')
        }
      }
    })
    
    setUnsubscribeListener(unsubscribe)
    return unsubscribe
  }

  // STEP 4: Handle new purchase
  const handlePurchase = async () => {
    setError('')

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
    setPaymentStatus('processing')

    try {
      const functions = getFunctions()
      const initiateMpesaPayment = httpsCallable(functions, 'initiateMpesaPayment')

      const result = await initiateMpesaPayment({
        phone: normalized,
        amount: workbook.price,
        workbookId: workbook.id,
      })

      if (result.data?.success) {
        const pId = result.data.purchaseId || `${user.uid}_${workbookId}`
        const cId = result.data.checkoutRequestId
        
        setPurchaseId(pId)
        setCheckoutRequestId(cId)
        
        const purchaseRef = doc(db, 'WBpurchases', pId)
        
        setWaitingForPayment(true)
        setPaymentStatus('pending')
        setupPendingPurchaseListener(purchaseRef)
        setPhone(normalized)
      } else {
        setError(result.data?.message || 'Failed to initiate payment. Please try again.')
        setPaymentStatus('failed')
        setProcessing(false)
      }
    } catch (err) {
      console.error('Purchase error:', err)
      setError(err.message || 'Payment failed. Please try again.')
      setPaymentStatus('failed')
      setProcessing(false)
    }
  }

  // STEP 5: Manual check payment status (FIXED)
  const handleManualCheck = async () => {
    const trimmed = phone.trim()
    if (!trimmed) {
      setError('Please enter your phone number to check.')
      return
    }
    
    const normalized = trimmed.replace(/^0/, '254').replace(/^\+/, '')
    if (!/^254\d{9}$/.test(normalized)) {
      setError('Enter a valid phone number, e.g. 07XXXXXXXX or 2547XXXXXXXX.')
      return
    }

    setCheckingManually(true)
    setError('')
    
    try {
      console.log('🔍 Manual check initiated...')
      console.log('Phone:', normalized)
      console.log('Workbook ID:', workbookId)
      console.log('User UID:', user.uid)
      console.log('Workbook Price:', workbook.price)
      
      // ============================================================
      // METHOD 1: Check if user already has a completed purchase
      // ============================================================
      const purchaseId = `${user.uid}_${workbookId}`
      console.log('Checking purchase ID:', purchaseId)
      
      const purchaseRef = doc(db, 'WBpurchases', purchaseId)
      const purchaseSnap = await getDoc(purchaseRef)
      
      if (purchaseSnap.exists()) {
        const purchaseData = purchaseSnap.data()
        console.log('✅ Purchase found:', purchaseData)
        console.log('Purchase status:', purchaseData.status)
        
        if (purchaseData.status === 'completed') {
          console.log('✅ Purchase is completed! Redirecting...')
          setError('✅ Payment found! Redirecting to your workbook...')
          setTimeout(() => {
            navigate(`/session/${purchaseData.sessionId}`)
          }, 1000)
          return
        }
        
        if (purchaseData.status === 'pending') {
          console.log('⏳ Purchase is pending')
          setWaitingForPayment(true)
          setPaymentStatus('pending')
          setupPendingPurchaseListener(purchaseRef)
          setError('⏳ Payment is pending. Please complete it on your phone.')
          return
        }
        
        if (purchaseData.status === 'failed') {
          console.log('❌ Purchase failed')
          setPaymentStatus('failed')
          setError('❌ Your previous payment attempt failed. Please try again.')
          return
        }
      } else {
        console.log('❌ No purchase found with ID:', purchaseId)
      }
      
      // ============================================================
      // METHOD 2: Check transactions collection by workbook + user
      // ============================================================
      console.log('🔍 Checking transactions by workbookId + uid...')
      const transactionsQuery = query(
        collection(db, 'WBmpesaTransactions'),
        where('workbookId', '==', workbookId),
        where('uid', '==', user.uid),
        where('status', '==', 'completed')
      )
      
      const transactionsSnap = await getDocs(transactionsQuery)
      console.log('📊 Transactions found:', transactionsSnap.size)
      
      if (!transactionsSnap.empty) {
        const txnDoc = transactionsSnap.docs[0]
        const txnData = txnDoc.data()
        console.log('✅ Completed transaction found:', txnData)
        console.log('Transaction amount:', txnData.amount, 'Type:', typeof txnData.amount)
        console.log('Workbook price:', workbook.price, 'Type:', typeof workbook.price)
        
        // Fix: Convert both to numbers for comparison
        const txnAmount = Number(txnData.amount)
        const expectedAmount = Number(workbook.price)
        console.log('Comparing:', txnAmount, '===', expectedAmount)
        
        if (txnAmount === expectedAmount) {
          console.log('✅ Amount matches! Creating session...')
          setError('✅ Payment found! Creating your session...')
          
          const userSnap = await getDoc(doc(db, 'WBusers', user.uid))
          const studentName = userSnap.exists() ? userSnap.data().name : 'Student'
          
          const workbookRef = doc(db, 'workbooks', workbookId)
          const workbookSnap = await getDoc(workbookRef)
          const workbookData = workbookSnap.data()
          
          const sessionRef = await db.collection('WBsessions').add({
            workbookId: workbook.id,
            workbookTitle: workbook.title,
            workbookUrl: workbook.fileUrl,
            studentUid: user.uid,
            studentName,
            lecturerUid: workbookData.lecturerUid,
            lecturerName: workbookData.lecturerName,
            downloadLimit: workbookData.downloadLimit || 3,
            downloadCount: 0,
            active: true,
            createdAt: new Date(),
            lastActive: new Date(),
            answers: {},
            moduleProgress: {},
            currentModule: 1,
            totalModules: workbookData.totalModules || 1
          })
          
          await db.collection('WBpurchases').doc(purchaseId).set({
            workbookId: workbook.id,
            workbookTitle: workbook.title,
            price: workbook.price,
            studentUid: user.uid,
            studentName,
            lecturerUid: workbookData.lecturerUid,
            lecturerName: workbookData.lecturerName,
            sessionId: sessionRef.id,
            mpesaReceiptNumber: txnData.mpesaReceiptNumber || 'CHECKED',
            purchaseDate: new Date(),
            status: 'completed'
          })
          
          await workbookRef.update({
            totalPurchases: (workbookData.totalPurchases || 0) + 1
          })
          
          setError('✅ Session created! Redirecting...')
          setTimeout(() => {
            navigate(`/session/${sessionRef.id}`)
          }, 1500)
          return
        } else {
          console.log('❌ Amount mismatch:', txnAmount, 'vs', expectedAmount)
          setError(`⚠️ Payment found but amount mismatch. Paid: KES ${txnAmount}, Expected: KES ${expectedAmount}`)
          return
        }
      } else {
        console.log('❌ No completed transactions found for this workbook and user')
      }
      
      // ============================================================
      // METHOD 3: Check for pending transactions
      // ============================================================
      console.log('🔍 Checking for pending transactions...')
      const pendingQuery = query(
        collection(db, 'WBmpesaTransactions'),
        where('workbookId', '==', workbookId),
        where('uid', '==', user.uid),
        where('status', '==', 'pending')
      )
      const pendingSnap = await getDocs(pendingQuery)
      console.log('📊 Pending transactions found:', pendingSnap.size)
      
      if (!pendingSnap.empty) {
        setError('⏳ You have a pending payment. Please complete it on your phone or wait a moment.')
        return
      }
      
      // ============================================================
      // METHOD 4: Check by phone number (any workbook)
      // ============================================================
      console.log('🔍 Checking by phone number:', normalized)
      const phoneQuery = query(
        collection(db, 'WBmpesaTransactions'),
        where('phone', '==', normalized),
        where('uid', '==', user.uid),
        where('status', '==', 'completed')
      )
      const phoneSnap = await getDocs(phoneQuery)
      console.log('📊 Transactions by phone found:', phoneSnap.size)
      
      if (!phoneSnap.empty) {
        const phoneTxns = []
        phoneSnap.forEach(doc => {
          phoneTxns.push({ id: doc.id, ...doc.data() })
        })
        
        console.log('💰 Payments found for this phone number:', phoneTxns)
        
        const matchingWorkbook = phoneTxns.find(t => t.workbookId === workbookId)
        if (matchingWorkbook) {
          console.log('✅ Found matching workbook in phone transactions')
          setError('✅ Payment found but transaction not linked to your account. Please contact support.')
        } else {
          const wbTitles = phoneTxns.map(t => t.workbookTitle || 'Unknown').join(', ')
          console.log('❌ No matching workbook found. Paid for:', wbTitles)
          setError(`💳 Payment found for phone ${normalized} but not for "${workbook.title}". You paid for: ${wbTitles}`)
        }
        return
      }
      
      // ============================================================
      // NO PAYMENT FOUND
      // ============================================================
      console.log('❌ NO PAYMENT FOUND after all checks')
      setError(`❌ No completed payment found for this phone number and workbook.
      
      Please make sure:
      • You used this phone number (${normalized}) for the payment
      • You paid for "${workbook.title}"
      • The payment was completed successfully
      
      If you just paid, please wait a few minutes and try again.`)
      
    } catch (err) {
      console.error('❌ Manual check error:', err)
      setError('Failed to check payment status. Please try again.')
    } finally {
      setCheckingManually(false)
    }
  }

  // STEP 6: Handle retry for failed payments
  const handleRetry = () => {
    setPaymentStatus('idle')
    setError('')
    setProcessing(false)
    setPurchaseId(null)
    setCheckoutRequestId(null)
  }

  const isPhoneValid = () => {
    const trimmed = phone.trim()
    if (!trimmed) return false
    const normalized = trimmed.replace(/^0/, '254').replace(/^\+/, '')
    return /^254\d{9}$/.test(normalized)
  }

  if (checkingPurchase || loading) {
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
                <h3>{workbook?.title}</h3>
                <p className="lecturer">by {workbook?.lecturerName}</p>
                <p className="description">{workbook?.description}</p>
              </div>
            </div>

            <div className="price-breakdown">
              <div className="price-row">
                <span>Workbook Price:</span>
                <span className="price-amount">KES {workbook?.price?.toLocaleString()}</span>
              </div>
              <div className="price-row total">
                <span>Total:</span>
                <span className="total-amount">KES {workbook?.price?.toLocaleString()}</span>
              </div>
            </div>

            {waitingForPayment && (
              <div className="payment-methods">
                <div className="pending-payment">
                  <div className="pending-icon">⏳</div>
                  <h4>Payment in Progress</h4>
                  <p className="demo-note">
                    An M-Pesa prompt was sent to <strong>{phone}</strong>.
                    <br />
                    Enter your M-Pesa PIN to complete the payment.
                    <br />
                    This page will update automatically once payment is confirmed.
                  </p>
                  
                  <div className="spinner-container">
                    <span className="spinner" /> Waiting for payment confirmation...
                  </div>

                  <div className="manual-check-section">
                    <button
                      onClick={handleManualCheck}
                      className="btn btn-secondary"
                      disabled={checkingManually || !isPhoneValid()}
                    >
                      {checkingManually ? (
                        <><span className="spinner" /> Checking...</>
                      ) : (
                        '🔍 Check Payment Status'
                      )}
                    </button>
                    <p className="manual-check-note">
                      Already paid? Click the button above to check if your payment was processed.
                    </p>
                  </div>

                  {error && <div className="error-msg">{error}</div>}
                  
                  <div className="payment-actions">
                    <button
                      onClick={() => navigate('/store')}
                      className="btn btn-secondary"
                    >
                      ← Back to Store
                    </button>
                  </div>
                  <div className="payment-tip">
                    <small>💡 Didn't receive the prompt? Check your network connection or try again.</small>
                  </div>
                </div>
              </div>
            )}

            {paymentStatus === 'failed' && (
              <div className="payment-methods">
                <div className="failed-payment">
                  <div className="failed-icon">❌</div>
                  <h4>Payment Failed</h4>
                  <p className="error-text">{error || 'Something went wrong with your payment.'}</p>
                  
                  <div className="manual-check-section">
                    <button
                      onClick={handleManualCheck}
                      className="btn btn-secondary"
                      disabled={checkingManually || !isPhoneValid()}
                    >
                      {checkingManually ? (
                        <><span className="spinner" /> Checking...</>
                      ) : (
                        '🔍 Check Payment Status'
                      )}
                    </button>
                    <p className="manual-check-note">
                      Already paid but got this error? Click above to check.
                    </p>
                  </div>
                  
                  <div className="payment-actions">
                    <button
                      onClick={handleRetry}
                      className="btn btn-primary"
                    >
                      🔄 Try Again
                    </button>
                    <button
                      onClick={() => navigate('/store')}
                      className="btn btn-secondary"
                    >
                      ← Back to Store
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!waitingForPayment && paymentStatus !== 'failed' && (
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
                    <small>Enter the phone number registered with M-Pesa</small>
                  </div>
                </div>

                {error && <div className="error-msg">{error}</div>}

                <div className="payment-actions-row">
                  <button
                    onClick={handlePurchase}
                    className="btn btn-primary"
                    disabled={processing || !isPhoneValid()}
                  >
                    {processing ? (
                      <><span className="spinner" /> Sending request...</>
                    ) : (
                      `📲 Pay KES ${workbook?.price?.toLocaleString()}`
                    )}
                  </button>
                  
                  <button
                    onClick={handleManualCheck}
                    className="btn btn-secondary"
                    disabled={checkingManually || processing || !isPhoneValid()}
                  >
                    {checkingManually ? (
                      <><span className="spinner" /> Checking...</>
                    ) : (
                      '🔍 Check Payment'
                    )}
                  </button>
                </div>

                <div className="payment-actions">
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
              <p>📥 You can download your completed workbook up to {workbook?.downloadLimit} times.</p>
              {workbook?.totalModules > 1 && (
                <p>📚 This workbook contains {workbook.totalModules} modules.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}