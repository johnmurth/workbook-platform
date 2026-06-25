// src/lib/documentProcessor.js

import { detectSections, splitIntoModules, extractFieldIds, renameSectionsToModules } from './moduleUtils'

// ============================================================
// MAMMOTH OPTIONS
// ============================================================
export const mammothOptions = {
  ignoreEmptyParagraphs: false,
}

// ============================================================
// INJECT SHAPE MARKERS INTO RAW XML BEFORE MAMMOTH CONVERTS
// ============================================================
const injectShapeMarkers = async (arrayBuffer) => {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(arrayBuffer)
  const xmlFile = zip.file('word/document.xml')
  if (!xmlFile) throw new Error('No document.xml found')

  let xmlText = await xmlFile.async('text')
  let markerId = 0

  xmlText = xmlText.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (paraBlock) => {
    const hasShape =
      paraBlock.includes('<w:pict') ||
      paraBlock.includes('<w:drawing') ||
      paraBlock.includes('<v:line') ||
      paraBlock.includes('<v:rect') ||
      paraBlock.includes('<v:shape') ||
      paraBlock.includes('<mc:AlternateContent')

    if (hasShape) {
      const id = markerId++
      return paraBlock.replace('</w:p>', `<w:r><w:t xml:space="preserve">SHAPELINE${id}END</w:t></w:r></w:p>`)
    }
    return paraBlock
  })

  console.log(`📐 Injected ${markerId} shape markers into XML`)

  zip.file('word/document.xml', xmlText)
  const modifiedBuffer = await zip.generateAsync({ type: 'arraybuffer' })
  return { modifiedBuffer, totalMarkers: markerId }
}

