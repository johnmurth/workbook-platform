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

  const saveTimeoutRef = useRef(null)
  const documentContainerRef = useRef(null)
  const contentContainerRef = useRef(null)
  const handleFieldChangeRef = useRef(null)
  const heartbeatIntervalRef = useRef(null)

  // ── HEARTBEAT: Update lastActive every 10 seconds ──
  const updateLastActive = async () => {
    if (!sessionId) return
    try {
      const sessionRef = doc(db, 'WBsessions', sessionId)
      await updateDoc(sessionRef, { lastActive: new Date() })
    } catch (err) {
      // Silent fail - don't log every heartbeat
    }
  }

  useEffect(() => {
    // Start heartbeat when session loads
    if (sessionId) {
      // Update immediately
      updateLastActive()
      
      // Then every 10 seconds
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
      
      console.log('📦 Modules list:', modulesList)
      setModules(modulesList)
      
      const targetModule = sessionData.currentModule || 1
      console.log('🎯 Target module:', targetModule)
      
      const moduleToLoad = modulesList.find(m => {
        const mNum = m.moduleNumber || m.moduleIndex || modulesList.indexOf(m) + 1
        return mNum === targetModule
      }) || modulesList[0]
      
      const moduleNum = moduleToLoad.moduleNumber || moduleToLoad.moduleIndex || 1
      console.log('📄 Loading module:', moduleNum, 'Content length:', moduleToLoad.content?.length || 0)
      
      setCurrentModule(moduleNum)
      setCurrentModuleContent(moduleToLoad.content || '')
      
    } catch (err) {
      console.error('Error fetching modules:', err)
      setError('Could not load modules')
    }
  }

  const handleModuleChange = async (moduleNumber) => {
    if (!moduleNumber) {
      console.error('❌ Invalid module number:', moduleNumber)
      return
    }
    
    if (moduleNumber === currentModule) return
    
    console.log('🔄 Switching to module:', moduleNumber)
    
    const newModule = modules.find(m => {
      const mNum = m.moduleNumber || m.moduleIndex || modules.indexOf(m) + 1
      return mNum === moduleNumber
    })
    
    if (!newModule) {
      console.error('❌ Module not found:', moduleNumber)
      return
    }
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveAnswers(answers, true)
    
    setCurrentModule(moduleNumber)
    setCurrentModuleContent(newModule.content || '')
    
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
    
    const currentModuleData = modules.find(m => {
      const mNum = m.moduleNumber || m.moduleIndex || modules.indexOf(m) + 1
      return mNum === currentModule
    })
    
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
    console.log('🔧 Applying module content - currentModule:', currentModule, 'content exists:', !!currentModuleContent)
    
    if (!documentContainerRef.current) {
      console.log('⚠️ documentContainerRef not ready')
      return
    }
    
    if (!currentModuleContent) {
      console.log('⚠️ No module content to display')
      return
    }
    
    const container = documentContainerRef.current
    
    attachListeners(
      container,
      (fieldId, value) => handleFieldChangeRef.current(fieldId, value)
    )
    
    const moduleKey = `module_${currentModule}`
    const moduleAns = answers[moduleKey] || {}
    console.log('📝 Loading answers for module:', currentModule, 'answers:', Object.keys(moduleAns).length)
    loadSavedAnswers(container, moduleAns)
    
    container.scrollTop = 0
    
  }, [currentModuleContent, currentModule])

  const handleDownload = async () => {
    if (!session || !workbook) return
    if (session.downloadCount >= session.downloadLimit) {
      setError(`Download limit reached (${session.downloadLimit}/${session.downloadLimit})`)
      return
    }

    try {
      let fullContent = ''
      for (const module of modules) {
        const moduleKey = `module_${module.moduleNumber || module.moduleIndex || modules.indexOf(module) + 1}`
        const moduleAns = answers[moduleKey] || {}
        
        const tempContainer = document.createElement('div')
        tempContainer.innerHTML = module.content
        loadSavedAnswers(tempContainer, moduleAns)
        fullContent += `<h2>${module.title}</h2>${tempContainer.innerHTML}`
      }

      const printWindow = window.open("", "_blank")
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${workbook.title}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: Arial, sans-serif; font-size: 11pt; color: #000; padding: 20mm; }
            h1, h2, h3, h4 { margin: 0.8em 0 0.4em; }
            p { margin: 0.4em 0; }
            table { width: 100%; border-collapse: collapse; margin: 0.5em 0; }
            td, th { border: 1px solid #999; padding: 4px 8px; vertical-align: top; }
            @media print {
              body { padding: 0; }
              @page { margin: 15mm; }
            }
          </style>
        </head>
        <body>
          <p style="font-size:9pt;color:#666;margin-bottom:12px;">
            ${workbook.title} &nbsp;|&nbsp; ${profile?.name || ""} &nbsp;|&nbsp; ${new Date().toLocaleDateString()}
          </p>
          ${fullContent}
        </body>
        </html>
      `)
      printWindow.document.close()
      printWindow.focus()
      printWindow.onload = () => {
        printWindow.print()
        printWindow.close()
      }
      setTimeout(() => {
        try { printWindow.print(); printWindow.close() } catch(e) {}
      }, 800)

      const sessionRef = doc(db, "WBsessions", sessionId)
      await updateDoc(sessionRef, { downloadCount: (session.downloadCount || 0) + 1 })

    } catch (err) {
      console.error("Error downloading:", err)
      setError("Failed to generate PDF")
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
                        const currentModuleData = modules.find(m => {
                          const mNum = m.moduleNumber || m.moduleIndex || modules.indexOf(m) + 1
                          return mNum === currentModule
                        })
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
                  {processing ? (
                    <div className="loading-document"><span className="spinner"></span> Processing module...</div>
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