// src/pages/WatchSession.jsx
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, onSnapshot, collection, query, getDocs, orderBy } from 'firebase/firestore'
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
  const [studentOnline, setStudentOnline] = useState(false)
  const [lastActive, setLastActive] = useState(null)
  const [processing, setProcessing] = useState(false)

  const documentContainerRef = useRef(null)
  const documentReadyRef = useRef(false)

  // Load session + modules
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
        setCurrentModule(sessionData.currentModule || 1)

        // Fetch modules
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

  // NEW: Fetch modules
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
      } else {
        // Fallback
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
      }
      
      if (modulesList.length === 0) {
        setError('No modules found')
        setLoading(false)
        return
      }
      
      setModules(modulesList)
      
      const targetModule = sessionData.currentModule || 1
      const moduleToLoad = modulesList.find(m => m.moduleNumber === targetModule) || modulesList[0]
      setCurrentModule(moduleToLoad.moduleNumber)
      setCurrentModuleContent(moduleToLoad.content)
      
      documentReadyRef.current = true
      
      // Load answers after DOM ready
      setTimeout(() => {
        if (documentContainerRef.current) {
          const moduleKey = `module_${moduleToLoad.moduleNumber}`
          const moduleAns = sessionData.answers?.[moduleKey] || {}
          loadSavedAnswers(documentContainerRef.current, moduleAns)
          lockDocument(documentContainerRef.current)
        }
      }, 200)
      
    } catch (err) {
      console.error('Error fetching modules:', err)
      setError('Could not load modules')
    }
  }

  // NEW: Change module (lecturer view)
  const handleModuleChange = (moduleNumber) => {
    if (moduleNumber === currentModule) return
    
    const newModule = modules.find(m => m.moduleNumber === moduleNumber)
    if (!newModule) return
    
    setCurrentModule(moduleNumber)
    setCurrentModuleContent(newModule.content)
    
    // Load answers for this module
    setTimeout(() => {
      if (documentContainerRef.current) {
        const moduleKey = `module_${moduleNumber}`
        const moduleAns = answers[moduleKey] || {}
        loadSavedAnswers(documentContainerRef.current, moduleAns)
        lockDocument(documentContainerRef.current)
        
        // FIX: Scroll to top when module changes
        documentContainerRef.current.scrollTop = 0
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
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

  // Real-time listener
  useEffect(() => {
    if (!sessionId) return

    const sessionRef = doc(db, 'WBsessions', sessionId)
    const unsubscribe = onSnapshot(sessionRef, (snap) => {
      if (!snap.exists()) return

      const data = snap.data()
      const updatedAnswers = data.answers || {}
      setAnswers(updatedAnswers)
      setModuleProgress(data.moduleProgress || {})

      const lastActiveTime = data.lastActive?.toDate?.() || new Date(0)
      setStudentOnline((new Date() - lastActiveTime) < 30000)
      setLastActive(lastActiveTime)

      // Update current module if changed
      if (data.currentModule && data.currentModule !== currentModule) {
        const newModule = modules.find(m => m.moduleNumber === data.currentModule)
        if (newModule) {
          setCurrentModule(data.currentModule)
          setCurrentModuleContent(newModule.content)
          setTimeout(() => {
            if (documentContainerRef.current) {
              const moduleKey = `module_${data.currentModule}`
              const moduleAns = updatedAnswers[moduleKey] || {}
              loadSavedAnswers(documentContainerRef.current, moduleAns)
              lockDocument(documentContainerRef.current)
            }
          }, 100)
        }
      }

      // Push answers into rendered document
      if (documentContainerRef.current && documentReadyRef.current) {
        const moduleKey = `module_${currentModule}`
        const moduleAns = updatedAnswers[moduleKey] || {}
        loadSavedAnswers(documentContainerRef.current, moduleAns)
        lockDocument(documentContainerRef.current)
      }
    })

    return () => unsubscribe()
  }, [sessionId, currentModule, modules])

  // Apply answers after content loads
  useEffect(() => {
    if (!documentContainerRef.current || !currentModuleContent || processing) return
    const moduleKey = `module_${currentModule}`
    const moduleAns = answers[moduleKey] || {}
    loadSavedAnswers(documentContainerRef.current, moduleAns)
    lockDocument(documentContainerRef.current)
  }, [currentModuleContent, processing])

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

  const totalModules = modules.length
  const completedModules = Object.values(moduleProgress).filter(p => p === 100).length


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
                />
              </div>

              <div className="document-content">
                <div className="module-title-bar">
                  <h2>{modules.find(m => m.moduleNumber === currentModule)?.title || `Module ${currentModule}`}</h2>
                  <div className="module-progress-badge">
                    {moduleProgress[currentModule] || 0}% complete
                  </div>
                </div>
                
                <div className="document-viewer card" ref={documentContainerRef}>
                  {currentModuleContent ? (
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