// ============================================================
// PROCESS DOCUMENT (returns processed HTML with fillable fields)
// ============================================================
export const processDocumentForFillable = async (arrayBuffer, onFieldChange) => {
  let fieldId = 0
  const fields = []

  // STEP 1: Inject markers
  const { modifiedBuffer, totalMarkers } = await injectShapeMarkers(arrayBuffer)

  // STEP 2: Convert with mammoth
  const mammoth = await import("mammoth")
  const result = await mammoth.convertToHtml({ arrayBuffer: modifiedBuffer }, {
    ...mammothOptions,
    convertImage: mammoth.images.imgElement(async (image) => {
      const buffer = await image.read("base64")
      return {
        src: `data:${image.contentType};base64,${buffer}`,
        style: "max-width:100%;height:auto;display:block;"
      }
    })
  })
  let html = result.value

  // Check how many markers survived
  const survived = (html.match(/SHAPELINE\d+END/g) || [])
  console.log(`🎯 Shape markers in HTML: ${survived.length} of ${totalMarkers}`)

  // STEP 3: Replace typed blanks FIRST (before DOM parsing)
  html = html.replace(/(_{3,}|-{3,}|\.{3,})/g, (match) => {
    const id = `text_${fieldId++}`
    fields.push({ id, type: 'text', original: match })
    const width = Math.max(80, match.length * 8)
    return `<span class="fillable-text" data-field-id="${id}" data-placeholder="${match}" contenteditable="true" role="textbox" style="display:inline-block;min-width:${width}px;background:#fef9e6;border-bottom:2px dotted #1a6b3c;padding:0 8px;color:#aaa;">${match}</span>`
  })

  // Checkboxes
  html = html.replace(/[☐□]/g, () => {
    const id = `checkbox_${fieldId++}`
    fields.push({ id, type: 'checkbox' })
    return `<span class="fillable-checkbox" data-field-id="${id}" data-checked="false" role="checkbox" aria-checked="false" tabindex="0" style="display:inline-block;width:24px;text-align:center;cursor:pointer;font-size:1.1em;user-select:none;">☐</span>`
  })

  // Radios
  html = html.replace(/[○◯]/g, () => {
    const id = `radio_${fieldId++}`
    fields.push({ id, type: 'radio' })
    return `<span class="fillable-radio" data-field-id="${id}" data-selected="false" role="radio" aria-checked="false" tabindex="0" style="display:inline-block;width:24px;text-align:center;cursor:pointer;font-size:1.1em;user-select:none;">○</span>`
  })

  // STEP 4: Parse into DOM then handle shape markers and table cells
  const container = document.createElement('div')
  container.innerHTML = html

  // Replace shape markers
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const markerNodes = []
  while (walker.nextNode()) {
    if (/SHAPELINE\d+END/.test(walker.currentNode.textContent)) {
      markerNodes.push(walker.currentNode)
    }
  }

  console.log(`🔧 Marker text nodes found in DOM: ${markerNodes.length}`)

  markerNodes.forEach(textNode => {
    const id = `line_${fieldId++}`
    fields.push({ id, type: 'text', original: 'line' })

    const input = document.createElement('span')
    input.className = 'fillable-text fillable-line'
    input.dataset.fieldId = id
    input.dataset.placeholder = '_______________'
    input.setAttribute('contenteditable', 'true')
    input.setAttribute('role', 'textbox')
    input.style.cssText = 'display:block;width:100%;background:#fef9e6;border-bottom:2px dotted #1a6b3c;padding:4px 8px;color:#aaa;box-sizing:border-box;'
    input.textContent = '_______________'

    const parentPara = textNode.parentElement?.closest('p')
    if (parentPara) {
      const hasImage = parentPara.querySelector('img')
      const textOnly = parentPara.textContent.trim().replace(/SHAPELINEd+END/g, '').trim()

      if (hasImage) {
        textNode.parentNode.removeChild(textNode)
        parentPara.insertAdjacentElement('afterend', input)
      } else if (!textOnly) {
        parentPara.innerHTML = ''
        parentPara.appendChild(input)
      } else {
        textNode.parentNode.replaceChild(input, textNode)
      }
    } else {
      textNode.parentNode.replaceChild(input, textNode)
    }
  })

  // Empty table cells
  container.querySelectorAll('table td').forEach(cell => {
    if (cell.querySelector('.fillable-text, .fillable-checkbox, .fillable-radio')) return
    const text = cell.textContent.replace(/\u00A0/g, '').replace(/\u200B/g, '').trim()
    if (!text || /^_{3,}$/.test(text)) {
      const id = `table_${fieldId++}`
      fields.push({ id, type: 'table-cell' })
      cell.innerHTML = ''
      const span = document.createElement('span')
      span.className = 'fillable-text'
      span.dataset.fieldId = id
      span.dataset.placeholder = '_______________'
      span.setAttribute('contenteditable', 'true')
      span.setAttribute('role', 'textbox')
      span.style.cssText = 'display:block;min-width:80px;width:100%;background:#fef9e6;padding:6px 8px;color:#aaa;box-sizing:border-box;'
      span.textContent = '_______________'
      cell.appendChild(span)
      cell.style.backgroundColor = '#fef9e6'
    }
  })

  // Step 5: Return full HTML and fields
  return { 
    html: container.innerHTML, 
    fields,
    sections: detectSections(container.innerHTML),
    allFieldIds: fields.map(f => f.id)
  }
}

// ============================================================
// Process document and split into modules
// ============================================================
export const processDocumentIntoModules = async (arrayBuffer) => {
  // First, process the document normally
  const { html, fields, sections } = await processDocumentForFillable(arrayBuffer, () => {})
  
  // Rename section headers to module headers
  const renamedHtml = renameSectionsToModules(html)
  
  // Split into modules (includes cover page as Module 0)
  const modules = splitIntoModules(renamedHtml, sections)
  
  // Add field IDs to each module
  modules.forEach(module => {
    module.fieldIds = extractFieldIds(module.content)
    module.totalFields = module.fieldIds.length
  })
  
  return {
    modules,
    totalModules: modules.length,
    allFieldIds: fields.map(f => f.id)
  }
}

