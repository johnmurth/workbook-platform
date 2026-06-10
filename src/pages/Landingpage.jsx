// src/pages/LandingPage.jsx
import { Link } from 'react-router-dom'
import Navbar from '../components/shared/Navbar'
import './LandingPage.css'

export default function LandingPage() {
  return (
    <div className="landing">
      <Navbar />

      <section className="hero">
        <div className="hero-tag">Digital Workbook Platform</div>
        <h1 className="hero-title">
          Your workbooks,<br />
          <span className="hero-accent">filled online.</span>
        </h1>
        <p className="hero-sub">
          Lecturers upload workbooks. Students pay, fill them in online,
          and download their completed work — with real-time visibility for the lecturer.
        </p>
        <div className="hero-cta">
          <Link to="/register" className="btn btn-primary btn-lg">Get Started Free</Link>
          <Link to="/store"    className="btn btn-secondary btn-lg">Browse Workbooks</Link>
        </div>
      </section>

      <section className="features container">
        <div className="feature-card">
          <div className="feature-icon">🔒</div>
          <h3>Fully Private</h3>
          <p>Each student's workbook is a private channel — only that student and their lecturer can see it.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">👁️</div>
          <h3>Real-Time View</h3>
          <p>Lecturers watch students fill in their workbooks live, keystroke by keystroke.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">📥</div>
          <h3>Download Limits</h3>
          <p>Students get a configured number of downloads to export their completed work — no abuse.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">📄</div>
          <h3>Multiple Formats</h3>
          <p>Upload PDF, DOCX, PPTX, or images. Everything renders beautifully in the browser.</p>
        </div>
      </section>

      <footer className="landing-footer">
        <p>© 2024 WorkBook Platform — Built for educators.</p>
      </footer>
    </div>
  )
}