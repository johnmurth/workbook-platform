// src/pages/EditWorkbook.jsx
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore'
import { ref, deleteObject, uploadBytesResumable, uploadString, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import { processDocumentIntoModules } from '../lib/documentProcessor'
import Navbar from '../components/shared/Navbar'
import './EditWorkbook.css'

// Firestore batched writes max out at 500 operations per batch
const BATCH_LIMIT = 450

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

  // Module fields (existing/display only)
  const [moduleCount, setModuleCount] = useState(0)
  const [moduleTitles, setModuleTitles] = useState([])

  // ── NEW: Update Workbook Content state ──
  const [updateFile, setUpdateFile] = useState(null)
  const [updateFileError, setUpdateFileError] = useState('')
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateStage, setUpdateStage] = useState('') // human-readable progress text
  const [updateUploadProgress, setUpdateUploadProgress] = useState(0)
  const [affectedSessionCount, setAffectedSessionCount] = useState(null) // fetched when modal opens
  const [updateSuccess, setUpdateSuccess] = useState('')
  const [updateError, setUpdateError] = useState('')

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

        setModuleCount(data.totalModules || 0)
        setModuleTitles(data.moduleTitles || [])

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

      setWorkbook({ ...workbook, ...updates })

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
      const workbookRef = doc(db, 'workbooks', workbookId)
      await deleteDoc(workbookRef)

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

  // ============================================================
  // NEW: UPDATE WORKBOOK CONTENT
  // ============================================================

  const ALLOWED_UPDATE_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'image/jpeg',
    'image/png'
  ]

  const handleUpdateFileChange = (e) => {
    const selected = e.target.files[0]
    if (!selected) return

    if (!ALLOWED_UPDATE_TYPES.includes(selected.type)) {
      setUpdateFileError('Only PDF, DOCX, PPTX, JPG, and PNG files are allowed')
      setUpdateFile(null)
      return
    }

    if (selected.size > 50 * 1024 * 1024) {
      setUpdateFileError('File size must be less than 50MB')
      setUpdateFile(null)
      return
    }

    setUpdateFile(selected)
    setUpdateFileError('')
    setUpdateSuccess('')
    setUpdateError('')
  }

  // Count how many student sessions will be reset, before showing the
  // confirmation modal, so the lecturer knows the blast radius.
  const openUpdateModal = async () => {
    if (!updateFile) {
      setUpdateFileError('Please select a replacement file first')
      return
    }
    setUpdateFileError('')
    try {
      const sessionsQuery = query(
        collection(db, 'WBsessions'),
        where('workbookId', '==', workbookId)
      )
      const sessionsSnap = await getDocs(sessionsQuery)
      setAffectedSessionCount(sessionsSnap.size)
    } catch (err) {
      console.error('Error counting sessions:', err)
      setAffectedSessionCount(null) // unknown — modal will say so
    }
    setShowUpdateModal(true)
  }

  // Reset every existing student session for this workbook back to a
  // fresh start on the new content, in batches of BATCH_LIMIT.
  const resetAllSessionsForWorkbook = async () => {
    const sessionsQuery = query(
      collection(db, 'WBsessions'),
      where('workbookId', '==', workbookId)
    )
    const sessionsSnap = await getDocs(sessionsQuery)
    const docs = sessionsSnap.docs

    for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
      const chunk = docs.slice(i, i + BATCH_LIMIT)
      const batch = writeBatch(db)
      chunk.forEach(sessionDoc => {
        batch.update(sessionDoc.ref, {
          answers: {},
          moduleProgress: {},
          moduleStatus: {},
          currentModule: null,
          workbookVersion: (workbook?.version || 1) + 1,
          lastActive: new Date()
          // downloadCount / downloadLimit intentionally left untouched
        })
      })
      await batch.commit()
    }

    return docs.length
  }

  const handleConfirmUpdate = async () => {
    if (!updateFile) return

    setUpdating(true)
    setUpdateError('')
    setUpdateSuccess('')
    setUpdateUploadProgress(0)

    try {
      // 1. Reprocess the new document into modules
      setUpdateStage('Processing document for modules...')
      const arrayBuffer = await updateFile.arrayBuffer()
      const { modules, totalModules, allFieldIds } = await processDocumentIntoModules(arrayBuffer)

      // 2. Upload the new source file to Storage
      setUpdateStage('Uploading new file...')
      const fileExtension = updateFile.name.split('.').pop()
      const fileName = `${Date.now()}_${user.uid}.${fileExtension}`
      const storageRef = ref(storage, `workbooks/${user.uid}/${fileName}`)
      const uploadTask = uploadBytesResumable(storageRef, updateFile)

      const downloadURL = await new Promise((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            setUpdateUploadProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          },
          (err) => reject(err),
          async () => {
            const url = await getDownloadURL(uploadTask.snapshot.ref)
            resolve(url)
          }
        )
      })

      // 3. Upload each module's HTML content to Storage
      setUpdateStage('Uploading module content...')
      const moduleUrls = []
      for (const module of modules) {
        const moduleFileName = `module_${module.number}_${Date.now()}.html`
        const moduleStorageRef = ref(
          storage,
          `workbooks/${user.uid}/${workbookId}/${moduleFileName}`
        )
        await uploadString(moduleStorageRef, module.content || '', 'raw', {
          contentType: 'text/html'
        })
        const moduleUrl = await getDownloadURL(moduleStorageRef)
        moduleUrls.push({ moduleNumber: module.number, url: moduleUrl })
      }

      // 4. Delete the OLD WBmodules subcollection docs
      setUpdateStage('Removing old module data...')
      const oldModulesSnap = await getDocs(collection(db, 'workbooks', workbookId, 'WBmodules'))
      if (oldModulesSnap.docs.length > 0) {
        const deleteBatch = writeBatch(db)
        oldModulesSnap.docs.forEach(d => deleteBatch.delete(d.ref))
        await deleteBatch.commit()
      }

      // Best-effort: delete old module HTML files from Storage (non-fatal)
      for (const oldModule of oldModulesSnap.docs) {
        const oldUrl = oldModule.data()?.contentUrl
        if (!oldUrl) continue
        try {
          await deleteObject(ref(storage, oldUrl))
        } catch (storageErr) {
          console.warn('Could not delete old module file:', storageErr)
        }
      }

      // Best-effort: delete the old source file from Storage (non-fatal)
      if (workbook?.fileUrl) {
        try {
          await deleteObject(ref(storage, workbook.fileUrl))
        } catch (storageErr) {
          console.warn('Could not delete old source file:', storageErr)
        }
      }

      // 5. Write the NEW WBmodules docs
      setUpdateStage('Saving new module data...')
      const writeModulesBatch = writeBatch(db)
      modules.forEach((module, index) => {
        const moduleRef = doc(collection(db, 'workbooks', workbookId, 'WBmodules'))
        const moduleUrlData = moduleUrls.find(m => m.moduleNumber === module.number)
        writeModulesBatch.set(moduleRef, {
          workbookId: workbookId,
          moduleNumber: module.number,
          moduleIndex: index,
          title: module.title,
          contentUrl: moduleUrlData?.url || '',
          fieldIds: module.fieldIds || [],
          totalFields: module.totalFields || module.fieldIds?.length || 0,
          isCover: module.isCover || false,
          createdAt: serverTimestamp()
        })
      })
      await writeModulesBatch.commit()

      // 6. Update the workbook doc's file/module metadata
      setUpdateStage('Updating workbook record...')
      const workbookRef = doc(db, 'workbooks', workbookId)
      const workbookUpdates = {
        fileUrl: downloadURL,
        fileName: updateFile.name,
        fileType: updateFile.type,
        fileSize: updateFile.size,
        totalModules: totalModules,
        moduleCount: totalModules,
        moduleTitles: modules.map(m => m.title),
        moduleFieldCounts: modules.map(m => m.totalFields),
        allFieldIds: allFieldIds,
        version: (workbook?.version || 1) + 1,
        updatedAt: new Date()
      }
      await updateDoc(workbookRef, workbookUpdates)

      // 7. Reset every existing student session on this workbook
      setUpdateStage('Resetting student progress...')
      const resetCount = await resetAllSessionsForWorkbook()

      // Update local state
      setWorkbook(prev => ({ ...prev, ...workbookUpdates }))
      setModuleCount(totalModules)
      setModuleTitles(modules.map(m => m.title))

      setUpdateSuccess(
        `Workbook updated! ${totalModules} module${totalModules !== 1 ? 's' : ''} processed. ` +
        `${resetCount} student session${resetCount !== 1 ? 's' : ''} reset to start fresh on the new content.`
      )
      setShowUpdateModal(false)
      setUpdateFile(null)

    } catch (err) {
      console.error('Error updating workbook content:', err)
      setUpdateError('Failed to update workbook content: ' + err.message)
    } finally {
      setUpdating(false)
      setUpdateStage('')
      setUpdateUploadProgress(0)
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

            {/* ── NEW: Update Workbook Content card ── */}
            <div className="edit-form card" style={{ marginTop: 24 }}>
              <h3>🔄 Update Workbook Content</h3>
              <p style={{ fontSize: '0.9em', color: 'var(--ink-muted, #666)', marginTop: 4 }}>
                Replace this workbook's source file with a corrected version. Students who already
                purchased keep their access — <strong>no repurchase needed</strong> — but this
                re-processes the document from scratch, so <strong>all student progress on this
                workbook will be reset</strong> (answers, submissions, and approvals). Currently:{' '}
                <strong>{moduleCount} module{moduleCount !== 1 ? 's' : ''}</strong>
                {moduleTitles.length > 0 && (
                  <> — {moduleTitles.join(', ')}</>
                )}.
              </p>

              {updateError && <div className="error-msg" style={{ marginTop: 12 }}>{updateError}</div>}
              {updateSuccess && <div className="success-msg" style={{ marginTop: 12 }}>{updateSuccess}</div>}

              <div className="form-group" style={{ marginTop: 12 }}>
                <label>Replacement File *</label>
                <div className="file-upload-area">
                  <input
                    type="file"
                    id="updateFileInput"
                    className="file-input"
                    onChange={handleUpdateFileChange}
                    accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
                  />
                  <label htmlFor="updateFileInput" className="file-label">
                    {updateFile ? (
                      <span className="file-selected">📄 {updateFile.name}</span>
                    ) : (
                      <span className="file-placeholder">
                        📁 Click or drag to upload corrected file (PDF, DOCX, PPTX, JPG, PNG)
                      </span>
                    )}
                  </label>
                </div>
                {updateFileError && <div className="error-msg" style={{ marginTop: 8 }}>{updateFileError}</div>}
                <small>Maximum file size: 50MB</small>
              </div>

              {updating && (
                <div className="progress-container" style={{ marginTop: 12 }}>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${updateUploadProgress}%` }}
                    />
                  </div>
                  <span className="progress-text">{updateStage || 'Working...'}</span>
                </div>
              )}

              <div className="form-actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={openUpdateModal}
                  disabled={updating || !updateFile}
                >
                  {updating ? <><span className="spinner" /> Updating...</> : '🔄 Update Workbook Content'}
                </button>
              </div>
            </div>

            {/* Stats Sidebar */}
            <div className="edit-sidebar">
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

      {/* ── NEW: Update Confirmation Modal ── */}
      {showUpdateModal && (
        <div className="modal-overlay" onClick={() => !updating && setShowUpdateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🔄 Update Workbook Content</h3>
              <button className="modal-close" onClick={() => setShowUpdateModal(false)} disabled={updating}>×</button>
            </div>
            <div className="modal-body">
              <div className="warning-icon">⚠️</div>
              <p>
                Replacing <strong>{workbook?.title}</strong>'s content with{' '}
                <strong>{updateFile?.name}</strong>.
              </p>
              <p className="warning-text">
                {affectedSessionCount === null
                  ? "Could not confirm how many student sessions exist — proceed with caution."
                  : affectedSessionCount === 0
                    ? "No students have started this workbook yet, so nothing will be reset."
                    : `This will reset ALL progress for ${affectedSessionCount} existing student session${affectedSessionCount !== 1 ? 's' : ''} on this workbook — including any approved or pending module submissions. Students keep their access (no repurchase), but they will restart from the beginning on the corrected content.`}
              </p>
              <p className="warning-text">This action cannot be undone.</p>
              <div className="modal-actions">
                <button onClick={handleConfirmUpdate} className="btn btn-danger" disabled={updating}>
                  {updating ? 'Updating...' : 'Yes, Update & Reset Progress'}
                </button>
                <button onClick={() => setShowUpdateModal(false)} className="btn btn-secondary" disabled={updating}>
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