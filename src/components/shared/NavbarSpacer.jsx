// src/components/shared/NavbarSpacer.jsx
import { useState, useEffect, useRef } from 'react'

export default function NavbarSpacer() {
  const [navbarHeight, setNavbarHeight] = useState(64)
  const [isMobile, setIsMobile] = useState(false)
  const spacerRef = useRef(null)

  useEffect(() => {
    const updateHeight = () => {
      const navbar = document.querySelector('.navbar')
      if (navbar) {
        const height = navbar.offsetHeight
        const width = window.innerWidth
        const mobile = width <= 600
        
        setIsMobile(mobile)
        setNavbarHeight(height)
        
        if (spacerRef.current) {
          // Only apply spacer height on mobile where navbar wraps
          // Otherwise use default 64px (normal navbar height)
          spacerRef.current.style.height = mobile ? `${height}px` : `0px`
        }
      }
    }

    // Initial update
    updateHeight()
    
    // Update on resize
    window.addEventListener('resize', updateHeight)
    
    // Update when navbar content changes (login/logout)
    const observer = new MutationObserver(updateHeight)
    const navbar = document.querySelector('.navbar')
    if (navbar) {
      observer.observe(navbar, { childList: true, subtree: true, attributes: true })
    }

    return () => {
      window.removeEventListener('resize', updateHeight)
      observer.disconnect()
    }
  }, [])

  return <div ref={spacerRef} style={{ height: `0px`, flexShrink: 0, transition: 'height 0.2s ease' }} />
}