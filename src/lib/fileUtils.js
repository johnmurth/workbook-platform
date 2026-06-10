// src/lib/fileUtils.js

/**
 * Get a clean file type label from MIME type
 */
export const getFileTypeLabel = (mimeType) => {
  if (!mimeType) return 'Document'
  
  if (mimeType.includes('pdf')) return 'PDF'
  if (mimeType.includes('word') || mimeType.includes('document')) return 'DOCX'
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return 'PPTX'
  if (mimeType.includes('image')) return 'Image'
  if (mimeType.includes('text')) return 'Text'
  
  return 'File'
}

/**
 * Get a clean file icon from MIME type
 */
export const getFileIcon = (mimeType) => {
  if (!mimeType) return '📄'
  
  if (mimeType.includes('pdf')) return '📕'
  if (mimeType.includes('word') || mimeType.includes('document')) return '📘'
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📙'
  if (mimeType.includes('image')) return '🖼️'
  
  return '📄'
}

/**
 * Get full file type display (icon + label)
 */
export const getFileTypeDisplay = (mimeType) => {
  return `${getFileIcon(mimeType)} ${getFileTypeLabel(mimeType)}`
}