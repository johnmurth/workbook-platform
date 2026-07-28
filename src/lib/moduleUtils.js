/**
 * Detect section headers in document HTML
 * Matches patterns like: "SECTION 1:", "SECTION 2:", etc.
 * Case-sensitive: only matches literal uppercase "SECTION"
 */
export const detectSections = (html) => {
  const sectionRegex = /SECTION\s+(\d+):\s*([^<]*?)(?=<|$)/g
  const sections = []
  let match

  while ((match = sectionRegex.exec(html)) !== null) {
    sections.push({
      number: parseInt(match[1]),
      title: match[2].trim(),
      index: match.index,
      length: match[0].length
    })
  }

  return sections
}

/**
 * Split HTML content into modules based on section headers
 * NOW INCLUDES COVER PAGE as Module 0
 */
export const splitIntoModules = (html, sections) => {
  if (sections.length === 0) {
    // No sections found - treat entire document as one module
    return [{
      number: 1,
      title: 'Module 1',
      content: html,
      fieldIds: extractFieldIds(html),
      isCover: false
    }]
  }

  const modules = []
  
  // ── STEP 1: Extract cover page (content before first section) ──
  const firstSection = sections[0]
  if (firstSection.index > 0) {
    const coverContent = html.substring(0, firstSection.index).trim()
    if (coverContent) {
      modules.push({
        number: 0,
        title: 'Cover Page',
        content: coverContent,
        fieldIds: extractFieldIds(coverContent),
        isCover: true
      })
    }
  }
  
  // ── STEP 2: Process each section as a module ──
  for (let i = 0; i < sections.length; i++) {
    const current = sections[i]
    const next = sections[i + 1]
    
    // Extract content from current section to before next section
    const startIdx = current.index + current.length
    const endIdx = next ? next.index : html.length
    
    let content = html.substring(startIdx, endIdx).trim()
    
    // Remove the "SECTION X:" header from the content itself
    const contentWithoutHeader = content.replace(/^SECTION\s+\d+:\s*[^<]*?(?=<|$)/, '').trim()
    
    modules.push({
      number: current.number,
      title: current.title,
      content: contentWithoutHeader || content,
      fieldIds: extractFieldIds(content),
      isCover: false
    })
  }

  return modules
}

/**
 * Extract all fillable field IDs from HTML content
 */
export const extractFieldIds = (html) => {
  const fieldIds = []
  const regex = /data-field-id="([^"]+)"/g
  let match
  
  while ((match = regex.exec(html)) !== null) {
    fieldIds.push(match[1])
  }
  
  return fieldIds
}

/**
 * Calculate progress for a module based on answers
 */
export const calculateModuleProgress = (moduleFields, answers) => {
  if (!moduleFields || moduleFields.length === 0) return 0
  
  const totalFields = moduleFields.length
  let answeredFields = 0
  
  moduleFields.forEach(fieldId => {
    if (answers && answers[fieldId] !== undefined && answers[fieldId] !== null && answers[fieldId] !== '') {
      answeredFields++
    }
  })
  
  return Math.round((answeredFields / totalFields) * 100)
}

/**
 * Group field IDs by module
 */
export const groupFieldsByModule = (modules) => {
  const fieldMap = {}
  modules.forEach(module => {
    module.fieldIds.forEach(fieldId => {
      fieldMap[fieldId] = module.number
    })
  })
  return fieldMap
}

/**
 * Rename section headers to module headers in HTML
 * Case-sensitive: only matches literal uppercase "SECTION"
 */
export const renameSectionsToModules = (html) => {
  return html.replace(/SECTION\s+(\d+):/g, (match, num) => {
    return `Module ${num}:`
  })
}