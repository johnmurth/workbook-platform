// src/pages/UploadWorkbook.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import Navbar from '../components/shared/Navbar'
import './UploadWorkbook.css'

export default function UploadWorkbook() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [downloadLimit, setDownloadLimit] = useState(3)
  const [file, setFile] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const handleFileChange = (e) => {
    const selected = e.target.files[0]
    if (!selected) return
    
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
                          'application/vnd.ms-powerpoint', 'image/jpeg', 'image/png']
    if (!allowedTypes.includes(selected.type)) {
      setError('Only PDF, DOCX, PPTX, JPG, and PNG files are allowed')
      setFile(null)
      return
    }
    
    // Validate file size (max 50MB)
    if (selected.size > 50 * 1024 * 1024) {
      setError('File size must be less than 50MB')
      setFile(null)
      return
    }
    
    setFile(selected)
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!file) {
      setError('Please select a file to upload')
      return
    }
    if (!title.trim()) {
      setError('Please enter a title')
      return
    }
    if (!price || parseFloat(price) <= 0) {
      setError('Please enter a valid price')
      return
    }

    setUploading(true)
    setError('')
    setUploadProgress(0)

    try {
      // 1. Upload file to Firebase Storage
      const fileExtension = file.name.split('.').pop()
      const fileName = `${Date.now()}_${user.uid}.${fileExtension}`
      const storageRef = ref(storage, `workbooks/${user.uid}/${fileName}`)
      const uploadTask = uploadBytesResumable(storageRef, file)

      // Track upload progress
      const downloadURL = await new Promise((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            setUploadProgress(progress)
          },
          (err) => reject(err),
          async () => {
            const url = await getDownloadURL(uploadTask.snapshot.ref)
            resolve(url)
          }
        )
      })

      // 2. Save workbook metadata to Firestore
      const workbookData = {
        title: title.trim(),
        description: description.trim(),
        price: parseFloat(price),
        downloadLimit: parseInt(downloadLimit),
        fileUrl: downloadURL,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        lecturerUid: user.uid,
        lecturerName: profile?.name || 'Unknown Lecturer',
        createdAt: serverTimestamp(),
        totalPurchases: 0,
        active: true
      }

      await addDoc(collection(db, 'workbooks'), workbookData)
      
      // Redirect to lecturer dashboard
      navigate('/lecturer')
    } catch (err) {
      console.error('Upload error:', err)
      setError('Upload failed. Please try again.')
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  return (
    <div>
      <Navbar />
      <div className="upload-page">
        <div className="container">
          <div className="upload-header">
            <h1>Upload Workbook</h1>
            <p>Share your educational content with students</p>
          </div>

          <div className="upload-card card">
            <form onSubmit={handleSubmit}>
              {error && <div className="error-msg">{error}</div>}

              <div className="form-group">
                <label>Workbook Title *</label>
                <input 
                  type="text" 
                  className="form-control"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Advanced Mathematics Workbook"
                  required
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea 
                  className="form-control"
                  rows="4"
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
                    placeholder="e.g., 500"
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
                    max="10"
                  />
                  <small>Maximum number of times a student can download their completed work</small>
                </div>
              </div>

              <div className="form-group">
                <label>Upload File *</label>
                <div className="file-upload-area">
                  <input 
                    type="file" 
                    id="fileInput"
                    className="file-input"
                    onChange={handleFileChange}
                    accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
                  />
                  <label htmlFor="fileInput" className="file-label">
                    {file ? (
                      <span className="file-selected">📄 {file.name}</span>
                    ) : (
                      <span className="file-placeholder">
                        📁 Click or drag to upload (PDF, DOCX, PPTX, JPG, PNG)
                      </span>
                    )}
                  </label>
                </div>
                <small>Maximum file size: 50MB</small>
              </div>

              {uploading && (
                <div className="progress-container">
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <span className="progress-text">{Math.round(uploadProgress)}% uploaded</span>
                </div>
              )}

              <div className="form-actions">
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={uploading}
                >
                  {uploading ? 'Uploading...' : '📤 Upload Workbook'}
                </button>
                <button 
                  type="button" 
                  className="btn btn-secondary"
                  onClick={() => navigate('/lecturer')}
                  disabled={uploading}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>

          <div className="upload-tips">
            <h4>📌 Tips for best results:</h4>
            <ul>
              <li>Use clear, descriptive titles for easy searching</li>
              <li>PDF files work best for consistent formatting</li>
              <li>Set reasonable prices based on content value</li>
              <li>Download limits prevent sharing of completed work</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}