// src/pages/EditWorkbook.jsx
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { ref, deleteObject } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import Navbar from '../components/shared/Navbar'
import './EditWorkbook.css'

export default function EditWorkbook() {
  const { workbookId } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  
  const [workbook, setWorkbook] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  
  // Form fields
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [downloadLimit, setDownloadLimit] = useState(3)
  const [active, setActive] = useState(true)

  useEffect(() => {
    const fetchWorkbook = async () => {
      try {
        const docRef = doc(db, 'workbooks', workbookId)
        const docSnap = await getDoc(docRef)
        
        if (!docSnap.exists()) {
          setError('Workbook not found')
          setLoading(false)
          return
        }
        
        const data = { id: docSnap.id, ...docSnap.data() }
        
        // Verify ownership
        if (data.lecturerUid !== user.uid) {
          setError('You do not have permission to edit this workbook')
          setLoading(false)
          return
        }
        
        setWorkbook(data)
        setTitle(data.title || '')
        setDescription(data.description || '')
        setPrice(data.price?.toString() || '')
        setDownloadLimit(data.downloadLimit || 3)
        setActive(data.active !== false)
        
      } catch (err) {
        console.error('Error fetching workbook:', err)
        setError('Failed to load workbook')
      } finally {
        setLoading(false)
      }
    }
    
    fetchWorkbook()
  }, [workbookId, user])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    
    try {
      const workbookRef = doc(db, 'workbooks', workbookId)
      const updates = {
        title: title.trim(),
        description: description.trim(),
        price: parseFloat(price),
        downloadLimit: parseInt(downloadLimit),
        active: active,
        updatedAt: new Date()
      }
      
      await updateDoc(workbookRef, updates)
      setSuccess('Workbook updated successfully!')
      
      // Update local state
      setWorkbook({ ...workbook, ...updates })
      
      // Redirect after 2 seconds
      setTimeout(() => {
        navigate('/lecturer')
      }, 1500)
      
    } catch (err) {
      console.error('Error updating workbook:', err)
      setError('Failed to update workbook. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setSaving(true)
    setError('')
    
    try {
      // Delete from Firestore
      const workbookRef = doc(db, 'workbooks', workbookId)
      await deleteDoc(workbookRef)
      
      // Delete file from Storage (optional - may want to keep for existing purchases)
      if (workbook.fileUrl) {
        try {
          const fileRef = ref(storage, workbook.fileUrl)
          await deleteObject(fileRef)
        } catch (storageErr) {
          console.warn('Could not delete storage file:', storageErr)
        }
      }
      
      setSuccess('Workbook deleted successfully!')
      setTimeout(() => {
        navigate('/lecturer')
      }, 1500)
      
    } catch (err) {
      console.error('Error deleting workbook:', err)
      setError('Failed to delete workbook. Please try again.')
      setSaving(false)
    }
  }

  const getPurchaseStats = () => {
    return {
      total: workbook?.totalPurchases || 0,
      revenue: (workbook?.totalPurchases || 0) * (workbook?.price || 0)
    }
  }

  if (loading) {
    return (
      <div>
        <Navbar />
        <div className="page-loader">
          <span className="spinner" /> Loading workbook...
        </div>
      </div>
    )
  }

  if (error && !workbook) {
    return (
      <div>
        <Navbar />
        <div className="edit-workbook-page">
          <div className="container">
            <div className="error-msg">{error}</div>
            <button onClick={() => navigate('/lecturer')} className="btn btn-primary">
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  const stats = getPurchaseStats()

  return (
    <div>
      <Navbar />
      <div className="edit-workbook-page">
        <div className="container">
          <div className="edit-header">
            <div>
              <h1>Edit Workbook</h1>
              <p>Update your workbook information and settings</p>
            </div>
            <button onClick={() => navigate('/lecturer')} className="btn btn-secondary">
              ← Back to Dashboard
            </button>
          </div>

          {error && <div className="error-msg">{error}</div>}
          {success && <div className="success-msg">{success}</div>}

          <div className="edit-layout">
            {/* Main Form */}
            <div className="edit-form card">
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>Workbook Title *</label>
                  <input 
                    type="text" 
                    className="form-control"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea 
                    className="form-control"
                    rows="5"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe what students will learn..."
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Price (KES) *</label>
                    <input 
                      type="number" 
                      className="form-control"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      min="0"
                      step="10"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Download Limit per Student</label>
                    <input 
                      type="number" 
                      className="form-control"
                      value={downloadLimit}
                      onChange={(e) => setDownloadLimit(e.target.value)}
                      min="1"
                      max="20"
                    />
                    <small>Maximum times a student can download completed work</small>
                  </div>
                </div>

                <div className="form-group">
                  <label className="checkbox-label">
                    <input 
                      type="checkbox" 
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                    />
                    <span>Active (visible in store)</span>
                  </label>
                  <small>Inactive workbooks won't appear in the store for new purchases</small>
                </div>

                <div className="form-actions">
                  <button 
                    type="submit" 
                    className="btn btn-primary"
                    disabled={saving}
                  >
                    {saving ? <><span className="spinner" /> Saving...</> : '💾 Save Changes'}
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-danger"
                    onClick={() => setShowDeleteModal(true)}
                    disabled={saving}
                  >
                    🗑️ Delete Workbook
                  </button>
                </div>
              </form>
            </div>

            {/* Stats Sidebar */}
            <div className="edit-sidebar">
              <div className="stats-card card">
                <h3>📊 Performance Stats</h3>
                <div className="stat-item">
                  <span>Total Purchases:</span>
                  <strong>{stats.total}</strong>
                </div>
                <div className="stat-item">
                  <span>Total Revenue:</span>
                  <strong>KES {stats.revenue.toLocaleString()}</strong>
                </div>
              </div>

              <div className="info-card card">
                <h3>📁 File Info</h3>
                <div className="file-info">
                  <span className="file-icon">📄</span>
                  <div>
                    <div className="file-name">{workbook?.fileName || 'Unknown'}</div>
                    <div className="file-size">
                      {(workbook?.fileSize / 1024).toFixed(1)} KB
                    </div>
                  </div>
                </div>
                <a 
                  href={workbook?.fileUrl} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="btn btn-secondary btn-sm"
                  style={{ width: '100%', marginTop: '12px' }}
                >
                  📂 View Original File
                </a>
              </div>

              <div className="tips-card card">
                <h3>💡 Tips for Success</h3>
                <ul>
                  <li>Clear titles help students find your workbooks</li>
                  <li>Detailed descriptions increase purchases</li>
                  <li>Reasonable pricing attracts more students</li>
                  <li>Keep download limits reasonable (3-5 is typical)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete Workbook</h3>
              <button className="modal-close" onClick={() => setShowDeleteModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="warning-icon">⚠️</div>
              <p>Are you sure you want to delete <strong>{workbook?.title}</strong>?</p>
              <p className="warning-text">This action cannot be undone. All purchase records will remain but the workbook will be inaccessible.</p>
              <div className="modal-actions">
                <button onClick={handleDelete} className="btn btn-danger" disabled={saving}>
                  {saving ? 'Deleting...' : 'Yes, Delete Workbook'}
                </button>
                <button onClick={() => setShowDeleteModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}