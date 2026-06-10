// src/pages/WatchSession.jsx
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import { processDocumentForFillable, loadSavedAnswers } from '../lib/documentProcessor'
import Navbar from '../components/shared/Navbar'
import './WatchSession.css'

export default function WatchSession() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [documentHtml, setDocumentHtml] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [answers, setAnswers] = useState({})
  const [studentOnline, setStudentOnline] = useState(false)
  const [lastActive, setLastActive] = useState(null)

  const documentContainerRef = useRef(null)
  // Track whether the document has been rendered so we only process once
  const documentReadyRef = useRef(false)

  // Load session + workbook + document once
  useEffect(() => {
    const loadSession = async () => {
      try {
        const sessionRef = doc(db, 'sessions', sessionId)
        const sessionSnap = await getDoc(sessionRef)

        if (!sessionSnap.exists()) { setError('Session not found'); setLoading(false); return }

        const sessionData = { id: sessionSnap.id, ...sessionSnap.data() }

        if (sessionData.lecturerUid !== user.uid) {
          setError('You do not have access to this session')
          setLoading(false)
          return
        }

        setSession(sessionData)
        setAnswers(sessionData.answers || {})

        const workbookRef = doc(db, 'workbooks', sessionData.workbookId)
        const workbookSnap = await getDoc(workbookRef)

        if (workbookSnap.exists()) {
          await loadDocument(workbookSnap.data(), sessionData.answers || {})
        }

      } catch (err) {
        console.error('Error loading session:', err)
        setError('Failed to load session')
      } finally {
        setLoading(false)
      }
    }

    loadSession()
  }, [sessionId, user])

  const loadDocument = async (workbookData, initialAnswers) => {
    setProcessing(true)
    try {
      const fileUrl = workbookData.fileUrl
      const fileType = workbookData.fileType || ''

      if (fileType.includes('word') || fileType.includes('document')) {
        const response = await fetch(fileUrl)
        const arrayBuffer = await response.arrayBuffer()

        // No-op field change handler — lecturer view is read-only
        const { html: processedHtml } = await processDocumentForFillable(
          arrayBuffer,
          () => {}
        )

        setDocumentHtml(processedHtml)
        documentReadyRef.current = true

        // Load initial answers after a tick so the DOM is ready
        setTimeout(() => {
          if (documentContainerRef.current) {
            loadSavedAnswers(documentContainerRef.current, initialAnswers)
            lockDocument(documentContainerRef.current)
          }
        }, 200)

      } else if (fileType.includes('pdf')) {
        setDocumentHtml(`
          <div class="pdf-viewer">
            <embed src="${fileUrl}#toolbar=0&navpanes=0" type="application/pdf" width="100%" height="700px" />
          </div>
        `)
      } else {
        setDocumentHtml(`<p>Unsupported file type. <a href="${fileUrl}" target="_blank">Download</a></p>`)
      }
    } catch (err) {
      console.error('Error loading document:', err)
      setDocumentHtml('<p>Could not load document.</p>')
    } finally {
      setProcessing(false)
    }
  }

  // Make all fillable elements read-only for the lecturer
  const lockDocument = (container) => {
    if (!container) return
    // Disable contenteditable
    container.querySelectorAll('[contenteditable]').forEach(el => {
      el.setAttribute('contenteditable', 'false')
      el.style.pointerEvents = 'none'
      el.style.cursor = 'default'
    })
    // Disable checkboxes and radios
    container.querySelectorAll('.fillable-checkbox, .fillable-radio').forEach(el => {
      el.style.pointerEvents = 'none'
      el.style.cursor = 'default'
    })
  }

  // Real-time listener — update answers as student types
  useEffect(() => {
    if (!sessionId) return

    const sessionRef = doc(db, 'sessions', sessionId)
    const unsubscribe = onSnapshot(sessionRef, (snap) => {
      if (!snap.exists()) return

      const data = snap.data()
      const updatedAnswers = data.answers || {}
      setAnswers(updatedAnswers)

      // Check student online status
      const lastActiveTime = data.lastActive?.toDate?.() || new Date(0)
      setStudentOnline((new Date() - lastActiveTime) < 30000)
      setLastActive(lastActiveTime)

      // Push answers into the rendered document live
      if (documentContainerRef.current && documentReadyRef.current) {
        loadSavedAnswers(documentContainerRef.current, updatedAnswers)
        lockDocument(documentContainerRef.current)
      }
    })

    return () => unsubscribe()
  }, [sessionId])

  // Also apply answers after document HTML is set
  useEffect(() => {
    if (!documentContainerRef.current || !documentHtml || processing) return
    loadSavedAnswers(documentContainerRef.current, answers)
    lockDocument(documentContainerRef.current)
  }, [documentHtml, processing])

  const formatLastActive = () => {
    if (!lastActive) return 'Never'
    const diff = Math.floor((new Date() - lastActive) / 1000)
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    return lastActive.toLocaleTimeString()
  }

  if (loading) {
    return (
      <div>
        <Navbar />
        <div className="page-loader"><span className="spinner" /> Loading live session...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <Navbar />
        <div className="watch-session-page">
          <div className="container">
            <div className="error-msg">{error}</div>
            <button onClick={() => navigate('/lecturer')} className="btn btn-primary">Back to Dashboard</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Navbar />
      <div className="watch-session-page">

        {/* Live Header */}
        <div className="live-header">
          <div className="container">
            <div className="live-header-content">
              <div className="session-info">
                <div className="live-badge">
                  <span className="live-dot" />
                  LIVE
                </div>
                <h1>{session?.workbookTitle}</h1>
                <p className="student-name">Student: {session?.studentName}</p>
              </div>
              <div className="session-meta">
                <div className={`status-indicator ${studentOnline ? 'online' : 'offline'}`}>
                  {studentOnline ? '● Active now' : '○ Away'}
                </div>
                <div className="last-active">Last activity: {formatLastActive()}</div>
                <div className="answers-count">{Object.keys(answers).length} fields filled</div>
              </div>
              <div className="header-actions">
                <button onClick={() => navigate('/lecturer')} className="btn btn-ghost">
                  ← Back
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Document Viewer — same as student but locked */}
        <div className="document-viewer-container">
          <div className="container">
            <div className="watch-notice">
              👁️ <strong>Read-only view</strong> — this updates live as the student fills the document
            </div>
            <div className="document-viewer card" ref={documentContainerRef}>
              {processing ? (
                <div className="loading-document"><span className="spinner" /> Loading document...</div>
              ) : documentHtml ? (
                <div className="html-viewer" dangerouslySetInnerHTML={{ __html: documentHtml }} />
              ) : (
                <div className="empty-document">No document loaded</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="live-footer">
          <div className="container">
            <div className="footer-content">
              <div className="live-indicator">
                <span className="pulse-dot" />
                Live — updates automatically
              </div>
              <div className="session-id">Session: {sessionId?.slice(0, 8)}...</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}