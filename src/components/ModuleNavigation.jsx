// src/components/ModuleNavigation.jsx
import React, { useState, useEffect } from 'react'
import './ModuleNavigation.css'

export default function ModuleNavigation({ 
  modules, 
  currentModule, 
  onModuleChange,
  moduleProgress = {}
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

  const renderModuleItem = (module, index, mobile = false) => {
    const moduleNum = module.moduleNumber ?? module.moduleIndex ?? (index + 1)
    const label = module.isCover ? 'Cover Page' : (module.title || `Module ${moduleNum}`)
    const progress = moduleProgress[moduleNum] || 0
    const isActive = currentModule === moduleNum
    const isCompleted = progress === 100

    return (
      <button
        key={index}
        className={`${mobile ? 'mobile-module-item' : 'module-item'} ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
        onClick={() => handleModuleClick(moduleNum)}
      >
        <div className="module-info">
          <span className="module-number">
            {module.isCover ? '📄' : `Module ${moduleNum}`}
          </span>
          <span className="module-title">{label}</span>
        </div>
        <div className="module-status">
          {isCompleted && <span className="checkmark">✓</span>}
          {!isCompleted && progress > 0 && (
            <div className="mini-progress">
              <div className="mini-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
          {progress === 0 && <span className="status-dot">○</span>}
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
      </div>
    </>
  )
}