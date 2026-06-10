// src/pages/SessionPage.jsx
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import { processDocumentForFillable, attachListeners, loadSavedAnswers } from '../lib/documentProcessor'
import Navbar from '../components/shared/Navbar'
import './SessionPage.css'

export default function SessionPage() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()

  const [session, setSession] = useState(null)
  const [workbook, setWorkbook] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [error, setError] = useState('')
  const [documentHtml, setDocumentHtml] = useState(null)
  const [answers, setAnswers] = useState({})
  const [processing, setProcessing] = useState(false)

  const saveTimeoutRef = useRef(null)
  const documentContainerRef = useRef(null)
  const handleFieldChangeRef = useRef(null)

  useEffect(() => {
    const loadSession = async () => {
      try {
        const sessionRef = doc(db, 'sessions', sessionId)
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

        const workbookRef = doc(db, 'workbooks', sessionData.workbookId)
        const workbookSnap = await getDoc(workbookRef)

        if (workbookSnap.exists()) {
          const workbookData = { id: workbookSnap.id, ...workbookSnap.data() }
          setWorkbook(workbookData)
          await loadDocument(workbookData)
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

  useEffect(() => {
    if (!sessionId) return
    const sessionRef = doc(db, 'sessions', sessionId)
    const unsubscribe = onSnapshot(sessionRef, (snap) => {
      if (snap.exists()) {
        setAnswers(snap.data().answers || {})
        setLastSaved(new Date())
      }
    })
    return () => unsubscribe()
  }, [sessionId])

  const handleFieldChange = (fieldId, value) => {
    const newAnswers = { ...answers, [fieldId]: value }
    setAnswers(newAnswers)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => saveAnswers(newAnswers), 500)
  }

  handleFieldChangeRef.current = handleFieldChange

  const loadDocument = async (workbookData) => {
    setProcessing(true)
    try {
      const fileUrl = workbookData.fileUrl
      const fileType = workbookData.fileType || ''

      if (fileType.includes('pdf')) {
        setDocumentHtml(`
          <div class="pdf-viewer">
            <embed src="${fileUrl}#toolbar=1&navpanes=1&scrollbar=1" type="application/pdf" width="100%" height="700px" />
            <p class="pdf-note">PDF is read-only. Ask your lecturer to upload a DOCX for inline editing.</p>
          </div>
        `)
      } else if (fileType.includes('word') || fileType.includes('document')) {
        const response = await fetch(fileUrl)
        const arrayBuffer = await response.arrayBuffer()

        // processDocumentForFillable handles mammoth internally now —
        // it injects markers into the raw XML before converting so
        // shape lines survive as detectable text in the HTML output
        const { html: processedHtml } = await processDocumentForFillable(
          arrayBuffer,
          (fieldId, value) => handleFieldChangeRef.current(fieldId, value)
        )

        setDocumentHtml(processedHtml)
      } else {
        setDocumentHtml(`<p>Unsupported file type. <a href="${fileUrl}" target="_blank">Download file</a></p>`)
      }
    } catch (err) {
      console.error('Error loading document:', err)
      setDocumentHtml(`<p>Could not load document. <a href="${workbookData.fileUrl}" target="_blank">Download here</a></p>`)
    } finally {
      setProcessing(false)
    }
  }

  const saveAnswers = async (newAnswers) => {
    if (!sessionId) return
    setSaving(true)
    try {
      const sessionRef = doc(db, 'sessions', sessionId)
      await updateDoc(sessionRef, { answers: newAnswers, lastActive: new Date() })
      setLastSaved(new Date())
    } catch (err) {
      console.error('Error saving:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleDownload = async () => {
    if (!session || !workbook) return
    if (session.downloadCount >= session.downloadLimit) {
      setError(`Download limit reached (${session.downloadLimit}/${session.downloadLimit})`)
      return
    }

    try {
      // Grab the current rendered document HTML with answers already in the DOM
      const docEl = documentContainerRef.current?.querySelector(".html-viewer")
      if (!docEl) { setError("Nothing to print yet"); return }

      // Clone so we can clean up fillable styling for print
      const clone = docEl.cloneNode(true)

      // Replace fillable spans with their current text content, styled plainly
      clone.querySelectorAll(".fillable-text").forEach(span => {
        const value = span.textContent.trim()
        const placeholder = span.dataset.placeholder || "_______________"
        const isFilled = value && value !== placeholder
        const replacement = document.createElement("span")
        replacement.textContent = isFilled ? value : placeholder
        replacement.style.cssText = isFilled
          ? "border-bottom:1.5px solid #000;padding:0 4px;"
          : "border-bottom:1.5px solid #000;padding:0 4px;color:#aaa;"
        span.parentNode.replaceChild(replacement, span)
      })

      clone.querySelectorAll(".fillable-checkbox").forEach(span => {
        const checked = span.dataset.checked === "true"
        const replacement = document.createElement("span")
        replacement.textContent = checked ? "✓" : "☐"
        replacement.style.cssText = "font-size:1em;"
        span.parentNode.replaceChild(replacement, span)
      })

      clone.querySelectorAll(".fillable-radio").forEach(span => {
        const selected = span.dataset.selected === "true"
        const replacement = document.createElement("span")
        replacement.textContent = selected ? "●" : "○"
        replacement.style.cssText = "font-size:1em;"
        span.parentNode.replaceChild(replacement, span)
      })

      // Open a print window with the cleaned HTML
      const printWindow = window.open("", "_blank")
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${workbook.title}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: Arial, sans-serif; font-size: 11pt; color: #000; padding: 20mm; }
            h1, h2, h3, h4, h5, h6 { margin: 0.8em 0 0.4em; }
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
          ${clone.innerHTML}
        </body>
        </html>
      `)
      printWindow.document.close()
      printWindow.focus()

      // Wait for content to load then print
      printWindow.onload = () => {
        printWindow.print()
        printWindow.close()
      }
      // Fallback if onload doesnt fire
      setTimeout(() => {
        try { printWindow.print(); printWindow.close() } catch(e) {}
      }, 800)

      // Update download count in Firestore
      const sessionRef = doc(db, "sessions", sessionId)
      await updateDoc(sessionRef, { downloadCount: (session.downloadCount || 0) + 1 })

    } catch (err) {
      console.error("Error downloading:", err)
      setError("Failed to generate PDF")
    }
  }

  useEffect(() => {
    if (!documentContainerRef.current || !documentHtml || processing) return
    attachListeners(
      documentContainerRef.current,
      (fieldId, value) => handleFieldChangeRef.current(fieldId, value)
    )
    loadSavedAnswers(documentContainerRef.current, answers)
  }, [documentHtml, processing])

  if (loading) {
    return (
      <div>
        <Navbar />
        <div className="page-loader"><span className="spinner" /> Loading...</div>
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

  return (
    <div>
      <Navbar />
      <div className="session-page">
        <div className="session-header">
          <div className="container">
            <div className="header-content">
              <div>
                <h1>{workbook?.title}</h1>
                <p>Lecturer: {session?.lecturerName}</p>
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

        <div className="document-viewer-container">
          <div className="container">
            <div className="document-instructions">
              <p>💡 <strong>How to fill:</strong> Click on any blank (_____), empty table cell, checkbox (□), or radio (○) to fill. Everything saves automatically.</p>
            </div>
            <div className="document-viewer card" ref={documentContainerRef}>
              {processing ? (
                <div className="loading-document"><span className="spinner" /> Processing document...</div>
              ) : documentHtml ? (
                <div className="html-viewer" dangerouslySetInnerHTML={{ __html: documentHtml }} />
              ) : (
                <div className="empty-document">No document content</div>
              )}
            </div>
          </div>
        </div>

        <div className="session-footer">
          <div className="container">
            <div className="footer-content">
              <div>📝 {Object.keys(answers).length} answers saved</div>
              <button onClick={() => navigate('/student')} className="btn btn-ghost">← Back</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}