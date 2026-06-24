// src/pages/StudentDashboard.jsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where, getDocs, doc, updateDoc, orderBy } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import { calculateModuleProgress } from '../lib/moduleUtils'
import Navbar from '../components/shared/Navbar'
import './StudentDashboard.css'

export default function StudentDashboard() {
  const { user, profile } = useAuth()
  const [purchases, setPurchases] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('workbooks')

  useEffect(() => {
    if (user) {
      fetchStudentData()
    }
  }, [user])

  const fetchStudentData = async () => {
    try {
      // Fetch all purchases for this student
      const purchasesQuery = query(
        collection(db, 'WBpurchases'),
        where('studentUid', '==', user.uid),
        orderBy('purchaseDate', 'desc')
      )
      const purchasesSnap = await getDocs(purchasesQuery)
      const purchasesList = purchasesSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      setPurchases(purchasesList)

      // Fetch all sessions for this student
      const sessionsQuery = query(
        collection(db, 'WBsessions'),
        where('studentUid', '==', user.uid),
        orderBy('lastActive', 'desc')
      )
      const sessionsSnap = await getDocs(sessionsQuery)
      const sessionsList = sessionsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      setSessions(sessionsList)
    } catch (error) {
      console.error('Error fetching student data:', error)
    } finally {
      setLoading(false)
    }
  }

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
              <span className="stat-value">{purchases.length}</span>
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
            >
              📝 Active Sessions
            </button>
          </div>

          {/* Workbooks Tab */}
          {activeTab === 'workbooks' && (
            <div className="workbooks-tab">
              {purchases.length === 0 ? (
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
                  {purchases.map((purchase) => {
                    const session = sessions.find(s => s.id === purchase.sessionId)
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
                        <div className="module-progress-section">
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
                          <div className="download-info">
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
              {sessions.length === 0 ? (
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
                  {sessions.map((session) => {
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
          <div className="tips-section">
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