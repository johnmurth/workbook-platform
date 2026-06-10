// src/pages/LecturerDashboard.jsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import Navbar from '../components/shared/Navbar'
import './LecturerDashboard.css'
import { getFileTypeLabel } from '../lib/fileUtils'

export default function LecturerDashboard() {
  const { user, profile } = useAuth()
  const [workbooks, setWorkbooks] = useState([])
  const [sessions,  setSessions]  = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    if (!user) return
    const q = query(
      collection(db, 'workbooks'),
      where('lecturerUid', '==', user.uid),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(q, snap => {
      setWorkbooks(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [user])

  useEffect(() => {
    if (!user) return
    const q = query(
      collection(db, 'sessions'),
      where('lecturerUid', '==', user.uid),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(q, snap => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [user])

  const activeSessions = sessions.filter(s => s.active)

  return (
    <div>
      <Navbar />
      <div className="dashboard-page container">

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
          <div className="stat-card card">
            <div className="stat-num">{sessions.length}</div>
            <div className="stat-label">Total Sessions</div>
          </div>
          <div className="stat-card card">
            <div className="stat-num" style={{color:'var(--accent)'}}>{activeSessions.length}</div>
            <div className="stat-label">Active Now</div>
          </div>
        </div>

        {/* Active Sessions */}
        {activeSessions.length > 0 && (
          <section className="dash-section">
            <h2 className="section-title">
              <span className="live-dot" /> Live Sessions
            </h2>
            <div className="sessions-grid">
              {activeSessions.map(s => (
                <div key={s.id} className="session-card card">
                  <div className="session-info">
                    <div className="session-student">{s.studentName || 'Student'}</div>
                    <div className="session-wb">{s.workbookTitle}</div>
                  </div>
                  <Link to={`/lecturer/watch/${s.id}`} className="btn btn-primary btn-sm">
                    👁 Watch Live
                  </Link>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Workbooks */}
        <section className="dash-section">
          <h2 className="section-title">Your Workbooks</h2>
          {loading && <div className="page-loader"><span className="spinner" /></div>}
          {!loading && workbooks.length === 0 && (
            <div className="empty-state card">
              <div className="empty-icon">📚</div>
              <h3>No workbooks yet</h3>
              <p>Upload your first workbook to get started.</p>
              <Link to="/lecturer/upload" className="btn btn-primary" style={{marginTop:16}}>
                Upload Workbook
              </Link>
            </div>
          )}
          <div className="workbooks-grid">
            {workbooks.map(wb => (
              <div key={wb.id} className="workbook-card card">
                <div className="wb-type-badge">{getFileTypeLabel(wb.fileType)}</div>
                <h3 className="wb-title">{wb.title}</h3>
                <p className="wb-desc">{wb.description}</p>
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
            ))}
          </div>
        </section>

        {/* All Sessions */}
        {sessions.length > 0 && (
          <section className="dash-section">
            <h2 className="section-title">All Student Sessions</h2>
            <div className="all-sessions-table card">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Workbook</th>
                    <th>Started</th>
                    <th>Downloads</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => (
                    <tr key={s.id}>
                      <td>{s.studentName || '—'}</td>
                      <td>{s.workbookTitle || '—'}</td>
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
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

      </div>
    </div>
  )
}