// src/pages/StudentDashboard.jsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where, getDocs, doc, updateDoc, orderBy } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
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
        collection(db, 'purchases'),
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
        collection(db, 'sessions'),
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
              <span className="stat-label">Workbooks Purchased</span>
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
                        
                        {session && (
                          <div className="progress-section">
                            <div className="progress-label">
                              <span>Progress</span>
                              <span>{getProgressPercentage(session)}%</span>
                            </div>
                            <div className="progress-bar">
                              <div 
                                className="progress-fill" 
                                style={{ width: `${getProgressPercentage(session)}%` }}
                              />
                            </div>
                          </div>
                        )}
                        
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

          {/* Sessions Tab */}
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
                  {sessions.map((session) => (
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
                        
                        <div className="session-stats">
                          <span>📝 {session.answers ? Object.keys(session.answers).length : 0} answers saved</span>
                          <span>📥 {session.downloadCount || 0}/{session.downloadLimit || 3} downloads used</span>
                        </div>
                      </div>
                      
                      <Link to={`/session/${session.id}`} className="btn btn-secondary">
                        {session.active ? 'Continue →' : 'View →'}
                      </Link>
                    </div>
                  ))}
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
              <li>You can download your completed workbook up to the download limit</li>
              <li>Need help? Contact your lecturer through the session page</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}