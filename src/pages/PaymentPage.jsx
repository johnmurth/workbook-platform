// src/pages/PaymentPage.jsx
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc,
  getDoc,
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import Navbar from '../components/shared/Navbar'
import './PaymentPage.css'

const truncateText = (text, maxLength = 200) => {
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}...` : text
}

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
  // paymentStatus: 'idle' | 'pending' | 'failed' | 'completed'
  const [paymentStatus, setPaymentStatus] = useState('idle')
  const [checkingPurchase, setCheckingPurchase] = useState(true)
  const [checkingManually, setCheckingManually] = useState(false)
  const [purchaseId, setPurchaseId] = useState(null)
  const [checkoutRequestId, setCheckoutRequestId] = useState(null)
  const [completedSessionId, setCompletedSessionId] = useState(null)

  // Use a ref (not state) for the unsubscribe function so cleanup always
  // has the latest listener, not the one captured when the effect first ran.
  const unsubscribeRef = useRef(null)

  // ============================================================
  // Tracks which checkoutRequestId is the "current" attempt. Used to
  // ignore any Firestore update that belongs to an older, stale attempt
  // (e.g. a leftover 'failed' status from a previous payment try on the
  // same WBpurchases doc). A ref (not state) so listener/poll callbacks
  // always read the latest value, not a stale closure.
  // ============================================================
  const activeCheckoutIdRef = useRef(null)

  // ============================================================
  // "Failed" state persistence, scoped to this browser tab only.
  //
  // Goal: if the payment fails and the user hits a hard refresh, we
  // want to restore the "Payment Failed" message + their phone number.
  // But if they navigate away to another page and come back later,
  // it should be a clean slate — no stale error.
  //
  // sessionStorage survives a hard refresh (the JS runtime is torn down
  // and rebuilt, but sessionStorage isn't cleared), which is what lets us
  // restore state after a refresh. React's unmount cleanup, on the other
  // hand, only runs on a real in-app navigation away from this page (not
  // on a hard refresh) — so we use that cleanup to clear the flag. That
  // gives us exactly: refresh = remembered, navigate away = forgotten.
  // ============================================================
  const failedFlagKey = `mpesa_failed_${workbookId}`

  const setFailedFlag = () => {
    try {
      sessionStorage.setItem(failedFlagKey, '1')
    } catch (e) {
      // sessionStorage can throw in some private-browsing contexts — safe to ignore
    }
  }

  const clearFailedFlag = () => {
    try {
      sessionStorage.removeItem(failedFlagKey)
    } catch (e) {
      // ignore
    }
  }

  // Central place to move into the "failed" state — always keeps the
  // sessionStorage flag in sync with paymentStatus so refresh-restore
  // works no matter which code path caused the failure.
  const markFailed = (message) => {
    setWaitingForPayment(false)
    setProcessing(false)
    setPaymentStatus('failed')
    setError(message)
    setFailedFlag()
  }

  // STEP 1: Check if user already has a purchase
  useEffect(() => {
    const checkExistingPurchase = async () => {
      if (!user || !workbookId) {
        setCheckingPurchase(false)
        return
      }

      try {
        const compositeId = `${user.uid}_${workbookId}`
        const purchaseRef = doc(db, 'WBpurchases', compositeId)
        const purchaseSnap = await getDoc(purchaseRef)

        if (purchaseSnap.exists()) {
          const data = purchaseSnap.data()
          setPurchaseId(purchaseSnap.id)

          if (data.status === 'completed') {
            navigate(`/session/${data.sessionId}`)
            return
          }

          if (data.status === 'pending') {
            // Trust whatever checkoutRequestId is already on the doc as
            // the current attempt, so the listener/poll below know what
            // to compare future updates against.
            activeCheckoutIdRef.current = data.checkoutRequestId || null
            setWaitingForPayment(true)
            setPaymentStatus('pending')
            setPhone(data.phone || '')
            setupPendingPurchaseListener(purchaseRef)
            setCheckingPurchase(false)
            return
          }

          if (data.status === 'failed') {
            let justRefreshed = false
            try {
              justRefreshed = sessionStorage.getItem(failedFlagKey) === '1'
            } catch (e) {
              // ignore
            }

            if (justRefreshed) {
              // Same tab, same failed attempt — restore it.
              setPhone(data.phone || '')
              setPaymentStatus('failed')
              setError('Your previous payment attempt failed. Please try again.')
            } else {
              // Arrived here fresh (came back from another page, or a
              // new tab/session) — don't resurrect the old error.
              setPaymentStatus('idle')
            }
          }
        }
      } catch (err) {
        console.error('Error checking purchase:', err)
      } finally {
        setCheckingPurchase(false)
      }
    }

    checkExistingPurchase()

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
      }
      // Real in-app navigation away from this page — forget the failed
      // state so coming back later starts fresh. (This does NOT run on
      // a hard refresh, which is exactly what lets refresh restore it.)
      clearFailedFlag()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // STEP 3: Setup listener for pending purchase.
  //
  // IMPORTANT: this doc is reused across attempts (same composite id for
  // this user+workbook every time), so on subscribe, onSnapshot fires
  // immediately with whatever is already there. If that's a leftover
  // 'failed'/'completed' status from a DIFFERENT (older) attempt, we must
  // not act on it — only react once we know it belongs to the attempt
  // we're currently tracking (activeCheckoutIdRef).
  const setupPendingPurchaseListener = (purchaseRef) => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
    }

    const unsubscribe = onSnapshot(purchaseRef, (snap) => {
      if (!snap.exists()) return
      const data = snap.data()

      // Ignore snapshots that belong to a different, older attempt.
      if (
        activeCheckoutIdRef.current &&
        data.checkoutRequestId &&
        data.checkoutRequestId !== activeCheckoutIdRef.current
      ) {
        return
      }

      if (data.status === 'completed') {
        setWaitingForPayment(false)
        setProcessing(false)
        setCompletedSessionId(data.sessionId)
        setPaymentStatus('completed')
      } else if (data.status === 'failed') {
        markFailed('Payment failed. Please try again.')
      }
    })

    unsubscribeRef.current = unsubscribe
    return unsubscribe
  }

  // STEP 3b: Backup poll while waiting for payment.
  // The onSnapshot listener above should catch the update as soon as the
  // M-Pesa callback writes to Firestore, but this poll acts as a safety net
  // in case that listener misses the update (dropped connection, etc.) so
  // the page never gets stuck on the loading screen indefinitely.
  useEffect(() => {
    if (!waitingForPayment || !purchaseId) return

    const interval = setInterval(async () => {
      try {
        const snap = await getDoc(doc(db, 'WBpurchases', purchaseId))
        if (snap.exists()) {
          const data = snap.data()

          // Same stale-attempt guard as the listener above.
          if (
            activeCheckoutIdRef.current &&
            data.checkoutRequestId &&
            data.checkoutRequestId !== activeCheckoutIdRef.current
          ) {
            return
          }

          if (data.status === 'completed') {
            setWaitingForPayment(false)
            setProcessing(false)
            setCompletedSessionId(data.sessionId)
            setPaymentStatus('completed')
          } else if (data.status === 'failed') {
            markFailed('Payment failed. Please try again.')
          }
        }
      } catch (err) {
        console.error('Poll check error:', err)
      }
    }, 5000)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForPayment, purchaseId])

  // STEP 3c: Auto-redirect once payment is confirmed complete.
  useEffect(() => {
    if (paymentStatus === 'completed' && completedSessionId) {
      const t = setTimeout(() => {
        navigate(`/session/${completedSessionId}`)
      }, 1200)
      return () => clearTimeout(t)
    }
  }, [paymentStatus, completedSessionId, navigate])

  // STEP 3d: Client-side timeout fallback.
  // The onSnapshot listener and the poll above both depend on Safaricom's
  // callback actually reaching mpesaCallback and writing to Firestore. If
  // that never happens (wrong PIN with a delayed/missing callback, dropped
  // request, etc.) the page would otherwise wait forever. After ~45s with
  // no resolution, give up waiting and drop into the failed state so the
  // user isn't stuck looking at a spinner indefinitely.
  useEffect(() => {
    if (!waitingForPayment) return

    const timeout = setTimeout(() => {
      markFailed("We couldn't confirm your payment. If you entered the wrong PIN or cancelled the prompt, please try again.")
    }, 45000)

    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForPayment, purchaseId])

  // STEP 4: Handle new purchase
  const handlePurchase = async () => {
    setError('')
    clearFailedFlag()

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
        const pId = result.data.purchaseId || `${user.uid}_${workbookId}`
        const cId = result.data.checkoutRequestId

        setPurchaseId(pId)
        setCheckoutRequestId(cId)
        // This is now the attempt we care about — any snapshot belonging
        // to a different (older) checkoutRequestId gets ignored.
        activeCheckoutIdRef.current = cId

        const purchaseRef = doc(db, 'WBpurchases', pId)

        // KEY FIX: immediately stamp this doc as 'pending' for THIS
        // attempt before subscribing to it. Without this, the doc can
        // still hold 'failed' from a previous attempt, and onSnapshot
        // fires instantly with that stale status the moment we subscribe
        // — causing "Payment Failed" to flash before the new prompt even
        // reaches the phone. merge:true keeps any other existing fields.
        try {
          await setDoc(
            purchaseRef,
            {
              workbookId: workbook.id,
              studentUid: user.uid,
              status: 'pending',
              phone: normalized,
              checkoutRequestId: cId,
              updatedAt: new Date(),
            },
            { merge: true }
          )
        } catch (writeErr) {
          console.error('Failed to mark purchase pending:', writeErr)
        }

        setPhone(normalized)
        setWaitingForPayment(true)
        setPaymentStatus('pending')
        setupPendingPurchaseListener(purchaseRef)
        // FIX: this used to be left `true` forever — nothing ever reset it
        // once the STK push was sent, so if the flow later dropped back to
        // idle/failed (e.g. "no payment found"), the Pay button stayed
        // stuck showing "Sending request..." and disabled.
        setProcessing(false)
      } else {
        markFailed(result.data?.message || 'Failed to initiate payment. Please try again.')
      }
    } catch (err) {
      console.error('Purchase error:', err)
      markFailed(err.message || 'Payment failed. Please try again.')
    }
  }

  // STEP 5: Manual check payment status — this is the ONE "Check Status"
  // handler used everywhere (idle and failed both use this same button).
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
      // ============================================================
      // METHOD 1: Check if user already has a completed purchase
      // ============================================================
      const purchaseIdComposite = `${user.uid}_${workbookId}`
      const purchaseRef = doc(db, 'WBpurchases', purchaseIdComposite)
      const purchaseSnap = await getDoc(purchaseRef)

      if (purchaseSnap.exists()) {
        const purchaseData = purchaseSnap.data()

        if (purchaseData.status === 'completed') {
          setWaitingForPayment(false)
          setProcessing(false)
          setCompletedSessionId(purchaseData.sessionId)
          setPaymentStatus('completed')
          return
        }

        if (purchaseData.status === 'pending') {
          activeCheckoutIdRef.current = purchaseData.checkoutRequestId || null
          setWaitingForPayment(true)
          setPaymentStatus('pending')
          setupPendingPurchaseListener(purchaseRef)
          setError('')
          return
        }

        if (purchaseData.status === 'failed') {
          markFailed('Your previous payment attempt failed. Please try again.')
          return
        }
      }

      // ============================================================
      // METHOD 2: Check transactions collection by workbook + user
      // ============================================================
      const transactionsQuery = query(
        collection(db, 'WBmpesaTransactions'),
        where('workbookId', '==', workbookId),
        where('uid', '==', user.uid),
        where('status', '==', 'completed')
      )

      const transactionsSnap = await getDocs(transactionsQuery)

      if (!transactionsSnap.empty) {
        const txnDoc = transactionsSnap.docs[0]
        const txnData = txnDoc.data()

        const txnAmount = Number(txnData.amount)
        const expectedAmount = Number(workbook.price)

        if (txnAmount === expectedAmount) {
          const userSnap = await getDoc(doc(db, 'WBusers', user.uid))
          const studentName = userSnap.exists() ? userSnap.data().name : 'Student'

          const workbookRef = doc(db, 'workbooks', workbookId)
          const workbookSnap = await getDoc(workbookRef)
          const workbookData = workbookSnap.data()

          // NOTE: uses the v9 modular Firestore API (addDoc/setDoc/updateDoc) —
          // the previous db.collection(...).add()/.doc().set() calls were the
          // v8 namespaced API and would throw at runtime against this v9 `db`.
          const sessionRef = await addDoc(collection(db, 'WBsessions'), {
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
            currentModule: 0,
            totalModules: workbookData.totalModules || 1,
          })

          await setDoc(doc(db, 'WBpurchases', purchaseIdComposite), {
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
            status: 'completed',
          })

          await updateDoc(workbookRef, {
            totalPurchases: (workbookData.totalPurchases || 0) + 1,
          })

          setWaitingForPayment(false)
          setProcessing(false)
          setCompletedSessionId(sessionRef.id)
          setPaymentStatus('completed')
          return
        } else {
          setError(`Payment found but amount doesn't match (paid KES ${txnAmount}, expected KES ${expectedAmount}).`)
          return
        }
      }

      // ============================================================
      // METHOD 3: Check for pending transactions
      // ============================================================
      const pendingQuery = query(
        collection(db, 'WBmpesaTransactions'),
        where('workbookId', '==', workbookId),
        where('uid', '==', user.uid),
        where('status', '==', 'pending')
      )
      const pendingSnap = await getDocs(pendingQuery)

      if (!pendingSnap.empty) {
        setError('You have a pending payment. Please complete it on your phone or wait a moment.')
        return
      }

      // ============================================================
      // METHOD 4: Check by phone number (any workbook)
      // ============================================================
      const phoneQuery = query(
        collection(db, 'WBmpesaTransactions'),
        where('phone', '==', normalized),
        where('uid', '==', user.uid),
        where('status', '==', 'completed')
      )
      const phoneSnap = await getDocs(phoneQuery)

      if (!phoneSnap.empty) {
        const phoneTxns = []
        phoneSnap.forEach((d) => phoneTxns.push({ id: d.id, ...d.data() }))

        const matchingWorkbook = phoneTxns.find((t) => t.workbookId === workbookId)
        if (matchingWorkbook) {
          setError('Payment found but not linked to your account. Please contact support.')
        } else {
          const wbTitles = phoneTxns.map((t) => t.workbookTitle || 'Unknown').join(', ')
          setError(`Payment found for this number, but not for "${workbook.title}". You paid for: ${wbTitles}`)
        }
        return
      }

      // ============================================================
      // NO PAYMENT FOUND — reset back to the input form so the user
      // can immediately retry, instead of leaving the loading state up.
      // ============================================================
      clearFailedFlag()
      setWaitingForPayment(false)
      setPaymentStatus('idle')
      // FIX: also clear `processing` here — otherwise, if it was left
      // `true` from an earlier attempt, the Pay button on the form we're
      // returning to stays disabled and stuck on "Sending request...".
      setProcessing(false)
      setError('No payment found for this number.')
    } catch (err) {
      console.error('Manual check error:', err)
      setError('Failed to check payment status. Please try again.')
    } finally {
      setCheckingManually(false)
    }
  }

  // FIX: buttons should only go inactive when the input is empty — not
  // whenever the number isn't (yet) in perfectly valid 07.../2547... format.
  // Format is still validated inside the click handlers, which show a
  // proper error message if it's wrong.
  const hasPhoneInput = () => phone.trim().length > 0

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

  // A single "busy" flag covering both phases of an active attempt:
  // sending the STK push (processing) and waiting on the user's PIN
  // (waitingForPayment). While either is true we show the in-progress
  // panel above the form, AND keep the phone input + buttons visible
  // but disabled underneath it — so the user can still see what number
  // they entered, but can't fire off another request while one is
  // already in flight.
  const isBusy = processing || waitingForPayment

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
                <p className="description">{truncateText(workbook?.description)}</p>
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

            {paymentStatus === 'completed' && (
              <div className="payment-methods">
                <div className="success-payment">
                  <div className="success-icon">✅</div>
                  <h4>Payment Successful</h4>
                  <p className="success-text">Taking you to your workbook...</p>
                  <div className="spinner-container">
                    <span className="spinner" /> Please wait...
                  </div>
                </div>
              </div>
            )}

            {isBusy && paymentStatus !== 'completed' && (
              <div className="payment-methods">
                <div className="pending-payment">
                  <div className="pending-icon">⏳</div>
                  <h4>Payment in Progress</h4>

                  {waitingForPayment ? (
                    <p className="demo-note">
                      An M-Pesa prompt was sent to <strong>{phone}</strong>.
                      <br />
                      Enter your M-Pesa PIN to complete the payment.
                      <br />
                      This page will update automatically once payment is confirmed.
                    </p>
                  ) : (
                    <p className="demo-note">
                      Sending the M-Pesa prompt to <strong>{phone}</strong>...
                    </p>
                  )}

                  <div className="spinner-container">
                    <span className="spinner" />{' '}
                    {waitingForPayment ? 'Waiting for payment confirmation...' : 'Sending request...'}
                  </div>

                  {waitingForPayment && (
                    <div className="payment-tip">
                      <small>💡 Didn't receive the prompt? Check your network connection or try again.</small>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/*
              FAILED BANNER + ERROR MESSAGE — only for the idle/failed
              states, and only while nothing is currently in flight, so
              this can never show alongside an active attempt.
            */}
            {!isBusy && paymentStatus !== 'completed' && (
              <>
                {paymentStatus === 'failed' && (
                  <div className="payment-methods">
                    <div className="failed-payment">
                      <div className="failed-icon">❌</div>
                      <h4>Payment Failed</h4>
                    </div>
                  </div>
                )}

                {error && <div className="error-msg">{error}</div>}
              </>
            )}

            {/*
              INPUT + BUTTONS — visible in every non-completed state,
              including while isBusy (sending the STK push / waiting on
              the PIN). During those phases it stays on screen but goes
              disabled, so the user can still see the number they typed
              and the two actions sitting there (inactive) underneath
              the "Payment in Progress" panel above, instead of the
              whole form vanishing.
            */}
            {paymentStatus !== 'completed' && (
              <>
                <div className="payment-methods" style={{ paddingLeft: '20px', paddingRight: '20px' }}>
                  <h4>M-Pesa Payment</h4>
                  <div className="form-group">
                    <small>Enter your M-Pesa number</small>
                    <input
                      id="phone"
                      type="tel"
                      className="form-control"
                      placeholder="e.g. 0712345678"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={checkingManually || isBusy}
                    />
                  </div>
                </div>

                <div className="payment-actions-row">
                  <button
                    onClick={handlePurchase}
                    className="btn btn-primary"
                    disabled={checkingManually || isBusy || !hasPhoneInput()}
                  >
                    📲 Pay KES {workbook?.price?.toLocaleString()}
                  </button>

                  <button
                    onClick={handleManualCheck}
                    className="btn btn-secondary"
                    id="manual-check-btn"
                    // Kept ENABLED even while isBusy (unlike the input and
                    // the Pay button) — this is a read-only status check,
                    // so the user should be able to trigger it manually
                    // while the STK push is sending/pending, e.g. if they
                    // already paid and the listener/poll hasn't caught up.
                    disabled={checkingManually || !hasPhoneInput()}
                  >
                    {checkingManually ? (
                      <><span className="spinner" /> Checking...</>
                    ) : (
                      '🔍 Already Paid? Check Status'
                    )}
                  </button>
                </div>

                <p className="manual-check-note">
                  Already paid? Click the 'Already Paid? Check Status' button above.
                </p>
              </>
            )}

            <div className="payment-info" style={{ display: 'none' }}>
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