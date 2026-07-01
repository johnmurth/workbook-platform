// src/pages/WatchSession.jsx
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, onSnapshot, collection, query, getDocs, orderBy, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import { loadSavedAnswers } from '../lib/documentProcessor'
import ModuleNavigation from '../components/ModuleNavigation'
import Navbar from '../components/shared/Navbar'
import './WatchSession.css'

export default function WatchSession() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [session, setSession] = useState(null)
  const [modules, setModules] = useState([])
  const [currentModule, setCurrentModule] = useState(1)
  const [currentModuleContent, setCurrentModuleContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [answers, setAnswers] = useState({})
  const [moduleProgress, setModuleProgress] = useState({})
  const [moduleStatus, setModuleStatus] = useState({})
  const [studentOnline, setStudentOnline] = useState(false)
  const [lastActive, setLastActive] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [loadingModule, setLoadingModule] = useState(false)
  const [remarks, setRemarks] = useState('')
  const [showRemarkError, setShowRemarkError] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const documentContainerRef = useRef(null)
  const documentReadyRef = useRef(false)
  const moduleContentCache = useRef({})
  const [lecturerLockedModule, setLecturerLockedModule] = useState(null)

  // ── Load session + modules ──
  useEffect(() => {
    const loadSession = async () => {
      try {
        const sessionRef = doc(db, 'WBsessions', sessionId)
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
        setModuleProgress(sessionData.moduleProgress || {})
        setModuleStatus(sessionData.moduleStatus || {})
        setCurrentModule(sessionData.currentModule || 1)

        await fetchModules(sessionData.workbookId, sessionData)

      } catch (err) {
        console.error('Error loading session:', err)
        setError('Failed to load session')
      } finally {
        setLoading(false)
      }
    }

    loadSession()
  }, [sessionId, user])

  // ── Load module content from Storage URL ──
  const loadModuleContent = async (module) => {
    if (!module) return
    
    setLoadingModule(true)
    
    try {
      let content = ''
      
      if (moduleContentCache.current[module.id]) {
        console.log('📦 Using cached content for module:', module.moduleNumber)
        content = moduleContentCache.current[module.id]
      } else if (module.contentUrl) {
        console.log('📥 Fetching module content from Storage:', module.contentUrl)
        const response = await fetch(module.contentUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch module content: ${response.status}`)
        }
        content = await response.text()
        moduleContentCache.current[module.id] = content
        console.log('✅ Module content loaded and cached, length:', content.length)
      } else if (module.content) {
        console.log('📄 Using Firestore content for module:', module.moduleNumber)
        content = module.content
        moduleContentCache.current[module.id] = content
      } else {
        throw new Error('No content available for this module')
      }
      
      setCurrentModuleContent(content)
      
      // Load answers after DOM ready
      setTimeout(() => {
        if (documentContainerRef.current) {
          const moduleKey = `module_${module.moduleNumber}`
          const moduleAns = answers[moduleKey] || {}
          loadSavedAnswers(documentContainerRef.current, moduleAns)
          lockDocument(documentContainerRef.current)
        }
      }, 200)
      
    } catch (err) {
      console.error('❌ Error loading module content:', err)
      setError(`Failed to load module: ${err.message}`)
    } finally {
      setLoadingModule(false)
    }
  }

  // ── Fetch modules ──
  const fetchModules = async (workbookId, sessionData) => {
    try {
      const modulesQuery = query(
        collection(db, 'workbooks', workbookId, 'WBmodules'),
        orderBy('moduleNumber')
      )
      const modulesSnap = await getDocs(modulesQuery)
      
      let modulesList = []
      if (!modulesSnap.empty) {
        modulesList = modulesSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        console.log('✅ Modules found in sub-collection:', modulesList.length)
      } else {
        const fallbackQuery = query(
          collection(db, 'WBmodules'),
          where('workbookId', '==', workbookId),
          orderBy('moduleNumber')
        )
        const fallbackSnap = await getDocs(fallbackQuery)
        modulesList = fallbackSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        console.log('✅ Modules found in fallback:', modulesList.length)
      }
      
      if (modulesList.length === 0) {
        setError('No modules found')
        setLoading(false)
        return
      }
      
      console.log('📦 Modules list:', modulesList.map(m => ({ number: m.moduleNumber, title: m.title, hasUrl: !!m.contentUrl })))
      setModules(modulesList)
      
      const targetModule = sessionData.currentModule ?? 1
      const moduleToLoad = modulesList.find(m => m.moduleNumber === targetModule) || modulesList[0]
      setCurrentModule(moduleToLoad.moduleNumber)
      documentReadyRef.current = true
      
      // Set remarks for current module from Firestore
      const status = sessionData.moduleStatus?.[moduleToLoad.moduleNumber] || {}
      setRemarks(status.remarks || '')
      
      await loadModuleContent(moduleToLoad)
      
    } catch (err) {
      console.error('Error fetching modules:', err)
      setError('Could not load modules')
    }
  }

  // ── Change module (lecturer view) ──
  const handleModuleChange = (moduleNumber) => {
    if (moduleNumber === currentModule) return
    
    const newModule = modules.find(m => m.moduleNumber === moduleNumber)
    if (!newModule) return
    
    // Lock the lecturer's view to this module
    setLecturerLockedModule(moduleNumber)
    
    setCurrentModule(moduleNumber)
    
    // Load remarks from moduleStatus for the new module
    const status = moduleStatus[moduleNumber] || {}
    setRemarks(status.remarks || '')
    setShowRemarkError(false)
    
    loadModuleContent(newModule)
    
    setTimeout(() => {
      if (documentContainerRef.current) {
        documentContainerRef.current.scrollTop = 0
      }
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }, 100)
  }

  const lockDocument = (container) => {
    if (!container) return
    container.querySelectorAll('[contenteditable]').forEach(el => {
      el.setAttribute('contenteditable', 'false')
      el.style.pointerEvents = 'none'
      el.style.cursor = 'default'
    })
    container.querySelectorAll('.fillable-checkbox, .fillable-radio').forEach(el => {
      el.style.pointerEvents = 'none'
      el.style.cursor = 'default'
    })
  }

  // ── Handle Approve ──
  const handleApprove = async () => {
    setActionLoading(true)
    setShowRemarkError(false)
    
    try {
      const sessionRef = doc(db, 'WBsessions', sessionId)
      
      await updateDoc(sessionRef, {
        [`moduleStatus.${currentModule}`]: {
          status: 'approved',
          remarks: remarks || '',
          submittedAt: moduleStatus[currentModule]?.submittedAt || new Date(),
          reviewedAt: new Date(),
          reviewedBy: user.uid
        },
        lastActive: new Date()
      })
      
      // Update local state
      setModuleStatus(prev => ({
        ...prev,
        [currentModule]: {
          ...prev[currentModule],
          status: 'approved',
          remarks: remarks || '',
          reviewedAt: new Date(),
          reviewedBy: user.uid
        }
      }))
      
    } catch (err) {
      console.error('Error approving module:', err)
      setError('Failed to approve module. Please try again.')
      setTimeout(() => setError(''), 5000)
    } finally {
      setActionLoading(false)
    }
  }

  // ── Handle Revoke ──
  const handleRevoke = async () => {
    // Remarks are required for revoke
    if (!remarks || remarks.trim() === '') {
      setShowRemarkError(true)
      return
    }
    
    setActionLoading(true)
    setShowRemarkError(false)
    
    try {
      const sessionRef = doc(db, 'WBsessions', sessionId)
      
      await updateDoc(sessionRef, {
        [`moduleStatus.${currentModule}`]: {
          status: 'revoked',
          remarks: remarks.trim(),
          submittedAt: moduleStatus[currentModule]?.submittedAt || new Date(),
          reviewedAt: new Date(),
          reviewedBy: user.uid
        },
        lastActive: new Date()
      })
      
      // Update local state
      setModuleStatus(prev => ({
        ...prev,
        [currentModule]: {
          ...prev[currentModule],
          status: 'revoked',
          remarks: remarks.trim(),
          reviewedAt: new Date(),
          reviewedBy: user.uid
        }
      }))
      
    } catch (err) {
      console.error('Error revoking module:', err)
      setError('Failed to revoke module. Please try again.')
      setTimeout(() => setError(''), 5000)
    } finally {
      setActionLoading(false)
    }
  }

  // ── Real-time listener ──
  useEffect(() => {
    if (!sessionId) return

    const sessionRef = doc(db, 'WBsessions', sessionId)
    const unsubscribe = onSnapshot(sessionRef, (snap) => {
      if (!snap.exists()) return

      const data = snap.data()
      const updatedAnswers = data.answers || {}
      setAnswers(updatedAnswers)
      setModuleProgress(data.moduleProgress || {})
      setModuleStatus(data.moduleStatus || {})

      // ── DO NOT update remarks here ──
      // This prevents the textarea from being reset while typing

      const lastActiveTime = data.lastActive?.toDate?.() || new Date(0)
      setStudentOnline((new Date() - lastActiveTime) < 30000)
      setLastActive(lastActiveTime)

      // ── ONLY auto-jump if lecturer hasn't locked a module ──
      if (lecturerLockedModule === null && data.currentModule && data.currentModule !== currentModule) {
        const newModule = modules.find(m => m.moduleNumber === data.currentModule)
        if (newModule) {
          setCurrentModule(data.currentModule)
          loadModuleContent(newModule)
        }
      }

      if (documentContainerRef.current && documentReadyRef.current && currentModuleContent) {
        const moduleKey = `module_${currentModule}`
        const moduleAns = updatedAnswers[moduleKey] || {}
        loadSavedAnswers(documentContainerRef.current, moduleAns)
        lockDocument(documentContainerRef.current)
      }
    })

    return () => unsubscribe()
  }, [sessionId, currentModule, modules, currentModuleContent, lecturerLockedModule])

  // Apply answers after content loads
  useEffect(() => {
    if (!documentContainerRef.current || !currentModuleContent || loadingModule) return
    const moduleKey = `module_${currentModule}`
    const moduleAns = answers[moduleKey] || {}
    loadSavedAnswers(documentContainerRef.current, moduleAns)
    lockDocument(documentContainerRef.current)
  }, [currentModuleContent, loadingModule])

  const formatLastActive = () => {
    if (!lastActive) return 'Never'
    const diff = Math.floor((new Date() - lastActive) / 1000)
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    return lastActive.toLocaleTimeString()
  }

  // ── Render approval panel ──
  const renderApprovalPanel = () => {
    const status = moduleStatus[currentModule]?.status || 'not_started'
    
    if (status === 'not_started') {
      return (
        <div className="approval-panel card">
          <div className="approval-header">
            <h3>📋 Module {currentModule} - Not Started</h3>
            <span className="status-badge not-started">Not Started</span>
          </div>
          <div className="approval-body">
            <p className="text-muted">Student hasn't submitted this module yet.</p>
          </div>
        </div>
      )
    }
    
    return (
      <div className="approval-panel card">
        <div className="approval-header">
          <h3>📋 Module {currentModule} Review</h3>
          <span className={`status-badge ${status}`}>
            {status === 'approved' && '✅ Approved'}
            {status === 'pending' && '⏳ Pending'}
            {status === 'revoked' && '❌ Revoked'}
          </span>
        </div>
        
        <div className="approval-body">
          {/* ── APPROVED STATE ── */}
          {status === 'approved' && (
            <>
              <div className="approval-message success">
                ✅ This module has been approved.
              </div>
              
              {remarks && (
                <div className="remarks-display">
                  <strong>Remarks:</strong>
                  <p>{remarks}</p>
                </div>
              )}
              
              <div className="remarks-section">
                <label htmlFor="remarks">Remarks (required to revoke approval)</label>
                <textarea
                  id="remarks"
                  value={remarks}
                  onChange={(e) => {
                    setRemarks(e.target.value)
                    if (showRemarkError) setShowRemarkError(false)
                  }}
                  placeholder="Explain why you're revoking approval..."
                  className={`${showRemarkError ? 'error' : ''}`}
                />
                {showRemarkError && (
                  <div className="error-message">⚠️ Remarks are required to revoke approval.</div>
                )}
              </div>
              
              <div className="approval-actions">
                <button
                  className="btn btn-danger"
                  onClick={handleRevoke}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Processing...' : '❌ Revoke Approval'}
                </button>
              </div>
            </>
          )}
          
          {/* ── PENDING STATE ── */}
          {status === 'pending' && (
            <>
              <div className="approval-message info">
                ⏳ Student has submitted this module for review.
              </div>
              
              <div className="remarks-section">
                <label htmlFor="remarks">Remarks (optional for approve, required for revoke)</label>
                <textarea
                  id="remarks"
                  value={remarks}
                  onChange={(e) => {
                    setRemarks(e.target.value)
                    if (showRemarkError) setShowRemarkError(false)
                  }}
                  placeholder="Add feedback for the student..."
                  className={`${showRemarkError ? 'error' : ''}`}
                />
                {showRemarkError && (
                  <div className="error-message">⚠️ Remarks are required when revoking a module.</div>
                )}
              </div>
              
              <div className="approval-actions">
                <button
                  className="btn btn-success"
                  onClick={handleApprove}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Processing...' : '✅ Approve'}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleRevoke}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Processing...' : '❌ Revoke'}
                </button>
              </div>
            </>
          )}
          
          {/* ── REVOKED STATE ── */}
          {status === 'revoked' && (
            <>
              <div className="approval-message warning">
                ❌ This module was revoked. Student can revise and resubmit.
              </div>
              
              {remarks && (
                <div className="remarks-display">
                  <strong>Feedback:</strong>
                  <p>{remarks}</p>
                </div>
              )}
              
              <div className="remarks-section">
                <label htmlFor="remarks">Remarks (optional for approve, required for revoke)</label>
                <textarea
                  id="remarks"
                  value={remarks}
                  onChange={(e) => {
                    setRemarks(e.target.value)
                    if (showRemarkError) setShowRemarkError(false)
                  }}
                  placeholder="Add feedback for the student..."
                  className={`${showRemarkError ? 'error' : ''}`}
                />
                {showRemarkError && (
                  <div className="error-message">⚠️ Remarks are required when revoking a module.</div>
                )}
              </div>
              
              <div className="approval-actions">
                <button
                  className="btn btn-success"
                  onClick={handleApprove}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Processing...' : '✅ Approve'}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleRevoke}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Processing...' : '❌ Revoke'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
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

  const totalModules = modules.length

  return (
    <div>
      <Navbar />
      <div className="watch-session-page">

        {/* ── LIVE HEADER ── */}
        <div className="live-header">
          <div className="container">
            <div className="live-header-content">
              <div className="session-info">
                <div className="live-badge">
                  <span className="live-dot" />
                  LIVE
                </div>
                <span className="workbook-title">{session?.workbookTitle}</span>
                <span className="workbook-meta">
                  <span className="separator">•</span>
                  {session?.studentName}
                  <span className="separator">•</span>
                  M{currentModule}/{totalModules}
                </span>
              </div>

              <div className="session-controls">
                <div className={`status-indicator ${studentOnline ? 'online' : 'offline'}`}>
                  <span className={`status-dot ${studentOnline ? 'online' : 'offline'}`} />
                  {studentOnline ? 'Active' : 'Away'}
                </div>
                <div className="session-stats">
                  <span className="stat-item">
                    <span className="stat-icon">📝</span>
                    <span className="stat-value">
                      {Object.keys(answers).reduce((total, key) => {
                        if (key.startsWith('module_')) {
                          return total + Object.keys(answers[key] || {}).length
                        }
                        return total
                      }, 0)}
                    </span>
                  </span>
                  <span className="stat-item">
                    <span className="stat-icon">⏱</span>
                    <span className="stat-value">{formatLastActive()}</span>
                  </span>
                </div>
                <div className="header-actions">
                  <button onClick={() => navigate('/lecturer')} className="btn btn-ghost">
                    ✕
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── DOCUMENT VIEWER ── */}
        <div className="document-viewer-container">
          <div className="container">
            <div className="watch-notice">
              👁️ <strong>Read-only view</strong> — this updates live as the student fills each module
            </div>
            
            <div className="document-layout">
              <div className="module-sidebar">
                <ModuleNavigation
                  modules={modules}
                  currentModule={currentModule}
                  onModuleChange={handleModuleChange}
                  moduleProgress={moduleProgress}
                  moduleStatus={moduleStatus}
                />
              </div>

              <div className="document-content">
                {/* Approval Panel */}
                {renderApprovalPanel()}
                
                <div className="module-title-bar">
                  <h2>{modules.find(m => m.moduleNumber === currentModule)?.title || `Module ${currentModule}`}</h2>
                  <div className="module-progress-badge">
                    {moduleProgress[currentModule] || 0}% complete
                  </div>
                </div>
                
                <div className="document-viewer card" ref={documentContainerRef}>
                  {loadingModule ? (
                    <div className="loading-document"><span className="spinner" /> Loading module...</div>
                  ) : currentModuleContent ? (
                    <div className="html-viewer" dangerouslySetInnerHTML={{ __html: currentModuleContent }} />
                  ) : (
                    <div className="empty-document">No content available</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── FOOTER ── */}
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