// ============================================================
// ATTACH LISTENERS — call from SessionPage after React renders
// ============================================================
export const attachListeners = (container, onFieldChange) => {
  if (!container) return

  container.querySelectorAll(".fillable-checkbox").forEach(cb => {
    const fresh = cb.cloneNode(true)
    cb.parentNode.replaceChild(fresh, cb)

    const toggle = () => {
      const alreadyChecked = fresh.dataset.checked === "true"
      const group = fresh.closest("tr, p, li, td")
      const siblings = group ? [...group.querySelectorAll(".fillable-checkbox")] : []
      const isGrouped = siblings.length > 1

      if (isGrouped) {
        siblings.forEach(sib => {
          sib.dataset.checked = "false"
          sib.setAttribute("aria-checked", "false")
          sib.textContent = "☐"
          sib.style.color = ""
          onFieldChange(sib.dataset.fieldId, false)
        })
        if (!alreadyChecked) {
          fresh.dataset.checked = "true"
          fresh.setAttribute("aria-checked", "true")
          fresh.textContent = "✓"
          fresh.style.color = "#1a6b3c"
          onFieldChange(fresh.dataset.fieldId, true)
        }
      } else {
        const next = !alreadyChecked
        fresh.dataset.checked = String(next)
        fresh.setAttribute("aria-checked", String(next))
        fresh.textContent = next ? "✓" : "☐"
        fresh.style.color = next ? "#1a6b3c" : ""
        onFieldChange(fresh.dataset.fieldId, next)
      }
    }

    fresh.addEventListener("click", (e) => { e.stopPropagation(); toggle() })
    fresh.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle() } })
  })

  container.querySelectorAll('.fillable-radio').forEach(radio => {
    const fresh = radio.cloneNode(true)
    radio.parentNode.replaceChild(fresh, radio)
    fresh.addEventListener('click', (e) => {
      e.stopPropagation()
      const alreadySelected = fresh.dataset.selected === 'true'
      const group = fresh.closest('tr, p, li')
      if (group) {
        group.querySelectorAll('.fillable-radio').forEach(r => {
          r.dataset.selected = 'false'
          r.setAttribute('aria-checked', 'false')
          r.textContent = '○'
          r.style.color = ''
          onFieldChange(r.dataset.fieldId, false)
        })
      }
      if (!alreadySelected) {
        fresh.dataset.selected = 'true'
        fresh.setAttribute('aria-checked', 'true')
        fresh.textContent = '●'
        fresh.style.color = '#1a6b3c'
        onFieldChange(fresh.dataset.fieldId, true)
      }
    })
    fresh.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fresh.click() } })
  })

  container.querySelectorAll('.fillable-text').forEach(input => {
    const id = input.dataset.fieldId
    const placeholder = input.dataset.placeholder || '_______________'
    input.addEventListener('focus', () => {
      if (input.textContent === placeholder) {
        input.textContent = ''
        input.style.color = '#1a6b3c'
      }
    })
    input.addEventListener('blur', () => {
      if (!input.textContent.trim()) {
        input.textContent = placeholder
        input.style.color = '#aaa'
      }
      onFieldChange(id, input.textContent)
    })
    input.addEventListener('input', () => onFieldChange(id, input.textContent))
  })
}

// ============================================================
// LOAD SAVED ANSWERS
// ============================================================
export const loadSavedAnswers = (container, savedAnswers) => {
  if (!container || !savedAnswers) return
  Object.entries(savedAnswers).forEach(([fieldId, value]) => {
    const el = container.querySelector(`[data-field-id="${fieldId}"]`)
    if (!el) return
    if (el.classList.contains('fillable-checkbox')) {
      const checked = value === true || value === 'true'
      el.dataset.checked = String(checked)
      el.setAttribute('aria-checked', String(checked))
      el.textContent = checked ? '✓' : '☐'
      el.style.color = checked ? '#1a6b3c' : ''
    } else if (el.classList.contains('fillable-radio')) {
      if (value === true || value === 'true') {
        const group = el.closest('tr, p, li')
        if (group) {
          group.querySelectorAll('.fillable-radio').forEach(r => {
            r.dataset.selected = 'false'
            r.setAttribute('aria-checked', 'false')
            r.textContent = '○'
            r.style.color = ''
          })
        }
        el.dataset.selected = 'true'
        el.setAttribute('aria-checked', 'true')
        el.textContent = '●'
        el.style.color = '#1a6b3c'
      }
    } else {
      const placeholder = el.dataset.placeholder || '_______________'
      el.textContent = value || placeholder
      el.style.color = value ? '#1a6b3c' : '#aaa'
    }
  })
}