// src/pages/LecturerDashboard.jsx
import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore'
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
  const [selectedWorkbookId, setSelectedWorkbookId] = useState(null)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [moduleFields, setModuleFields] = useState({})

  // ── Workbook management modal state ──
  const [showWorkbooksModal, setShowWorkbooksModal] = useState(false)
  const [confirmPermanentDeleteId, setConfirmPermanentDeleteId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const tabsContainerRef = useRef(null)

  // ── Force re-render every 2 seconds to check active status ──
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 2000)

    return () => clearInterval(interval)
  }, [])

  // ── Fetch workbooks ──
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

      // Auto-select first ACTIVE (non-deleted) workbook if none selected
      const activeList = wbList.filter(wb => !wb.isDeleted)
      if (activeList.length > 0 && !selectedWorkbookId) {
        setSelectedWorkbookId(activeList[0].id)
      }

      // Fetch module fields for each workbook
      for (const wb of wbList) {
        await fetchModuleFields(wb.id)
      }

      setLoading(false)
    })
    return unsub
  }, [user])

  // ── Fetch sessions ──
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

      // Count pending approvals
      let pendingCount = 0
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

  // ── Fetch module fields for a workbook ──
  const fetchModuleFields = async (workbookId) => {
    try {
      const modulesQuery = query(
        collection(db, 'workbooks', workbookId, 'WBmodules'),
        orderBy('moduleNumber')
      )
      const modulesSnap = await getDocs(modulesQuery)

      const moduleMap = {}
      modulesSnap.docs.forEach(doc => {
        const data = doc.data()
        // Skip cover pages
        if (!data.isCover) {
          moduleMap[data.moduleNumber] = {
            title: data.title || `Module ${data.moduleNumber}`,
            fieldIds: data.fieldIds || [],
            isCover: data.isCover || false
          }
        }
      })

      setModuleFields(prev => ({ ...prev, [workbookId]: moduleMap }))
    } catch (err) {
      console.error('Error fetching module fields:', err)
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

  // ── Get students for a workbook with their module statuses ──
  const getWorkbookStudents = (workbookId) => {
    const workbookSessions = sessions.filter(s => s.workbookId === workbookId)
    const moduleNumbers = Object.keys(moduleFields[workbookId] || {}).map(Number).sort((a, b) => a - b)
    const totalModules = moduleNumbers.length || 1

    return workbookSessions.map(session => {
      const statuses = session.moduleStatus || {}
      const moduleProgress = session.moduleProgress || {}

      let approved = 0
      let revoked = 0
      let pending = 0
      let completed = 0

      moduleNumbers.forEach(moduleNum => {
        const status = statuses[moduleNum]?.status || 'not_started'
        const progress = moduleProgress[moduleNum] || 0

        if (status === 'approved') approved++
        if (status === 'revoked') revoked++
        if (status === 'pending') pending++
        if (progress === 100) completed++
      })

      return {
        sessionId: session.id,
        studentName: session.studentName || 'Unknown Student',
        studentUid: session.studentUid,
        totalModules,
        approved,
        revoked,
        pending,
        completed,
        isComplete: completed === totalModules && totalModules > 0,
        lastActive: session.lastActive,
        isActive: isSessionActive(session),
        downloadCount: session.downloadCount || 0,
        downloadLimit: session.downloadLimit || 3,
        createdAt: session.createdAt
      }
    })
  }

  // ── Get pending count for a workbook ──
  const getPendingCount = (workbookId) => {
    const workbookSessions = sessions.filter(s => s.workbookId === workbookId)
    let count = 0
    workbookSessions.forEach(session => {
      if (session.moduleStatus) {
        Object.values(session.moduleStatus).forEach(status => {
          if (status.status === 'pending') count++
        })
      }
    })
    return count
  }

  // ── Get active session count for a workbook ──
  const getActiveCount = (workbookId) => {
    const workbookSessions = sessions.filter(s => s.workbookId === workbookId)
    return workbookSessions.filter(s => isSessionActive(s)).length
  }

  // ── Handle tab click ──
  const handleTabClick = (workbookId) => {
    setSelectedWorkbookId(workbookId)
    // Scroll to top of content
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Scroll tabs horizontally ──
  const scrollTabs = (direction) => {
    if (tabsContainerRef.current) {
      const scrollAmount = 200
      const newScrollLeft = tabsContainerRef.current.scrollLeft + (direction === 'left' ? -scrollAmount : scrollAmount)
      tabsContainerRef.current.scrollTo({ left: newScrollLeft, behavior: 'smooth' })
    }
  }

  // ── Soft delete: hide from students, keep for lecturer with Undo ──
  const handleDeleteWorkbook = async (workbookId) => {
    try {
      const wbRef = doc(db, 'workbooks', workbookId)
      await updateDoc(wbRef, {
        isDeleted: true,
        deletedAt: serverTimestamp()
      })
      // If the deleted workbook was selected, fall back to the next active one
      if (selectedWorkbookId === workbookId) {
        const next = workbooks.find(wb => wb.id !== workbookId && !wb.isDeleted)
        setSelectedWorkbookId(next ? next.id : null)
      }
    } catch (err) {
      console.error('Error deleting workbook:', err)
    }
  }

  // ── Undo soft delete ──
  const handleUndoDelete = async (workbookId) => {
    try {
      const wbRef = doc(db, 'workbooks', workbookId)
      await updateDoc(wbRef, {
        isDeleted: false,
        deletedAt: null
      })
    } catch (err) {
      console.error('Error restoring workbook:', err)
    }
  }

  // ── Permanently delete: removes workbook + its modules subcollection from Firestore ──
  const handlePermanentDelete = async (workbookId) => {
    setDeletingId(workbookId)
    try {
      // Delete WBmodules subcollection docs first (Firestore doesn't cascade delete)
      const modulesSnap = await getDocs(collection(db, 'workbooks', workbookId, 'WBmodules'))
      await Promise.all(modulesSnap.docs.map(d => deleteDoc(d.ref)))

      // Delete the workbook doc itself
      await deleteDoc(doc(db, 'workbooks', workbookId))

      // Clean up local state
      setModuleFields(prev => {
        const next = { ...prev }
        delete next[workbookId]
        return next
      })
      if (selectedWorkbookId === workbookId) {
        const next = workbooks.find(wb => wb.id !== workbookId && !wb.isDeleted)
        setSelectedWorkbookId(next ? next.id : null)
      }
      setConfirmPermanentDeleteId(null)
    } catch (err) {
      console.error('Error permanently deleting workbook:', err)
    } finally {
      setDeletingId(null)
    }
  }

  // ── Derived: workbooks visible in normal dashboard view (excludes soft-deleted) ──
  const activeWorkbooks = workbooks.filter(wb => !wb.isDeleted)

  // ── Get selected workbook ──
  const selectedWorkbook = activeWorkbooks.find(wb => wb.id === selectedWorkbookId)
  const selectedStudents = selectedWorkbookId ? getWorkbookStudents(selectedWorkbookId) : []
  const totalModules = selectedWorkbookId ?
    Object.keys(moduleFields[selectedWorkbookId] || {}).length :
    0

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
          <div
            className="stat-card card clickable"
            onClick={() => setShowWorkbooksModal(true)}
            style={{ cursor: 'pointer' }}
            title="Click to manage workbooks"
          >
            <div className="stat-num">{activeWorkbooks.length}</div>
            <div className="stat-label">Workbooks</div>
          </div>
          <div className="stat-card card">
            <div className="stat-num">{sessions.length}</div>
            <div className="stat-label">Total Students</div>
          </div>
          <div className="stat-card card">
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

        {/* ── WORKBOOK MANAGEMENT MODAL ── */}
        {showWorkbooksModal && (
          <div className="modal-overlay" onClick={() => setShowWorkbooksModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>📚 Manage Workbooks</h3>
              </div>
              <div className="modal-body">
                {workbooks.length === 0 ? (
                  <p>No workbooks yet.</p>
                ) : (
                  <ul className="workbook-manage-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {workbooks.map(wb => (
                      <li
                        key={wb.id}
                        className="workbook-manage-item"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px 0',
                          borderBottom: '1px solid #eee',
                          opacity: wb.isDeleted ? 0.6 : 1,
                          gap: '12px'
                        }}
                      >
                        <div>
                          <div>{wb.title}</div>
                          {wb.isDeleted && (
                            <div style={{ fontSize: '0.8em', color: '#c0392b', marginTop: 2 }}>
                              🗑️ Deleted — hidden from students
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                          {wb.isDeleted ? (
                            <>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleUndoDelete(wb.id)}
                                disabled={deletingId === wb.id}
                              >
                                ↩️ Undo
                              </button>

                              {confirmPermanentDeleteId === wb.id ? (
                                <>
                                  <span style={{ fontSize: '0.8em', color: '#c0392b' }}>Sure?</span>
                                  <button
                                    className="btn btn-danger btn-sm"
                                    onClick={() => handlePermanentDelete(wb.id)}
                                    disabled={deletingId === wb.id}
                                  >
                                    {deletingId === wb.id ? 'Deleting...' : 'Yes, delete forever'}
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setConfirmPermanentDeleteId(null)}
                                    disabled={deletingId === wb.id}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={() => setConfirmPermanentDeleteId(wb.id)}
                                  disabled={deletingId === wb.id}
                                >
                                  🗑️ Delete Permanently
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleDeleteWorkbook(wb.id)}
                            >
                              🗑️ Delete
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="modal-actions" style={{ marginTop: 16 }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowWorkbooksModal(false)
                    setConfirmPermanentDeleteId(null)
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── WORKBOOK TABS ── */}
        <section className="dash-section">
          <div className="tabs-header">
            <h2 className="section-title">📚 Workbooks</h2>
            {activeWorkbooks.length > 0 && (
              <div className="tabs-actions">
                <button
                  className="tab-scroll-btn"
                  onClick={() => scrollTabs('left')}
                  aria-label="Scroll tabs left"
                >
                  ◀
                </button>
                <button
                  className="tab-scroll-btn"
                  onClick={() => scrollTabs('right')}
                  aria-label="Scroll tabs right"
                >
                  ▶
                </button>
              </div>
            )}
          </div>

          {loading && <div className="page-loader"><span className="spinner" /></div>}

          {!loading && activeWorkbooks.length === 0 && (
            <div className="empty-sessions card">
              <div className="empty-icon">📚</div>
              <h3>No workbooks yet</h3>
              <p>Upload your first workbook to get started.</p>
              <Link to="/lecturer/upload" className="btn btn-primary" style={{marginTop:16}}>
                Upload Workbook
              </Link>
            </div>
          )}

          {!loading && activeWorkbooks.length > 0 && (
            <>
              {/* Horizontal Scrollable Tabs */}
              <div className="tabs-wrapper">
                <div className="tabs-container" ref={tabsContainerRef}>
                  {activeWorkbooks.map(wb => {
                    const pendingCount = getPendingCount(wb.id)
                    const activeCount = getActiveCount(wb.id)
                    const isSelected = selectedWorkbookId === wb.id

                    return (
                      <button
                        key={wb.id}
                        className={`tab-btn ${isSelected ? 'active' : ''}`}
                        onClick={() => handleTabClick(wb.id)}
                      >
                        <div className="tab-content">
                          <span className="tab-title">{wb.title}</span>
                          <div className="tab-badges">
                            {activeCount > 0 && (
                              <span className="tab-badge active" title="Active sessions">
                                🟢 {activeCount}
                              </span>
                            )}
                            {pendingCount > 0 && (
                              <span className="tab-badge pending" title="Pending approvals">
                                ⏳ {pendingCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Students Table */}
              {selectedWorkbook && (
                <div className="students-table-container card">
                  <div className="table-header">
                    <div className="table-title">
                      <h3>{selectedWorkbook.title}</h3>
                      <span className="student-count">{selectedStudents.length} student{selectedStudents.length !== 1 ? 's' : ''}</span>
                      <span className="module-count-badge">📚 {totalModules} modules</span>
                    </div>
                    <div className="table-actions">
                      <span className="table-info">
                        🟢 {selectedStudents.filter(s => s.isActive).length} active
                      </span>
                    </div>
                  </div>

                  {selectedStudents.length === 0 ? (
                    <div className="empty-students">
                      <p>No students have started this workbook yet.</p>
                    </div>
                  ) : (
                    <div className="table-scroll-wrapper">
                      <table className="students-table">
                        <thead>
                          <tr>
                            <th className="student-name-col">Student</th>
                            <th className="status-col">Complete</th>
                            <th className="status-col">Approved</th>
                            <th className="status-col">Pending</th>
                            <th className="status-col">Revoked</th>
                            <th className="actions-col">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedStudents.map(student => (
                            <tr key={student.sessionId} className={student.isActive ? 'active-row' : ''}>
                              <td className="student-name-cell">
                                <div className="student-info">
                                  <span className="student-name">{student.studentName}</span>
                                  {student.isActive && (
                                    <span className="live-indicator" title={`Active ${getLastActiveString({lastActive: student.lastActive})}`}>
                                      🟢
                                    </span>
                                  )}
                                  {student.isComplete && (
                                    <span className="complete-badge" title="All modules completed">
                                      ✅
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="status-cell summary-cell">
                                {student.isComplete ? (
                                  <span className="badge-complete">Complete</span>
                                ) : (
                                  <span className="badge-incomplete">Incomplete</span>
                                )}
                              </td>
                              <td className="status-cell summary-cell">
                                <span className="status-summary approved">
                                  {student.approved}/{student.totalModules}
                                </span>
                              </td>
                              <td className="status-cell summary-cell">
                                <span className="status-summary pending">
                                  {student.pending}/{student.totalModules}
                                </span>
                              </td>
                              <td className="status-cell summary-cell">
                                <span className="status-summary revoked">
                                  {student.revoked}/{student.totalModules}
                                </span>
                              </td>
                              <td className="actions-cell">
                                <Link
                                  to={`/lecturer/watch/${student.sessionId}`}
                                  className="btn btn-primary btn-sm"
                                >
                                  View
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>

      </div>
    </div>
  )
}