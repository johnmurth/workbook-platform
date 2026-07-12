// src/pages/ViewWorkbook.jsx
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, collection, query, orderBy, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import ModuleNavigation from '../components/ModuleNavigation'
import Navbar from '../components/shared/Navbar'
import './WatchSession.css' // reuse the same read-only viewer styling

export default function ViewWorkbook() {
  const { workbookId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [workbook, setWorkbook] = useState(null)
  const [modules, setModules] = useState([])
  const [currentModule, setCurrentModule] = useState(1)
  const [currentModuleContent, setCurrentModuleContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingModule, setLoadingModule] = useState(false)
  const [error, setError] = useState('')

  const documentContainerRef = useRef(null)
  const moduleContentCache = useRef({})

  // ── Load workbook + verify ownership + fetch modules ──
  useEffect(() => {
    const loadWorkbook = async () => {
      try {
        const wbRef = doc(db, 'workbooks', workbookId)
        const wbSnap = await getDoc(wbRef)

        if (!wbSnap.exists()) {
          setError('Workbook not found')
          setLoading(false)
          return
        }

        const wbData = { id: wbSnap.id, ...wbSnap.data() }

        if (wbData.lecturerUid !== user.uid) {
          setError('You do not have access to this workbook')
          setLoading(false)
          return
        }

        setWorkbook(wbData)
        await fetchModules(workbookId)
      } catch (err) {
        console.error('Error loading workbook:', err)
        setError('Failed to load workbook')
      } finally {
        setLoading(false)
      }
    }

    if (user) loadWorkbook()
  }, [workbookId, user])

  // ── Fetch modules from subcollection ──
  const fetchModules = async (wbId) => {
    try {
      const modulesQuery = query(
        collection(db, 'workbooks', wbId, 'WBmodules'),
        orderBy('moduleNumber')
      )
      const modulesSnap = await getDocs(modulesQuery)

      const modulesList = modulesSnap.docs.map(d => ({ id: d.id, ...d.data() }))

      if (modulesList.length === 0) {
        setError('No modules found for this workbook')
        return
      }

      setModules(modulesList)

      const firstModule = modulesList[0]
      setCurrentModule(firstModule.moduleNumber)
      await loadModuleContent(firstModule)
    } catch (err) {
      console.error('Error fetching modules:', err)
      setError('Could not load modules')
    }
  }

  // ── Load module content from Storage URL (blank/unfilled template) ──
  const loadModuleContent = async (module) => {
    if (!module) return

    setLoadingModule(true)

    try {
      let content = ''

      if (moduleContentCache.current[module.id]) {
        content = moduleContentCache.current[module.id]
      } else if (module.contentUrl) {
        const response = await fetch(module.contentUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch module content: ${response.status}`)
        }
        content = await response.text()
        moduleContentCache.current[module.id] = content
      } else if (module.content) {
        content = module.content
        moduleContentCache.current[module.id] = content
      } else {
        throw new Error('No content available for this module')
      }

      setCurrentModuleContent(content)

      // Lock the document (read-only, no answers to load — shows the blank template as authored)
      setTimeout(() => {
        if (documentContainerRef.current) {
          lockDocument(documentContainerRef.current)
        }
      }, 200)
    } catch (err) {
      console.error('Error loading module content:', err)
      setError(`Failed to load module: ${err.message}`)
    } finally {
      setLoadingModule(false)
    }
  }

  // ── Strip interactivity — same lock behavior as WatchSession ──
  const lockDocument = (container) => {
    if (!container) return
    container.querySelectorAll('[contenteditable]').forEach(el => {
      el.setAttribute('contenteditable', 'false')
      el.style.pointerEvents = 'none'
      el.style.cursor = 'default'
    })
    container.querySelectorAll('.fillable-checkbox, .fillable-radio').forEach(el => {
      el.style.pointerEvents = 'none'
      el.style.cursor = 'default'
    })
  }

  // Re-lock whenever content changes
  useEffect(() => {
    if (!documentContainerRef.current || !currentModuleContent || loadingModule) return
    lockDocument(documentContainerRef.current)
  }, [currentModuleContent, loadingModule])

  // ── Change module ──
  const handleModuleChange = (moduleNumber) => {
    if (moduleNumber === currentModule) return

    const newModule = modules.find(m => m.moduleNumber === moduleNumber)
    if (!newModule) return

    setCurrentModule(moduleNumber)
    loadModuleContent(newModule)

    setTimeout(() => {
      if (documentContainerRef.current) {
        documentContainerRef.current.scrollTop = 0
      }
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }, 100)
  }

  if (loading) {
    return (
      <div>
        <Navbar />
        <div className="page-loader"><span className="spinner" /> Loading workbook...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <Navbar />
        <div className="watch-session-page">
          <div className="container">
            <div className="error-msg">{error}</div>
            <button onClick={() => navigate('/lecturer')} className="btn btn-primary">Back to Dashboard</button>
          </div>
        </div>
      </div>
    )
  }

  const totalModules = modules.length

  return (
    <div>
      <Navbar />
      <div className="watch-session-page">

        {/* ── HEADER ── */}
        <div className="live-header">
          <div className="container">
            <div className="live-header-content">
              <div className="session-info">
                <div className="live-badge" style={{ background: '#555' }}>
                  <span className="live-dot" style={{ background: '#fff' }} />
                  PREVIEW
                </div>
                <span className="workbook-title">{workbook?.title}</span>
                <span className="workbook-meta">
                  <span className="separator">•</span>
                  M{currentModule}/{totalModules}
                </span>
              </div>

              <div className="session-controls">
                <div className="header-actions">
                  <button onClick={() => navigate('/lecturer')} className="btn btn-ghost">
                    ✕
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── DOCUMENT VIEWER ── */}
        <div className="document-viewer-container">
          <div className="container">
            <div className="watch-notice">
              👁️ <strong>Read-only preview</strong> — this is how your workbook looks to students before they fill it in
            </div>

            <div className="document-layout">
              <div className="module-sidebar">
                <ModuleNavigation
                  modules={modules}
                  currentModule={currentModule}
                  onModuleChange={handleModuleChange}
                  moduleProgress={{}}
                  moduleStatus={{}}
                  nextAvailableModule={totalModules + 1}
                />
              </div>

              <div className="document-content">
                <div className="module-title-bar">
                  <h2>{modules.find(m => m.moduleNumber === currentModule)?.title || `Module ${currentModule}`}</h2>
                </div>

                <div className="document-viewer card" ref={documentContainerRef}>
                  {loadingModule ? (
                    <div className="loading-document"><span className="spinner" /> Loading module...</div>
                  ) : currentModuleContent ? (
                    <div className="html-viewer" dangerouslySetInnerHTML={{ __html: currentModuleContent }} />
                  ) : (
                    <div className="empty-document">No content available</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}