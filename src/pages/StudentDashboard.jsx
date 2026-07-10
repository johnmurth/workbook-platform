// src/pages/StudentDashboard.jsx
import { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where, onSnapshot, doc, orderBy } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import { calculateModuleProgress } from '../lib/moduleUtils'
import Navbar from '../components/shared/Navbar'
import './StudentDashboard.css'

export default function StudentDashboard() {
  const { user, profile } = useAuth()
  const [purchases, setPurchases] = useState([])
  const [sessions, setSessions] = useState([])
  const [purchasesLoaded, setPurchasesLoaded] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [deletedWorkbookIds, setDeletedWorkbookIds] = useState(new Set())
  const [activeTab, setActiveTab] = useState('workbooks')

  // Tracks active per-workbook onSnapshot unsubscribers, keyed by workbookId
  const workbookListenersRef = useRef({})

  // ── Real-time listener: purchases ──
  useEffect(() => {
    if (!user) return
    const purchasesQuery = query(
      collection(db, 'WBpurchases'),
      where('studentUid', '==', user.uid),
      orderBy('purchaseDate', 'desc')
    )
    const unsub = onSnapshot(purchasesQuery, snap => {
      setPurchases(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setPurchasesLoaded(true)
    }, err => {
      console.error('Error listening to purchases:', err)
      setPurchasesLoaded(true)
    })
    return unsub
  }, [user])

  // ── Real-time listener: sessions ──
  useEffect(() => {
    if (!user) return
    const sessionsQuery = query(
      collection(db, 'WBsessions'),
      where('studentUid', '==', user.uid),
      orderBy('lastActive', 'desc')
    )
    const unsub = onSnapshot(sessionsQuery, snap => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setSessionsLoaded(true)
    }, err => {
      console.error('Error listening to sessions:', err)
      setSessionsLoaded(true)
    })
    return unsub
  }, [user])

  // ── Derive the current set of workbookIds referenced by purchases/sessions ──
  const workbookIds = useMemo(() => {
    return [
      ...new Set([
        ...purchases.map(p => p.workbookId).filter(Boolean),
        ...sessions.map(s => s.workbookId).filter(Boolean)
      ])
    ]
  }, [purchases, sessions])

  // ── Keep a live onSnapshot listener on each referenced workbook doc,
  //    adding/removing listeners as the set of workbookIds changes,
  //    so isDeleted flips (delete/undo) reflect instantly ──
  useEffect(() => {
    const current = workbookListenersRef.current
    const currentIds = new Set(Object.keys(current))
    const neededIds = new Set(workbookIds)

    // Start listening to any new workbookIds
    workbookIds.forEach(workbookId => {
      if (current[workbookId]) return // already listening

      const unsub = onSnapshot(
        doc(db, 'workbooks', workbookId),
        wbSnap => {
          setDeletedWorkbookIds(prev => {
            const next = new Set(prev)
            const isGone = !wbSnap.exists() || wbSnap.data().isDeleted
            if (isGone) {
              next.add(workbookId)
            } else {
              next.delete(workbookId)
            }
            return next
          })
        },
        err => {
          console.error('Error listening to workbook', workbookId, err)
        }
      )
      current[workbookId] = unsub
    })

    // Stop listening to workbookIds no longer referenced
    currentIds.forEach(workbookId => {
      if (!neededIds.has(workbookId)) {
        current[workbookId]()
        delete current[workbookId]
        setDeletedWorkbookIds(prev => {
          if (!prev.has(workbookId)) return prev
          const next = new Set(prev)
          next.delete(workbookId)
          return next
        })
      }
    })
    // Note: no cleanup return here — listeners are intentionally kept alive
    // across renders and only torn down above when a workbookId drops out,
    // or on unmount below.
  }, [workbookIds])

  // ── Tear down all workbook listeners on unmount ──
  useEffect(() => {
    return () => {
      Object.values(workbookListenersRef.current).forEach(unsub => unsub())
      workbookListenersRef.current = {}
    }
  }, [])

  // ── Filtered lists: hide anything tied to a deleted/missing workbook ──
  const visiblePurchases = useMemo(
    () => purchases.filter(p => !deletedWorkbookIds.has(p.workbookId)),
    [purchases, deletedWorkbookIds]
  )
  const visibleSessions = useMemo(
    () => sessions.filter(s => !deletedWorkbookIds.has(s.workbookId)),
    [sessions, deletedWorkbookIds]
  )

  const loading = !purchasesLoaded || !sessionsLoaded

  const getProgressPercentage = (session) => {
    if (!session.answers) return 0
    const totalFields = Object.keys(session.answers).length
    // This is a placeholder - actual total fields would come from workbook structure
    return Math.min(totalFields * 10, 100)
  }

  // NEW: Get module progress for a session
  const getModuleProgress = (session) => {
    if (!session.moduleProgress) return {}
    return session.moduleProgress
  }

  // NEW: Get total modules completed
  const getModulesCompleted = (session) => {
    if (!session.moduleProgress) return 0
    const progress = session.moduleProgress
    const completed = Object.values(progress).filter(p => p === 100).length
    return completed
  }

  // NEW: Get total modules count
  const getTotalModules = (session) => {
    return session.totalModules || 1
  }

  if (loading) {
    return (
      <div>
        <Navbar />
        <div className="page-loader">
          <span className="spinner" /> Loading your dashboard...
        </div>
      </div>
    )
  }

  return (
    <div>
      <Navbar />
      <div className="student-dashboard">
        <div className="container">
          {/* Welcome Section */}
          <div className="welcome-section">
            <div className="welcome-text">
              <h1>Welcome back, {profile?.name?.split(' ')[0] || 'Student'}! 👋</h1>
              <p>Continue your learning journey where you left off</p>
            </div>
            <div className="stats-badge">
              <span className="stat-value">{visiblePurchases.length}</span>
              <span className="stat-label" style={{ color: 'white' }}>Workbooks Purchased</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="dashboard-tabs">
            <button 
              className={`tab-btn ${activeTab === 'workbooks' ? 'active' : ''}`}
              onClick={() => setActiveTab('workbooks')}
            >
              📚 My Workbooks
            </button>
            <button 
              className={`tab-btn ${activeTab === 'sessions' ? 'active' : ''}`}
              onClick={() => setActiveTab('sessions')}
              style={{ display: "none"}}
            >
              📝 Active Sessions
            </button>
          </div>

          {/* Workbooks Tab */}
          {activeTab === 'workbooks' && (
            <div className="workbooks-tab">
              {visiblePurchases.length === 0 ? (
                <div className="empty-state card">
                  <div className="empty-icon">📚</div>
                  <h3>No workbooks yet</h3>
                  <p>Browse the store and purchase your first workbook</p>
                  <Link to="/store" className="btn btn-primary" style={{ marginTop: 16 }}>
                    Browse Store →
                  </Link>
                </div>
              ) : (
                <div className="purchased-grid">
                  {visiblePurchases.map((purchase) => {
                    const session = visibleSessions.find(s => s.id === purchase.sessionId)
                    const modulesCompleted = session ? getModulesCompleted(session) : 0
                    const totalModules = session ? getTotalModules(session) : 1
                    
                    return (
                      <div key={purchase.id} className="purchased-card card">
                        <div className="card-header">
                          <span className="workbook-icon">📖</span>
                          <span className="purchase-date">
                            Purchased: {purchase.purchaseDate?.toDate?.().toLocaleDateString() || 'Recently'}
                          </span>
                        </div>
                        
                        <h3 className="workbook-title">{purchase.workbookTitle}</h3>
                        <p className="lecturer-name">by {purchase.lecturerName}</p>
                        
                        {/* NEW: Module progress display */}
                        <div className="module-progress-section" style={{ display: "none"}}>
                          <div className="module-progress-header">
                            <span>Progress: {modulesCompleted}/{totalModules} Modules</span>
                            <span>{Math.round((modulesCompleted/totalModules) * 100)}%</span>
                          </div>
                          <div className="progress-bar">
                            <div 
                              className="progress-fill" 
                              style={{ width: `${(modulesCompleted/totalModules) * 100}%` }}
                            />
                          </div>
                          {session?.moduleProgress && (
                            <div className="module-tags">
                              {Object.entries(session.moduleProgress).map(([moduleNum, progress]) => (
                                <span 
                                  key={moduleNum}
                                  className={`module-tag ${progress === 100 ? 'completed' : 'in-progress'}`}
                                >
                                  M{moduleNum}: {progress}%
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        
                        <div className="session-info">
                          <div className="download-info" style={{ display: "none"}}>
                            📥 Downloads: {session?.downloadCount || 0} / {session?.downloadLimit || 3}
                          </div>
                          {session?.lastActive?.toDate && (
                            <div className="last-active">
                              Last active: {session.lastActive.toDate().toLocaleDateString()}
                            </div>
                          )}
                        </div>
                        
                        <Link 
                          to={`/session/${purchase.sessionId}`} 
                          className="btn btn-primary resume-btn"
                        >
                          {session?.answers && Object.keys(session.answers).length > 0 
                            ? '✏️ Resume Workbook' 
                            : '🚀 Start Workbook'}
                        </Link>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Sessions Tab - Updated to show module info */}
          {activeTab === 'sessions' && (
            <div className="sessions-tab">
              {visibleSessions.length === 0 ? (
                <div className="empty-state card">
                  <div className="empty-icon">📝</div>
                  <h3>No active sessions</h3>
                  <p>Purchase a workbook to start a session</p>
                  <Link to="/store" className="btn btn-primary" style={{ marginTop: 16 }}>
                    Browse Store →
                  </Link>
                </div>
              ) : (
                <div className="sessions-list">
                  {visibleSessions.map((session) => {
                    const modulesCompleted = getModulesCompleted(session)
                    const totalModules = getTotalModules(session)
                    
                    return (
                      <div key={session.id} className="session-item card">
                        <div className="session-status">
                          <span className={`status-badge ${session.active ? 'active' : 'completed'}`}>
                            {session.active ? '● Active' : '○ Completed'}
                          </span>
                        </div>
                        
                        <div className="session-content">
                          <h4>{session.workbookTitle}</h4>
                          <p className="session-meta">
                            Started: {session.createdAt?.toDate?.().toLocaleDateString() || 'Recently'}
                          </p>
                          
                          {/* NEW: Module progress */}
                          <div className="session-module-progress">
                            <span>📚 Modules: {modulesCompleted}/{totalModules} completed</span>
                          </div>
                          
                          <div className="session-stats">
                            <span>📝 {session.answers ? Object.keys(session.answers).length : 0} answers saved</span>
                            <span>📥 {session.downloadCount || 0}/{session.downloadLimit || 3} downloads used</span>
                          </div>
                        </div>
                        
                        <Link to={`/session/${session.id}`} className="btn btn-secondary">
                          {session.active ? 'Continue →' : 'View →'}
                        </Link>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Quick Tips */}
          <div className="tips-section"  style={{ display: "none"}}>
            <h4>💡 Quick Tips</h4>
            <ul>
              <li>Your progress is saved automatically as you fill your workbook</li>
              <li>Lecturers can see your answers in real-time</li>
              <li>Workbooks are divided into modules for easier learning</li>
              <li>You can download your completed workbook up to the download limit</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}