// src/pages/LecturerDashboard.jsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where, onSnapshot, orderBy, getDocs, doc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import Navbar from '../components/shared/Navbar'
import './LecturerDashboard.css'
import { getFileTypeLabel } from '../lib/fileUtils'

export default function LecturerDashboard() {
  const { user, profile } = useAuth()
  const [workbooks, setWorkbooks] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [moduleStats, setModuleStats] = useState({})
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [now, setNow] = useState(Date.now())

  // ── Force re-render every 2 seconds to check active status ──
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 2000)
    
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!user) return
    const q = query(
      collection(db, 'workbooks'),
      where('lecturerUid', '==', user.uid),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(q, async snap => {
      const wbList = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setWorkbooks(wbList)
      
      for (const wb of wbList) {
        await fetchModuleStats(wb.id)
      }
      
      setLoading(false)
    })
    return unsub
  }, [user])

  useEffect(() => {
    if (!user) return
    
    const q = query(
      collection(db, 'WBsessions'),
      where('lecturerUid', '==', user.uid),
      orderBy('createdAt', 'desc')
    )
    
    const unsub = onSnapshot(q, snap => {
      const sessionsList = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setSessions(sessionsList)
      
      // Count pending approvals      let pendingCount = 0
      sessionsList.forEach(session => {
        if (session.moduleStatus) {
          Object.values(session.moduleStatus).forEach(status => {
            if (status.status === 'pending') pendingCount++
          })
        }
      })
      setPendingApprovals(pendingCount)
    })
    
    return unsub
  }, [user])

  const fetchModuleStats = async (workbookId) => {
    try {
      const sessionsQuery = query(
        collection(db, 'WBsessions'),
        where('workbookId', '==', workbookId)
      )
      const sessionsSnap = await getDocs(sessionsQuery)
      const sessionsList = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      
      const stats = {}
      sessionsList.forEach(session => {
        if (session.moduleProgress) {
          Object.entries(session.moduleProgress).forEach(([moduleNum, progress]) => {
            if (!stats[moduleNum]) stats[moduleNum] = { total: 0, completed: 0 }
            stats[moduleNum].total++
            if (progress === 100) stats[moduleNum].completed++
          })
        }
      })
      
      setModuleStats(prev => ({ ...prev, [workbookId]: stats }))
    } catch (err) {
      console.error('Error fetching module stats:', err)
    }
  }

  // ── Check if session is active based on lastActive ──
  const isSessionActive = (session) => {
    if (!session.lastActive) return false
    const lastActiveTime = session.lastActive?.toDate?.() || new Date(session.lastActive)
    const diffSeconds = (new Date() - lastActiveTime) / 1000
    return diffSeconds < 30
  }

  // ── Get last active time string ──
  const getLastActiveString = (session) => {
    if (!session.lastActive) return 'Never'
    const lastActiveTime = session.lastActive?.toDate?.() || new Date(session.lastActive)
    const diffSeconds = Math.floor((new Date() - lastActiveTime) / 1000)
    if (diffSeconds < 60) return `${diffSeconds}s ago`
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`
    return lastActiveTime.toLocaleTimeString()
  }

  // ── Get pending submissions for a workbook ──
  const getPendingSubmissions = (workbookId) => {
    const pending = []
    sessions.forEach(session => {
      if (session.workbookId === workbookId && session.moduleStatus) {
        Object.entries(session.moduleStatus).forEach(([moduleNum, status]) => {
          if (status.status === 'pending') {
            pending.push({
              sessionId: session.id,
              studentName: session.studentName || 'Unknown',
              moduleNumber: parseInt(moduleNum),
              submittedAt: status.submittedAt,
              session: session
            })
          }
        })
      }
    })
    return pending.sort((a, b) => {
      if (a.submittedAt && b.submittedAt) {
        return new Date(a.submittedAt) - new Date(b.submittedAt)
      }
      return 0
    })
  }

  // ── Get approved submissions for a workbook ──
  const getApprovedSubmissions = (workbookId) => {
    const approved = []
    sessions.forEach(session => {
      if (session.workbookId === workbookId && session.moduleStatus) {
        Object.entries(session.moduleStatus).forEach(([moduleNum, status]) => {
          if (status.status === 'approved') {
            approved.push({
              sessionId: session.id,
              studentName: session.studentName || 'Unknown',
              moduleNumber: parseInt(moduleNum),
              reviewedAt: status.reviewedAt,
              remarks: status.remarks,
              session: session
            })
          }
        })
      }
    })
    return approved.sort((a, b) => {
      if (a.reviewedAt && b.reviewedAt) {
        return new Date(b.reviewedAt) - new Date(a.reviewedAt)
      }
      return 0
    })
  }

  const getModuleCount = (workbook) => {
    return workbook.totalModules || 1
  }

  const getModuleStatsDisplay = (workbookId) => {
    const stats = moduleStats[workbookId] || {}
    const entries = Object.entries(stats)
    if (entries.length === 0) return 'No submissions yet'
    
    return entries.map(([moduleNum, data]) => (
      <span key={moduleNum} className="module-stat-tag">
        M{moduleNum}: {data.completed}/{data.total}
      </span>
    ))
  }

  // ── Recalculate active sessions ──
  const activeSessions = sessions.filter(s => isSessionActive(s))

  return (
    <div>
      <Navbar />
      <div className="lecturer-dashboard container">

        <div className="dashboard-header">
          <div>
            <h1 className="dashboard-title">Lecturer Dashboard</h1>
            <p className="dashboard-sub">Welcome back, {profile?.name}</p>
          </div>
          <Link to="/lecturer/upload" className="btn btn-primary">
            + Upload Workbook
          </Link>
        </div>

        {/* Stats */}
        <div className="stats-row">
          <div className="stat-card card">
            <div className="stat-num">{workbooks.length}</div>
            <div className="stat-label">Workbooks</div>
          </div>
          <div className="stat-card card"  style={{display: 'none'}}>
            <div className="stat-num">{sessions.length}</div>
            <div className="stat-label">Total Sessions</div>
          </div>
          <div className="stat-card card"  style={{display: 'none'}}>
            <div className="stat-num" style={{color: pendingApprovals > 0 ? '#ffc107' : 'var(--ink-muted)'}}>
              {pendingApprovals}
            </div>
            <div className="stat-label">Pending Approvals</div>
            {pendingApprovals > 0 && (
              <div className="stat-sub" style={{fontSize: '10px', color: '#856404'}}>
                ⏳ Needs review
              </div>
            )}
          </div>
        </div>

        {/* Active Sessions */}
        {activeSessions.length > 0 ? (
          <section className="dash-section"  style={{display: 'none'}}>
            <h2 className="section-title">
              <span className="live-dot" /> Live Sessions
            </h2>
            <div className="sessions-grid">
              {activeSessions.map(s => (
                <div key={s.id} className="session-card card">
                  <div className="session-info">
                    <div className="session-student">{s.studentName || 'Student'}</div>
                    <div className="session-wb">{s.workbookTitle}</div>
                    <div className="session-module">
                      Module {s.currentModule || 1} of {s.totalModules || 1}
                    </div>
                    <div className="session-last-active" style={{fontSize: '11px', color: '#22c55e'}}>
                      🟢 {getLastActiveString(s)}
                    </div>
                  </div>
                  <Link to={`/lecturer/watch/${s.id}`} className="btn btn-primary btn-sm">
                    👁 Watch Live
                  </Link>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="dash-section">
            <div className="empty-sessions card">
              <div className="empty-icon" style={{fontSize: '2.5rem'}}>🟤</div>
              <h3 style={{marginBottom: '4px'}}>No Active Sessions</h3>
              <p style={{color: 'var(--ink-muted)'}}>
                Students will appear here when they are actively working on a workbook.
              </p>
            </div>
          </section>
        )}

        {/* Workbooks with Pending Submissions */}
        <section className="dash-section">
          <h2 className="section-title">📋 Workbooks & Submissions</h2>
          {loading && <div className="page-loader"><span className="spinner" /></div>}
          {!loading && workbooks.length === 0 && (
            <div className="empty-sessions card">
              <div className="empty-icon">📚</div>
              <h3>No workbooks yet</h3>
              <p>Upload your first workbook to get started.</p>
              <Link to="/lecturer/upload" className="btn btn-primary" style={{marginTop:16}}>
                Upload Workbook
              </Link>
            </div>
          )}
          <div className="workbooks-grid">
            {workbooks.map(wb => {
              const moduleCount = getModuleCount(wb)
              const pendingSubmissions = getPendingSubmissions(wb.id)
              const approvedSubmissions = getApprovedSubmissions(wb.id)
              
              return (
                <div key={wb.id} className="workbook-card card">
                  <div className="wb-type-badge">{getFileTypeLabel(wb.fileType)}</div>
                  <h3 className="wb-title">{wb.title}</h3>
                  <p className="wb-desc">{wb.description}</p>
                  
                  <div className="wb-module-info">
                    <span className="module-count-badge">
                      📚 {moduleCount} Module{moduleCount > 1 ? 's' : ''}
                    </span>
                    {pendingSubmissions.length > 0 && (
                      <span className="pending-badge" style={{marginLeft: '8px', background: '#fff3cd', color: '#856404', padding: '2px 10px', borderRadius: '100px', fontSize: '0.7rem', fontWeight: '600'}}>
                        ⏳ {pendingSubmissions.length} pending
                      </span>
                    )}
                  </div>

                  {/* Pending Submissions */}
                  {pendingSubmissions.length > 0 && (
                    <div className="wb-submissions pending">
                      <div className="submissions-label">⏳ Pending Approval:</div>
                      <div className="submissions-list">
                        {pendingSubmissions.map((sub, idx) => (
                          <div key={idx} className="submission-item">
                            <span className="student-name">{sub.studentName}</span>
                            <span className="module-tag">Module {sub.moduleNumber}</span>
                            <Link to={`/lecturer/watch/${sub.sessionId}`} className="btn btn-sm btn-primary">
                              View
                            </Link>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Approved Submissions */}
                  {approvedSubmissions.length > 0 && (
                    <div className="wb-submissions approved">
                      <div className="submissions-label">✅ Recently Approved:</div>
                      <div className="submissions-list">
                        {approvedSubmissions.slice(0, 3).map((sub, idx) => (
                          <div key={idx} className="submission-item">
                            <span className="student-name">{sub.studentName}</span>
                            <span className="module-tag">Module {sub.moduleNumber}</span>
                            <Link to={`/lecturer/watch/${sub.sessionId}`} className="btn btn-sm btn-ghost">
                              View
                            </Link>
                          </div>
                        ))}
                        {approvedSubmissions.length > 3 && (
                          <div className="submission-more">
                            +{approvedSubmissions.length - 3} more approved
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {pendingSubmissions.length === 0 && approvedSubmissions.length === 0 && (
                    <div className="wb-submissions empty">
                      <div className="submissions-label" style={{color: 'var(--ink-muted)'}}>
                        No submissions yet
                      </div>
                    </div>
                  )}
                  
                  <div className="wb-meta">
                    <span className="wb-price">KES {wb.price?.toLocaleString()}</span>
                    <span className="wb-limit">⬇️ {wb.downloadLimit} downloads max</span>
                  </div>
                  <div className="wb-actions">
                    <Link to={`/lecturer/workbook/${wb.id}/edit`} className="btn btn-secondary btn-sm">
                      ✏️ Edit Fields
                    </Link>
                    <span className="wb-sessions">
                      {sessions.filter(s => s.workbookId === wb.id).length} sessions
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* All Sessions */}
        {sessions.length > 0 && (
          <section className="dash-section"  style={{display: 'none'}}>
            <h2 className="section-title">All Student Sessions</h2>
            <div className="all-sessions-table card">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Workbook</th>
                    <th>Status</th>
                    <th>Modules</th>
                    <th>Started</th>
                    <th>Downloads</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => {
                    const completed = s.moduleProgress ? Object.values(s.moduleProgress).filter(p => p === 100).length : 0
                    const total = s.totalModules || 1
                    const sessionActive = isSessionActive(s)
                    
                    return (
                      <tr key={s.id}>
                        <td>{s.studentName || '—'}</td>
                        <td>{s.workbookTitle || '—'}</td>
                        <td>
                          <span className={`badge ${sessionActive ? 'badge-green' : 'badge-gray'}`}>
                            {sessionActive ? `🟢 ${getLastActiveString(s)}` : `⚫ ${getLastActiveString(s)}`}
                          </span>
                        </td>
                        <td>
                          <span className="module-progress-cell">
                            {completed}/{total} modules
                          </span>
                        </td>
                        <td>{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}</td>
                        <td>
                          <span className={`badge ${s.downloadCount >= s.downloadLimit ? 'badge-red' : 'badge-gray'}`}>
                            {s.downloadCount || 0} / {s.downloadLimit || 3}
                          </span>
                        </td>
                        <td>
                          <Link to={`/lecturer/watch/${s.id}`} className="btn btn-ghost btn-sm">
                            View
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

      </div>
    </div>
  )
}