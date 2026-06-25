// src/pages/UploadWorkbook.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, addDoc, serverTimestamp, doc, writeBatch } from 'firebase/firestore'
import { ref, uploadBytesResumable, getDownloadURL, uploadString } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import { processDocumentIntoModules } from '../lib/documentProcessor'
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
  const [processingDoc, setProcessingDoc] = useState(false)
  const [moduleCount, setModuleCount] = useState(0)

  const handleFileChange = (e) => {
    const selected = e.target.files[0]
    if (!selected) return
    
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
                          'application/vnd.ms-powerpoint', 'image/jpeg', 'image/png']
    if (!allowedTypes.includes(selected.type)) {
      setError('Only PDF, DOCX, PPTX, JPG, and PNG files are allowed')
      setFile(null)
      return
    }
    
    if (selected.size > 50 * 1024 * 1024) {
      setError('File size must be less than 50MB')
      setFile(null)
      return
    }
    
    setFile(selected)
    setError('')
    setModuleCount(0)
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
    setProcessingDoc(true)

    try {
      // 1. Read file and process for modules
      const arrayBuffer = await file.arrayBuffer()
      console.log('📄 Processing document for modules...')
      
      const { modules, totalModules, allFieldIds } = await processDocumentIntoModules(arrayBuffer)
      console.log(`📚 Found ${totalModules} modules with ${allFieldIds.length} total fields`)
      
      setModuleCount(totalModules)
      
      // 2. Upload original file to Firebase Storage
      const fileExtension = file.name.split('.').pop()
      const fileName = `${Date.now()}_${user.uid}.${fileExtension}`
      const storageRef = ref(storage, `workbooks/${user.uid}/${fileName}`)
      const uploadTask = uploadBytesResumable(storageRef, file)

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

      // 3. Create workbook document with module metadata
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
        active: true,
        totalModules: totalModules,
        moduleCount: totalModules,
        moduleTitles: modules.map(m => m.title),
        moduleFieldCounts: modules.map(m => m.totalFields),
        allFieldIds: allFieldIds
      }

      const workbookRef = await addDoc(collection(db, 'workbooks'), workbookData)
      console.log('✅ Workbook created:', workbookRef.id)

      // ──────────────────────────────────────────────────────────────
      // 4. Upload each module's HTML content to Firebase Storage
      // ──────────────────────────────────────────────────────────────
      console.log('📤 Uploading module content to Storage...')
      
      const moduleUrls = []
      let moduleUploadCount = 0

      for (const module of modules) {
        const moduleFileName = `module_${module.number}_${Date.now()}.html`
        const moduleStorageRef = ref(
          storage, 
          `workbooks/${user.uid}/${workbookRef.id}/${moduleFileName}`
        )
        
        // Upload HTML string to Storage
        await uploadString(moduleStorageRef, module.content || '', 'raw', {
          contentType: 'text/html'
        })
        
        const moduleUrl = await getDownloadURL(moduleStorageRef)
        moduleUrls.push({
          moduleNumber: module.number,
          url: moduleUrl
        })
        
        moduleUploadCount++
        console.log(`  ✅ Uploaded module ${module.number}: ${module.title} (${module.content?.length || 0} chars)`)
      }
      
      console.log(`✅ ${moduleUploadCount} module files uploaded to Storage`)

      // ──────────────────────────────────────────────────────────────
      // 5. Save module metadata to Firestore (with contentUrl instead of content)
      // ──────────────────────────────────────────────────────────────
      console.log('📝 Saving module metadata to Firestore...')
      const batch = writeBatch(db)
      
      modules.forEach((module, index) => {
        const moduleRef = doc(collection(db, 'workbooks', workbookRef.id, 'WBmodules'))
        const moduleUrlData = moduleUrls.find(m => m.moduleNumber === module.number)
        
        batch.set(moduleRef, {
          workbookId: workbookRef.id,
          moduleNumber: module.number,
          moduleIndex: index,
          title: module.title,
          contentUrl: moduleUrlData?.url || '', // ← Store URL, not full content
          fieldIds: module.fieldIds || [],
          totalFields: module.totalFields || module.fieldIds?.length || 0,
          isCover: module.isCover || false,
          createdAt: serverTimestamp()
        })
      })
      
      await batch.commit()
      console.log(`✅ ${modules.length} module metadata saved to Firestore`)
      
      // Redirect to lecturer dashboard
      navigate('/lecturer')
    } catch (err) {
      console.error('Upload error:', err)
      setError('Upload failed: ' + err.message)
    } finally {
      setUploading(false)
      setUploadProgress(0)
      setProcessingDoc(false)
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

              {processingDoc && (
                <div className="processing-info">
                  <span className="spinner" /> Processing document for modules...
                </div>
              )}

              {moduleCount > 0 && !processingDoc && (
                <div className="module-info success-msg">
                  ✅ Found {moduleCount} module{moduleCount > 1 ? 's' : ''} in this document
                </div>
              )}

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
                  disabled={uploading || processingDoc}
                >
                  {uploading ? 'Uploading...' : processingDoc ? 'Processing...' : '📤 Upload Workbook'}
                </button>
                <button 
                  type="button" 
                  className="btn btn-secondary"
                  onClick={() => navigate('/lecturer')}
                  disabled={uploading || processingDoc}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>

          <div className="upload-tips">
            <h4>📌 Tips for best results:</h4>
            <ul>
              <li>Use "SECTION X:" headers to create multiple modules automatically</li>
              <li>Clear, descriptive titles help students find your workbooks</li>
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