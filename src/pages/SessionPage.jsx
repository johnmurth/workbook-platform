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
  const [moduleStatus, setModuleStatus] = useState({})
  const [processing, setProcessing] = useState(false)
  const [loadingModule, setLoadingModule] = useState(false)
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [showNavErrorModal, setShowNavErrorModal] = useState(false)
  const [navErrorMessage, setNavErrorMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [nextAvailableModule, setNextAvailableModule] = useState(1)

  const saveTimeoutRef = useRef(null)
  const documentContainerRef = useRef(null)
  const contentContainerRef = useRef(null)
  const handleFieldChangeRef = useRef(null)
  const heartbeatIntervalRef = useRef(null)
  const moduleContentCache = useRef({})
  const modulesRef = useRef([])

  // Keep modulesRef always up to date with latest modules
  useEffect(() => {
    modulesRef.current = modules
  }, [modules])

  // ── Get the next available module number ──
  const getNextAvailableModule = (statusMap = moduleStatus, moduleList = modules) => {
    if (moduleList.length === 0) return 1
    let highestApproved = 0
    moduleList.forEach(module => {
      const moduleNum = module.moduleNumber
      if (statusMap[moduleNum]?.status === 'approved') {
        highestApproved = Math.max(highestApproved, moduleNum)
      }
    })
    const nextModule = highestApproved === 0 ? 1 : highestApproved + 1
    return Math.min(nextModule, moduleList.length)
  }

  // ── Check if module is in read-only mode ──
  const isModuleReadOnly = (moduleNum) => {
    const status = moduleStatus[moduleNum]?.status || 'not_started'
    return status === 'approved' || status === 'pending'
  }

  // ── Check if module can be edited ──
  const canEditModule = (moduleNum) => {
    const status = moduleStatus[moduleNum]?.status || 'not_started'
    return status === 'not_started' || status === 'revoked'
  }

  // ── Check if module is approved ──
  const isModuleApproved = (moduleNum) => {
    return moduleStatus[moduleNum]?.status === 'approved'
  }

  // ── Check if module is pending ──
  const isModulePending = (moduleNum) => {
    return moduleStatus[moduleNum]?.status === 'pending'
  }

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
        setModuleStatus(sessionData.moduleStatus || {})
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
      
      // Calculate next available module
      const nextAvail = getNextAvailableModule()
      setNextAvailableModule(nextAvail)
      
      // Load the appropriate module
      let targetModule = sessionData.currentModule ?? 1
      
      // If current module is beyond next available, redirect to next available
      if (targetModule > nextAvail) {
        targetModule = nextAvail
      }
      
      const moduleToLoad = modulesList.find(m => m.moduleNumber === targetModule) || modulesList[0]
      await loadModuleContent(moduleToLoad)
      
    } catch (err) {
      console.error('Error fetching modules:', err)
      setError('Could not load modules')
    }
  }

  // ── Helper: Update current module in DB ──
  const updateCurrentModuleInDB = async (moduleNumber) => {
    try {
      const sessionRef = doc(db, 'WBsessions', sessionId)
      await updateDoc(sessionRef, { 
        currentModule: moduleNumber,
        lastActive: new Date()
      })
    } catch (err) {
      console.error('Error updating current module:', err)
    }
  }

  // ── Load module content from Storage URL ──
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

  // ── Handle module change with chronological enforcement ──
  const handleModuleChange = async (moduleNumber) => {
    if (moduleNumber === null || moduleNumber === undefined) {
      console.error('❌ Invalid module number:', moduleNumber)
      return
    }
    
    if (moduleNumber === currentModule) return
    
    // ── CHECK IF MODULE IS APPROVED (READ-ONLY ACCESS) ──
    const targetModuleStatus = moduleStatus[moduleNumber]?.status || 'not_started'
    const isTargetApproved = targetModuleStatus === 'approved'
    
    // ── ALLOW VIEWING APPROVED MODULES (READ-ONLY) ──
    if (isTargetApproved) {
      console.log('📖 Viewing approved module in read-only mode:', moduleNumber)
      const newModule = modules.find(m => m.moduleNumber === moduleNumber)
      if (!newModule) {
        console.error('❌ Module not found:', moduleNumber)
        return
      }
      
      // Save current work before switching
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      saveAnswers(answers, true)
      
      // Load the approved module content
      await loadModuleContent(newModule)
      
      const moduleAnswerKey = `module_${moduleNumber}`
      const moduleAns = answers[moduleAnswerKey] || {}
      setModuleAnswers(moduleAns)
      
      await updateCurrentModuleInDB(moduleNumber)
      
      setTimeout(() => {
        if (documentContainerRef.current) {
          documentContainerRef.current.scrollTop = 0
        }
      }, 100)
      return
    }
    
    // ── FOR NON-APPROVED MODULES: ENFORCE CHRONOLOGICAL ORDER ──
    const nextAvail = getNextAvailableModule()
    setNextAvailableModule(nextAvail)
    
    // If trying to go to a module that's not the next available, show modal
    if (moduleNumber > nextAvail) {
      setNavErrorMessage(`⚠️ You must complete Module ${nextAvail - 1} first before accessing Module ${moduleNumber}.`)
      setShowNavErrorModal(true)
      
      // Redirect to the next available module if different from current
      if (nextAvail !== currentModule) {
        const targetModule = modules.find(m => m.moduleNumber === nextAvail)
        if (targetModule) {
          await loadModuleContent(targetModule)
          await updateCurrentModuleInDB(nextAvail)
        }
      }
      return
    }
    
    // Check if current module is approved before allowing forward navigation
    if (moduleNumber > currentModule) {
      const currentModuleStatus = moduleStatus[currentModule]?.status
      if (currentModuleStatus !== 'approved' && currentModuleStatus !== 'not_started') {
        setNavErrorMessage('⚠️ You must wait for the lecturer to approve this module before proceeding.')
        setShowNavErrorModal(true)
        return
      }
    }
    
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
    
    await updateCurrentModuleInDB(moduleNumber)
    
    setTimeout(() => {
      if (documentContainerRef.current) {
        documentContainerRef.current.scrollTop = 0
      }
    }, 100)
  }

  // ── Handle field change with read-only protection ──
  const handleFieldChange = (fieldId, value) => {
    // Don't allow editing if module is read-only (approved or pending)
    if (isModuleReadOnly(currentModule)) {
      console.log('📖 Module is read-only, cannot edit')
      return
    }
    
    // Only allow editing for not_started or revoked
    if (!canEditModule(currentModule)) return
    
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

  // ── Lock or unlock document based on module status ──
  const lockOrUnlockDocument = (container) => {
    if (!container) return
    
    const status = moduleStatus[currentModule]?.status || 'not_started'
    const isReadOnly = status === 'approved' || status === 'pending'
    const canEdit = !isReadOnly && canEditModule(currentModule)
    
    // Lock or unlock contenteditable elements
    container.querySelectorAll('[contenteditable]').forEach(el => {
      if (isReadOnly || !canEdit) {
        el.setAttribute('contenteditable', 'false')
        el.style.pointerEvents = 'none'
        el.style.cursor = 'default'
        el.style.opacity = '0.85'
        el.setAttribute('data-readonly', 'true')
        el.title = isReadOnly ? '📖 Read-only mode' : '🔒 Locked'
      } else {
        el.setAttribute('contenteditable', 'true')
        el.style.pointerEvents = 'auto'
        el.style.cursor = 'text'
        el.style.opacity = '1'
        el.removeAttribute('data-readonly')
        el.title = ''
      }
    })
    
    // Lock or unlock checkbox and radio elements
    container.querySelectorAll('.fillable-checkbox, .fillable-radio').forEach(el => {
      if (isReadOnly || !canEdit) {
        el.style.pointerEvents = 'none'
        el.style.cursor = 'default'
        el.style.opacity = '0.85'
      } else {
        el.style.pointerEvents = 'auto'
        el.style.cursor = 'pointer'
        el.style.opacity = '1'
      }
    })
  }

  // ── SUBMIT MODULE ──
  const handleSubmitModule = async () => {
    setSubmitting(true)
    try {
      const sessionRef = doc(db, 'WBsessions', sessionId)
      
      // Update module status to pending
      await updateDoc(sessionRef, {
        [`moduleStatus.${currentModule}`]: {
          status: 'pending',
          remarks: '',
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedBy: null
        },
        lastActive: new Date()
      })
      
      // Update local state
      setModuleStatus(prev => ({
        ...prev,
        [currentModule]: {
          status: 'pending',
          remarks: '',
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedBy: null
        }
      }))
      
      setShowSubmitDialog(false)
      
    } catch (err) {
      console.error('Error submitting module:', err)
      setError('Failed to submit module. Please try again.')
      setTimeout(() => setError(''), 5000)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Track previous statuses so we only react to an actual approval EVENT,
  //    not to every navigation that lands on an already-approved module ──
  const prevModuleStatusRef = useRef({})

  useEffect(() => {
    if (!modules.length || !sessionId) return

    const prevStatus = prevModuleStatusRef.current
    let justApproved = null

    Object.keys(moduleStatus).forEach(key => {
      const moduleNum = Number(key)
      const wasApproved = prevStatus[moduleNum]?.status === 'approved'
      const isApproved = moduleStatus[moduleNum]?.status === 'approved'
      if (!wasApproved && isApproved) {
        justApproved = moduleNum
      }
    })

    prevModuleStatusRef.current = moduleStatus

    // Only auto-advance if the module that JUST flipped to approved
    // is the module the student is currently sitting on
    if (justApproved !== null && justApproved === currentModule) {
      const nextAvail = getNextAvailableModule()
      setNextAvailableModule(nextAvail)

      if (nextAvail > currentModule) {
        const targetModule = modules.find(m => m.moduleNumber === nextAvail)
        if (targetModule) {
          handleModuleChange(nextAvail)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleStatus, modules, sessionId])

  // Real-time listener for session updates
  useEffect(() => {
    if (!sessionId) return
    const sessionRef = doc(db, 'WBsessions', sessionId)
    const unsubscribe = onSnapshot(sessionRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data()
        const freshModuleStatus = data.moduleStatus || {}

        setAnswers(data.answers || {})
        setModuleProgress(data.moduleProgress || {})
        setModuleStatus(freshModuleStatus)
        setLastSaved(new Date())

        // Use modulesRef (always current) instead of stale `modules`
        if (modulesRef.current.length > 0) {
          const nextAvail = getNextAvailableModule(freshModuleStatus, modulesRef.current)
          setNextAvailableModule(nextAvail)
        }
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
    
    // Lock or unlock based on status
    lockOrUnlockDocument(container)
    
    container.scrollTop = 0
    
  }, [currentModuleContent, currentModule, loadingModule, moduleStatus])

  // ── Render module status badge ──
  const renderStatusBadge = () => {
    const status = moduleStatus[currentModule]?.status || 'not_started'
    const remarks = moduleStatus[currentModule]?.remarks || ''
    
    switch(status) {
      case 'approved':
        return (
          <div className="status-badge approved">
            <div className="status-badge-header">
              <span className="status-icon">✅</span>
              <span className="status-label">Approved</span>
              <span className="status-badge-readonly">📖 Read-Only</span>
            </div>
            {remarks && <div className="remarks-text">📝 {remarks}</div>}
            <div className="status-sub">This module has been approved and is in read-only mode</div>
          </div>
        )
      case 'pending':
        return (
          <div className="status-badge pending">
            <div className="status-badge-header">
              <span className="status-icon">⏳</span>
              <span className="status-label">Pending Approval</span>
              <span className="status-badge-readonly">📖 Read-Only</span>
            </div>
            <div className="status-sub">Waiting for lecturer review...</div>
          </div>
        )
      case 'revoked':
        return (
          <div className="status-badge revoked">
            <div className="status-badge-header">
              <span className="status-icon">❌</span>
              <span className="status-label">Revoked</span>
            </div>
            {remarks && <div className="remarks-text">📝 {remarks}</div>}
            <div className="status-sub">Please revise and resubmit</div>
          </div>
        )
      default:
        return null
    }
  }

  // ── Render submit button ──
  const renderSubmitButton = () => {
    const status = moduleStatus[currentModule]?.status || 'not_started'
    
    // For approved modules, show read-only message
    if (status === 'approved') {
      return (
        <div className="submit-section readonly">
          <div className="submit-info">
            <span className="submit-icon">✅</span>
            <span>Module approved — viewing in read-only mode</span>
          </div>
          <div className="submit-hint">📖 You can view but not edit approved modules</div>
        </div>
      )
    }
    
    // For pending modules, show waiting message
    if (status === 'pending') {
      return (
        <div className="submit-section disabled">
          <div className="submit-info">
            <span className="submit-icon">⏳</span>
            <span>Module submitted — waiting for lecturer approval</span>
          </div>
          <div className="submit-hint">📖 Read-only while under review</div>
        </div>
      )
    }
    
    // Show submit button for not_started or revoked
    if (status === 'not_started' || status === 'revoked') {
      return (
        <div className="submit-section">
          <button 
            className="btn btn-primary btn-submit"
            onClick={() => setShowSubmitDialog(true)}
          >
            📤 Submit Module for Review
          </button>
          <div className="submit-hint">
            Once submitted, you cannot edit until approved or revoked
          </div>
        </div>
      )
    }
    
    return null
  }

  const handleDownload = async () => {
    if (!session || !workbook) return

    // ── require ALL modules approved before allowing download ──
    const allApproved = modules.length > 0 && modules.every(
      m => moduleStatus[m.moduleNumber]?.status === 'approved'
    )
    if (!allApproved) {
      setShowDownloadModal(true)
      return
    }

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

  // ── ERROR STATE DISPLAY ──
  if (error) {
    return (
      <div>
        <Navbar />
        <div className="session-page">
          <div className="error-container">
            <div className="error-modal">
              <button 
                className="error-close-btn"
                onClick={() => setError('')}
                aria-label="Close error message"
              >
                ✕
              </button>
              <div className="error-icon">⚠️</div>
              <h2>Cannot Proceed</h2>
              <p>{error}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const totalModules = modules.length
  const completedModules = Object.values(moduleProgress).filter(p => p === 100).length
  const approvedModules = Object.values(moduleStatus).filter(s => s.status === 'approved').length
  const currentStatus = moduleStatus[currentModule]?.status || 'not_started'
  const isReadOnly = isModuleReadOnly(currentModule)

  return (
    <div>
      <Navbar />
      <div className="session-page">
        {/* ── DOWNLOAD MODAL ── */}
        {showDownloadModal && (
          <div className="modal-overlay" onClick={() => setShowDownloadModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <button 
                className="modal-close-btn" 
                onClick={() => setShowDownloadModal(false)}
                aria-label="Close dialog"
              >
                ✕
              </button>
              <div className="modal-header">
                <h3>⚠️ Cannot Download</h3>
              </div>
              <div className="modal-body">
                <p>You can only download once all modules have been approved by your lecturer.</p>
                <p style={{ marginTop: '8px', fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
                  Please wait for your lecturer to review and approve all modules.
                </p>
              </div>
              <div className="modal-actions">
                <button 
                  className="btn btn-secondary" 
                  onClick={() => setShowDownloadModal(false)}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── NAVIGATION ERROR MODAL ── */}
        {showNavErrorModal && (
          <div className="modal-overlay" onClick={() => setShowNavErrorModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <button 
                className="modal-close-btn" 
                onClick={() => setShowNavErrorModal(false)}
                aria-label="Close dialog"
              >
                ✕
              </button>
              <div className="modal-header">
                <h3>⚠️ Navigation Restricted</h3>
              </div>
              <div className="modal-body">
                <p>{navErrorMessage}</p>
              </div>
              <div className="modal-actions">
                <button 
                  className="btn btn-secondary" 
                  onClick={() => setShowNavErrorModal(false)}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── SUBMIT CONFIRMATION DIALOG ── */}
        {showSubmitDialog && (
          <div className="modal-overlay" onClick={() => setShowSubmitDialog(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <button 
                className="modal-close-btn" 
                onClick={() => setShowSubmitDialog(false)}
                disabled={submitting}
                aria-label="Close dialog"
              >
                ✕
              </button>
              <div className="modal-header">
                <h3>📤 Submit Module {currentModule}?</h3>
              </div>
              <div className="modal-body">
                <p><strong>Once submitted you can't edit until approved or revoked.</strong></p>
                <p style={{ marginTop: '8px', color: 'var(--ink-soft)' }}>
                  The lecturer will review your answers and provide feedback.
                </p>
                <div className="modal-actions">
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => setShowSubmitDialog(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button 
                    className="btn btn-primary" 
                    onClick={handleSubmitModule}
                    disabled={submitting}
                  >
                    {submitting ? 'Submitting...' : 'Yes, Submit'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── HEADER ── */}
        <div className="session-header">
          <div className="container">
            <div className="header-content">
              <div className="header-left">
                <h1>{workbook?.title}</h1>
                <p className="session-subtitle">
                  Lecturer: {session?.lecturerName} • 
                  Module {currentModule} of {totalModules}
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
                  key={currentModule}
                  modules={modules}
                  currentModule={currentModule}
                  onModuleChange={handleModuleChange}
                  moduleProgress={moduleProgress}
                  moduleStatus={moduleStatus}
                  nextAvailableModule={nextAvailableModule}
                />
              </div>

              <div className="document-content">
                <div className="document-instructions">
                  {isReadOnly ? (
                    <p>📖 <strong>Read-Only Mode:</strong> This module is {currentStatus === 'approved' ? 'approved' : 'pending review'} and cannot be edited.</p>
                  ) : (
                    <p>💡 <strong>How to fill:</strong> Click on any blank (_____), checkbox (□), or radio (○) to fill. Everything saves automatically.</p>
                  )}
                </div>
                
                {/* ── STATUS BADGE ── */}
                {renderStatusBadge()}
                
                <div className="module-title-bar">
                  <div className="module-title-left">
                    <h2>
                      {(() => {
                        const currentModuleData = modules.find(m => m.moduleNumber === currentModule)
                        const moduleTitle = currentModuleData?.title || ''
                        return `Module ${currentModule}: ${moduleTitle}`
                      })()}
                      {isReadOnly && <span className="readonly-badge">🔒 Read-Only</span>}
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
                        disabled={
                          currentModule === modules.length || 
                          (currentStatus !== 'approved' && currentStatus !== 'not_started') ||
                          currentModule >= nextAvailableModule
                        }
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className={`document-viewer card ${isReadOnly ? 'readonly' : ''} ${!canEditModule(currentModule) ? 'locked' : ''}`} ref={documentContainerRef}>
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
                
                {/* ── READ-ONLY OVERLAY ── */}
                {isReadOnly && (
                  <div className="readonly-overlay">
                    <div className="readonly-overlay-content">
                      <span className="readonly-icon">📖</span>
                      <span>Read-Only Mode</span>
                      <span className="readonly-sub">This module is {currentStatus === 'approved' ? 'approved' : 'pending review'}</span>
                    </div>
                  </div>
                )}
                
                {/* ── SUBMIT SECTION ── */}
                {renderSubmitButton()}
                
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
                    disabled={
                      currentModule === modules.length || 
                      (currentStatus !== 'approved' && currentStatus !== 'not_started') ||
                      currentModule >= nextAvailableModule
                    }
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
              <div style={{ display: 'none'}}>
                📝 {Object.keys(answers).reduce((total, key) => {
                  if (key.startsWith('module_')) {
                    return total + Object.keys(answers[key] || {}).length
                  }
                  return total
                }, 0)} answers saved across all modules
              </div>
              <button onClick={() => navigate('/student')} className="btn btn-ghost">← Back to Dashboard</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}