// src/pages/SessionPage.jsx
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, updateDoc, onSnapshot, collection, query, where, getDocs, orderBy } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import { attachListeners, loadSavedAnswers } from '../lib/documentProcessor'
import { calculateModuleProgress } from '../lib/moduleUtils'
import ModuleNavigation from '../components/ModuleNavigation'
import Navbar from '../components/shared/Navbar'
import './SessionPage.css'

export default function SessionPage() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()

  const [session, setSession] = useState(null)
  const [workbook, setWorkbook] = useState(null)
  const [modules, setModules] = useState([])
  const [currentModule, setCurrentModule] = useState(1)
  const [currentModuleContent, setCurrentModuleContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [error, setError] = useState('')
  const [answers, setAnswers] = useState({})
  const [moduleAnswers, setModuleAnswers] = useState({})
  const [moduleProgress, setModuleProgress] = useState({})
  const [processing, setProcessing] = useState(false)
  const [loadingModule, setLoadingModule] = useState(false)

  const saveTimeoutRef = useRef(null)
  const documentContainerRef = useRef(null)
  const contentContainerRef = useRef(null)
  const handleFieldChangeRef = useRef(null)
  const heartbeatIntervalRef = useRef(null)
  const moduleContentCache = useRef({})

  // ── HEARTBEAT: Update lastActive every 10 seconds ──
  const updateLastActive = async () => {
    if (!sessionId) return
    try {
      const sessionRef = doc(db, 'WBsessions', sessionId)
      await updateDoc(sessionRef, { lastActive: new Date() })
    } catch (err) {
      // Silent fail
    }
  }

  useEffect(() => {
    if (sessionId) {
      updateLastActive()
      heartbeatIntervalRef.current = setInterval(updateLastActive, 10000)
    }
    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current)
      }
    }
  }, [sessionId])

  // ── Update lastActive on user interaction ──
  useEffect(() => {
    const handleUserInteraction = () => {
      updateLastActive()
    }
    window.addEventListener('click', handleUserInteraction)
    window.addEventListener('scroll', handleUserInteraction)
    window.addEventListener('keydown', handleUserInteraction)
    return () => {
      window.removeEventListener('click', handleUserInteraction)
      window.removeEventListener('scroll', handleUserInteraction)
      window.removeEventListener('keydown', handleUserInteraction)
    }
  }, [sessionId])

  useEffect(() => {
    const loadSession = async () => {
      try {
        const sessionRef = doc(db, 'WBsessions', sessionId)
        const sessionSnap = await getDoc(sessionRef)

        if (!sessionSnap.exists()) {
          setError('Session not found')
          setLoading(false)
          return
        }

        const sessionData = { id: sessionSnap.id, ...sessionSnap.data() }

        if (sessionData.studentUid !== user.uid && profile?.role !== 'lecturer') {
          setError('You do not have access to this session')
          setLoading(false)
          return
        }

        setSession(sessionData)
        setAnswers(sessionData.answers || {})
        setModuleProgress(sessionData.moduleProgress || {})
        setCurrentModule(sessionData.currentModule || 1)

        const workbookRef = doc(db, 'workbooks', sessionData.workbookId)
        const workbookSnap = await getDoc(workbookRef)

        if (workbookSnap.exists()) {
          const workbookData = { id: workbookSnap.id, ...workbookSnap.data() }
          setWorkbook(workbookData)
          await fetchModules(workbookData.id, sessionData)
        }
      } catch (err) {
        console.error('Error loading session:', err)
        setError('Failed to load session')
      } finally {
        setLoading(false)
      }
    }

    loadSession()
  }, [sessionId, user, profile])

  // ── Fetch modules and load content ──
  const fetchModules = async (workbookId, sessionData) => {
    try {
      console.log('📚 Fetching modules for workbook:', workbookId)
      
      const modulesQuery = query(
        collection(db, 'workbooks', workbookId, 'WBmodules'),
        orderBy('moduleNumber')
      )
      const modulesSnap = await getDocs(modulesQuery)
      
      let modulesList = []
      if (!modulesSnap.empty) {
        modulesList = modulesSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        console.log('✅ Modules found in sub-collection:', modulesList.length)
      } else {
        console.log('⚠️ No modules in sub-collection, checking fallback...')
        const fallbackQuery = query(
          collection(db, 'WBmodules'),
          where('workbookId', '==', workbookId),
          orderBy('moduleNumber')
        )
        const fallbackSnap = await getDocs(fallbackQuery)
        modulesList = fallbackSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        console.log('✅ Modules found in fallback:', modulesList.length)
      }
      
      if (modulesList.length === 0) {
        console.error('❌ No modules found in this workbook')
        setError('No modules found in this workbook')
        return
      }
      
      console.log('📦 Modules list:', modulesList.map(m => ({ number: m.moduleNumber, title: m.title, hasUrl: !!m.contentUrl })))
      setModules(modulesList)
      
      // Load the first module
      const targetModule = sessionData.currentModule ?? 1
      const moduleToLoad = modulesList.find(m => m.moduleNumber === targetModule) || modulesList[0]
      
      await loadModuleContent(moduleToLoad)
      
    } catch (err) {
      console.error('Error fetching modules:', err)
      setError('Could not load modules')
    }
  }

  // ── NEW: Load module content from Storage URL ──
  const loadModuleContent = async (module) => {
    if (!module) return
    
    setLoadingModule(true)
    
    try {
      let content = ''
      
      // Check cache first
      if (moduleContentCache.current[module.id]) {
        console.log('📦 Using cached content for module:', module.moduleNumber)
        content = moduleContentCache.current[module.id]
      } else if (module.contentUrl) {
        // Load from Storage
        console.log('📥 Fetching module content from Storage:', module.contentUrl)
        const response = await fetch(module.contentUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch module content: ${response.status}`)
        }
        content = await response.text()
        // Cache it
        moduleContentCache.current[module.id] = content
        console.log('✅ Module content loaded and cached, length:', content.length)
      } else if (module.content) {
        // Fallback: use content from Firestore (if still stored)
        console.log('📄 Using Firestore content for module:', module.moduleNumber)
        content = module.content
        moduleContentCache.current[module.id] = content
      } else {
        throw new Error('No content available for this module')
      }
      
      setCurrentModule(module.moduleNumber)
      setCurrentModuleContent(content)
      
    } catch (err) {
      console.error('❌ Error loading module content:', err)
      setError(`Failed to load module: ${err.message}`)
    } finally {
      setLoadingModule(false)
    }
  }

  // ── Handle module change ──
  const handleModuleChange = async (moduleNumber) => {
    if (moduleNumber === null || moduleNumber === undefined) {
      console.error('❌ Invalid module number:', moduleNumber)
      return
    }
    
    if (moduleNumber === currentModule) return
    
    console.log('🔄 Switching to module:', moduleNumber)
    
    const newModule = modules.find(m => m.moduleNumber === moduleNumber)
    if (!newModule) {
      console.error('❌ Module not found:', moduleNumber)
      return
    }
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveAnswers(answers, true)
    
    // Load the new module content
    await loadModuleContent(newModule)
    
    const moduleAnswerKey = `module_${moduleNumber}`
    const moduleAns = answers[moduleAnswerKey] || {}
    setModuleAnswers(moduleAns)
    
    try {
      const sessionRef = doc(db, 'WBsessions', sessionId)
      await updateDoc(sessionRef, { 
        currentModule: moduleNumber,
        lastActive: new Date()
      })
    } catch (err) {
      console.error('Error updating current module:', err)
    }
    
    setTimeout(() => {
      if (documentContainerRef.current) {
        documentContainerRef.current.scrollTop = 0
      }
    }, 100)
  }

  const handleFieldChange = (fieldId, value) => {
    const moduleKey = `module_${currentModule}`
    const currentModuleAns = answers[moduleKey] || {}
    const newModuleAns = { ...currentModuleAns, [fieldId]: value }
    
    const newAnswers = { 
      ...answers, 
      [moduleKey]: newModuleAns 
    }
    
    setAnswers(newAnswers)
    setModuleAnswers(newModuleAns)
    
    const currentModuleData = modules.find(m => m.moduleNumber === currentModule)
    
    if (currentModuleData) {
      const progress = calculateModuleProgress(currentModuleData.fieldIds, newModuleAns)
      const newModuleProgress = { ...moduleProgress, [currentModule]: progress }
      setModuleProgress(newModuleProgress)
      
      const sessionRef = doc(db, 'WBsessions', sessionId)
      updateDoc(sessionRef, { 
        moduleProgress: newModuleProgress,
        lastActive: new Date()
      }).catch(err => console.error('Error updating progress:', err))
    }
    
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => saveAnswers(newAnswers), 500)
  }

  handleFieldChangeRef.current = handleFieldChange

  const saveAnswers = async (newAnswers, force = false) => {
    if (!sessionId) return
    setSaving(true)
    try {
      const sessionRef = doc(db, 'WBsessions', sessionId)
      await updateDoc(sessionRef, { 
        answers: newAnswers,
        lastActive: new Date()
      })
      setLastSaved(new Date())
    } catch (err) {
      console.error('Error saving:', err)
    } finally {
      setSaving(false)
    }
  }

  // Real-time listener for session updates
  useEffect(() => {
    if (!sessionId) return
    const sessionRef = doc(db, 'WBsessions', sessionId)
    const unsubscribe = onSnapshot(sessionRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data()
        setAnswers(data.answers || {})
        setModuleProgress(data.moduleProgress || {})
        setLastSaved(new Date())
      }
    })
    return () => unsubscribe()
  }, [sessionId])

  // Apply answers to DOM when module content changes
  useEffect(() => {
    if (!documentContainerRef.current || !currentModuleContent || loadingModule) return
    
    const container = documentContainerRef.current
    
    attachListeners(
      container,
      (fieldId, value) => handleFieldChangeRef.current(fieldId, value)
    )
    
    const moduleKey = `module_${currentModule}`
    const moduleAns = answers[moduleKey] || {}
    loadSavedAnswers(container, moduleAns)
    
    container.scrollTop = 0
    
  }, [currentModuleContent, currentModule, loadingModule])

  const handleDownload = async () => {
    if (!session || !workbook) return
    if (session.downloadCount >= session.downloadLimit) {
      setError(`Download limit reached (${session.downloadLimit}/${session.downloadLimit})`)
      return
    }

    try {
      setProcessing(true)

      let fullContent = ''
      for (const module of modules) {
        let content = ''
        
        // Try to get content from cache first
        if (moduleContentCache.current[module.id]) {
          content = moduleContentCache.current[module.id]
        } else if (module.contentUrl) {
          // Fetch from Storage
          const response = await fetch(module.contentUrl)
          if (response.ok) {
            content = await response.text()
            moduleContentCache.current[module.id] = content
          }
        } else if (module.content) {
          content = module.content
        }
        
        const moduleKey = `module_${module.moduleNumber}`
        const moduleAns = answers[moduleKey] || {}
        
        const tempContainer = document.createElement('div')
        tempContainer.innerHTML = content
        loadSavedAnswers(tempContainer, moduleAns)
        
        const moduleTitle = module.isCover
          ? ''
          : `<h2 style="color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; margin-bottom: 20px;">
              ${module.title || `Module ${module.moduleNumber}`}
            </h2>`

        const isLast = module.moduleNumber === modules[modules.length - 1].moduleNumber
        fullContent += `
          <div style="${isLast ? '' : 'page-break-after: always;'} margin-bottom: 30px; padding-bottom: 20px;">
            ${moduleTitle}
            ${tempContainer.innerHTML}
          </div>
        `
      }

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>${workbook.title}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { 
              font-family: Arial, sans-serif; 
              font-size: 12pt; 
              line-height: 1.6;
              color: #000; 
              padding: 40px 60px;
              max-width: 1000px;
              margin: 0 auto;
            }
            .header { 
              text-align: center; 
              margin-bottom: 40px; 
              padding-bottom: 30px; 
              border-bottom: 3px solid #3498db; 
            }
            .title { font-size: 24pt; font-weight: bold; color: #2c3e50; }
            .meta { font-size: 11pt; color: #7f8c8d; margin-top: 5px; }
            h2 { font-size: 18pt; color: #2c3e50; margin: 1em 0 0.5em 0; }
            p { margin: 0.5em 0; }
            table { width: 100%; border-collapse: collapse; margin: 1em 0; }
            th, td { border: 1px solid #bdc3c7; padding: 8px 12px; text-align: left; }
            th { background: #ecf0f1; }
            @media print {
              body { padding: 20mm 15mm; }
              @page { margin: 20mm 15mm; }
            }
          </style>
        </head>
        <body>
          ${fullContent}
          <div class="footer">Generated on ${new Date().toLocaleString()}</div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 500);
            };
          <\/script>
        </body>
        </html>
      `

      const blob = new Blob([htmlContent], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const newWindow = window.open(url, '_blank')
      
      if (!newWindow) {
        setError('Please allow popups for this site')
        setProcessing(false)
        return
      }

      const sessionRef = doc(db, "WBsessions", sessionId)
      await updateDoc(sessionRef, { 
        downloadCount: (session.downloadCount || 0) + 1 
      })

      setProcessing(false)

    } catch (err) {
      console.error("Error downloading:", err)
      setError("Failed to generate PDF: " + err.message)
      setProcessing(false)
    }
  }

  if (loading) {
    return (
      <div>
        <Navbar />
        <div className="page-loader"><span className="spinner"></span> Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <Navbar />
        <div className="session-page">
          <div className="container">
            <div className="error-msg">{error}</div>
            <button onClick={() => navigate('/student')} className="btn btn-primary">Back</button>
          </div>
        </div>
      </div>
    )
  }

  const totalModules = modules.length
  const completedModules = Object.values(moduleProgress).filter(p => p === 100).length

  return (
    <div>
      <Navbar />
      <div className="session-page">
        {/* ── HEADER ── */}
        <div className="session-header">
          <div className="container">
            <div className="header-content">
              <div className="header-left">
                <h1>{workbook?.title}</h1>
                <p className="session-subtitle">
                  Lecturer: {session?.lecturerName} • 
                  Module {currentModule} of {totalModules} • 
                  {completedModules}/{totalModules} completed
                </p>
              </div>
              <div className="header-actions">
                <div className="save-status">
                  {saving ? <span>💾 Saving...</span> : lastSaved ? <span>✓ Saved</span> : null}
                </div>
                <button
                  onClick={handleDownload}
                  className="btn btn-secondary"
                  disabled={session?.downloadCount >= session?.downloadLimit}
                >
                  📥 Download ({session?.downloadCount || 0}/{session?.downloadLimit || 3})
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── DOCUMENT VIEWER ── */}
        <div className="document-viewer-container" ref={contentContainerRef}>
          <div className="container">
            <div className="document-layout">
              <div className="module-sidebar">
                <ModuleNavigation
                  modules={modules}
                  currentModule={currentModule}
                  onModuleChange={handleModuleChange}
                  moduleProgress={moduleProgress}
                />
              </div>

              <div className="document-content">
                <div className="document-instructions">
                  <p>💡 <strong>How to fill:</strong> Click on any blank (_____), checkbox (□), or radio (○) to fill. Everything saves automatically.</p>
                </div>
                
                <div className="module-title-bar">
                  <div className="module-title-left">
                    <h2>
                      {(() => {
                        const currentModuleData = modules.find(m => m.moduleNumber === currentModule)
                        const moduleTitle = currentModuleData?.title || ''
                        return `Module ${currentModule}: ${moduleTitle}`
                      })()}
                    </h2>
                  </div>
                  <div className="module-controls">
                    <div className="module-progress-badge">
                      {moduleProgress[currentModule] || 0}% complete
                    </div>
                    <div className="module-nav-buttons-top">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          const prevModuleNum = currentModule - 1
                          if (prevModuleNum >= 1) handleModuleChange(prevModuleNum)
                        }}
                        disabled={currentModule === 1}
                      >
                        ← Prev
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          const nextModuleNum = currentModule + 1
                          if (nextModuleNum <= modules.length) handleModuleChange(nextModuleNum)
                        }}
                        disabled={currentModule === modules.length}
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="document-viewer card" ref={documentContainerRef}>
                  {loadingModule ? (
                    <div className="loading-document"><span className="spinner"></span> Loading module...</div>
                  ) : processing ? (
                    <div className="loading-document"><span className="spinner"></span> Processing...</div>
                  ) : currentModuleContent ? (
                    <div className="html-viewer" dangerouslySetInnerHTML={{ __html: currentModuleContent }} />
                  ) : (
                    <div className="empty-document">No content available for this module</div>
                  )}
                </div>
                
                <div className="module-nav-buttons-bottom">
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      const prevModuleNum = currentModule - 1
                      if (prevModuleNum >= 1) handleModuleChange(prevModuleNum)
                    }}
                    disabled={currentModule === 1}
                  >
                    ← Previous Module
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      const nextModuleNum = currentModule + 1
                      if (nextModuleNum <= modules.length) handleModuleChange(nextModuleNum)
                    }}
                    disabled={currentModule === modules.length}
                  >
                    Next Module →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── FOOTER ── */}
        <div className="session-footer">
          <div className="container">
            <div className="footer-content">
              <div>📝 {Object.keys(answers).reduce((total, key) => {
                if (key.startsWith('module_')) {
                  return total + Object.keys(answers[key] || {}).length
                }
                return total
              }, 0)} answers saved across all modules</div>
              <button onClick={() => navigate('/student')} className="btn btn-ghost">← Back to Dashboard</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}