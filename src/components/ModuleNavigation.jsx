// src/components/ModuleNavigation.jsx
import React, { useState, useEffect } from 'react'
import './ModuleNavigation.css'

export default function ModuleNavigation({ 
  modules, 
  currentModule, 
  onModuleChange,
  moduleProgress = {},
  moduleStatus = {},
  nextAvailableModule = 1
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768
      setIsMobile(mobile)
      if (!mobile) {
        setIsOpen(false)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Auto-activate cover page on first load if it exists and nothing is selected yet
  useEffect(() => {
    if (modules.length === 0) return
    const coverModule = modules.find(m => m.isCover)
    if (coverModule && (currentModule === null || currentModule === undefined)) {
      onModuleChange(coverModule.moduleNumber ?? 0)
    }
  }, [modules])

  const handleModuleClick = (moduleNum) => {
    onModuleChange(moduleNum)
    if (isMobile) {
      setIsOpen(false)
    }
  }

  const toggleMenu = () => {
    setIsOpen(!isOpen)
  }

  // ── Get status display for module ──
  const getStatusDisplay = (moduleNum) => {
    const status = moduleStatus[moduleNum]?.status || 'not_started'
    
    switch(status) {
      case 'approved':
        return { icon: '✅', label: 'Approved', className: 'status-approved' }
      case 'pending':
        return { icon: '⏳', label: 'Pending', className: 'status-pending' }
      case 'revoked':
        return { icon: '❌', label: 'Revoked', className: 'status-revoked' }
      default:
        return { icon: '📝', label: 'Not Started', className: 'status-not-started' }
    }
  }

  const renderModuleItem = (module, index, mobile = false) => {
    const moduleNum = module.moduleNumber ?? module.moduleIndex ?? (index + 1)
    const label = module.isCover ? 'Cover Page' : (module.title || `Module ${moduleNum}`)
    const progress = moduleProgress[moduleNum] || 0
    const isActive = currentModule === moduleNum
    const isCompleted = progress === 100
    const status = getStatusDisplay(moduleNum)
    const moduleStatusValue = moduleStatus[moduleNum]?.status || 'not_started'
    
    // ── CHECK IF MODULE IS ACCESSIBLE ──
    // Module is accessible if:
    // 1. It's the cover page (module 0)
    // 2. It's already approved (can view approved modules in read-only) ✅
    // 3. It's the current module (always accessible)
    // 4. It's less than or equal to nextAvailableModule
    const isCover = module.isCover || moduleNum === 0
    const isApproved = moduleStatusValue === 'approved'
    const isCurrent = moduleNum === currentModule
    const isAccessible = isCover || isApproved || isCurrent || moduleNum <= nextAvailableModule
    
    // Module is clickable if it's accessible
    const isClickable = isAccessible
    
    // Determine if module is in read-only mode
    const isReadOnly = isApproved || moduleStatusValue === 'pending'
    
    return (
      <button
        key={index}
        className={`${mobile ? 'mobile-module-item' : 'module-item'} 
          ${isActive ? 'active' : ''} 
          ${isCompleted ? 'completed' : ''} 
          ${status.className} 
          ${!isClickable ? 'locked' : ''}
          ${isCover ? 'cover-item' : ''}
          ${isApproved ? 'approved-module' : ''}
          ${isReadOnly ? 'readonly-module' : ''}`}
        onClick={() => isClickable && handleModuleClick(moduleNum)}
        disabled={!isClickable}
        title={
          !isClickable 
            ? `Complete Module ${moduleNum - 1} first` 
            : isApproved 
              ? '📖 View approved module (read-only)' 
              : isReadOnly 
                ? '📖 Read-only - pending review'
                : ''
        }
      >
        <div className="module-info">
          <span className="module-number">
            {isCover ? '📄' : `Module ${moduleNum}`}
            {!isClickable && <span className="lock-icon">🔒</span>}
            {isApproved && <span className="readonly-icon">📖</span>}
            {isReadOnly && !isApproved && <span className="readonly-icon">📖</span>}
          </span>
          <span className="module-title">{label}</span>
        </div>
        <div className="module-status">
          <span className="status-badge" title={status.label}>
            {status.icon}
          </span>
          {!isCompleted && progress > 0 && (
            <div className="mini-progress">
              <div className="mini-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </button>
    )
  }

  // Desktop version
  if (!isMobile) {
    return (
      <div className="module-navigation desktop">
        <div className="module-nav-header">
          <h3>📚 Modules</h3>
          <span className="module-count">{modules.length} total</span>
        </div>
        <div className="module-list">
          {modules.map((module, index) => renderModuleItem(module, index, false))}
        </div>
        <div className="module-nav-footer">
          <div className="next-module-info">
            {nextAvailableModule <= modules.length ? (
              <span>Next: Module {nextAvailableModule}</span>
            ) : (
              <span>✅ All modules complete!</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Mobile version
  return (
    <>
      <button 
        className={`hamburger-btn ${isOpen ? 'active' : ''}`}
        onClick={toggleMenu}
        aria-label="Toggle module menu"
      >
        <span className="hamburger-line"></span>
        <span className="hamburger-line"></span>
        <span className="hamburger-line"></span>
        <span className="hamburger-label">Modules</span>
      </button>

      {isOpen && (
        <div className="nav-overlay" onClick={toggleMenu} />
      )}

      <div className={`mobile-nav-panel ${isOpen ? 'open' : ''}`}>
        <div className="mobile-nav-header">
          <h3>📚 Modules</h3>
          <button className="close-btn" onClick={toggleMenu}>✕</button>
        </div>
        <div className="mobile-module-list">
          {modules.map((module, index) => renderModuleItem(module, index, true))}
        </div>
        <div className="mobile-nav-footer">
          <div className="next-module-info">
            {nextAvailableModule <= modules.length ? (
              <span>Next: Module {nextAvailableModule}</span>
            ) : (
              <span>✅ All modules complete!</span>
            )}
          </div>
        </div>
      </div>
    </>
  )
}