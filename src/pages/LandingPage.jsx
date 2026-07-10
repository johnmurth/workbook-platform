// src/pages/LandingPage.jsx
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import Navbar from '../components/shared/Navbar'
import './LandingPage.css'

// ── Flip this to false to restore the full original landing page ──
const SIMPLE_LANDING = true

export default function LandingPage() {
  const { user, profile } = useAuth()

  // ── Determine where the primary CTA should send a logged-in user ──
  const dashboardPath = profile?.role === 'lecturer' ? '/lecturer' : '/student'

  // ══════════════════════════════════════════════════════════════
  // SIMPLE MODE: title + CTAs only, navbar kept
  // ══════════════════════════════════════════════════════════════
  if (SIMPLE_LANDING) {
    return (
      <div className="landing">
        <Navbar />
        <section
          className="hero"
          style={{
            minHeight: 'calc(100vh - 72px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div className="hero-deco">
            <span></span><span></span>
            <span></span><span></span>
            <span></span><span></span>
          </div>
          <div className="hero-inner" style={{ textAlign: 'center' }}>
            <div className="hero-tag" style={{ margin: '0 auto 24px' }}>
              <i className="ti ti-school" aria-hidden="true"></i>
              Academic Workbook Platform
            </div>
            <h1 className="hero-title">
              Course materials,<br />
              <em>Delivery</em> & 
              <em> Assessment</em>
            </h1>
            <p className="hero-sub" style={{ margin: '0 auto' }}>
              {user
                ? 'Pick up right where you left off.'
                : 'Sign in to continue, or request access to get started.'}
            </p>
            <div className="hero-cta" style={{ marginTop: '32px', justifyContent: 'center' }}>
              {user ? (
                <Link to={dashboardPath} className="btn btn-primary btn-lg">
                  <i className="ti ti-arrow-right" aria-hidden="true"></i>
                  Go to dashboard
                </Link>
              ) : (
                <>
                  <Link to="/login" className="btn btn-secondary btn-lg">
                    Login
                  </Link>
                  <Link to="/register" className="btn btn-primary btn-lg">
                    <i className="ti ti-arrow-right" aria-hidden="true"></i>
                    Register
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════
  // FULL MODE: original layout
  // ══════════════════════════════════════════════════════════════
  return (
    <div className="landing">
      <Navbar />

      {/* HERO SECTION */}
      <section className="hero">
        <div className="hero-deco">
          <span></span><span></span>
          <span></span><span></span>
          <span></span><span></span>
        </div>
        <div className="hero-inner">
          <div className="hero-tag">
            <i className="ti ti-school" aria-hidden="true"></i>
            Academic Workbook Platform
          </div>
          <h1 className="hero-title">
            Course materials,<br />
            <em>Delivery</em> & <br />
            <em>Assessment</em>
          </h1>
          <p className="hero-sub">
            WorkBook enables lecturers to distribute interactive course workbooks, 
            monitor student progress in real time, and maintain full academic oversight 
            from a single, secure platform.
          </p>
          <div className="hero-cta">
            {user ? (
              <Link to={dashboardPath} className="btn btn-primary btn-lg">
                <i className="ti ti-arrow-right" aria-hidden="true"></i>
                Go to dashboard
              </Link>
            ) : (
              <Link to="/register" className="btn btn-primary btn-lg">
                <i className="ti ti-arrow-right" aria-hidden="true"></i>
                Request access
              </Link>
            )}
            <Link to="/store" className="btn btn-secondary btn-lg">
              Browse catalogue
            </Link>
          </div>
        </div>
      </section>

      {/* STATS STRIP */}
      <div className="landing-stats">
        <div className="landing-stat-item">
          <div className="landing-stat-number">100%</div>
          <div className="landing-stat-label">End-to-end private per student</div>
        </div>
        <div className="landing-stat-item">
          <div className="landing-stat-number">Live</div>
          <div className="landing-stat-label">Real-time submission visibility</div>
        </div>
        <div className="landing-stat-item">
          <div className="landing-stat-number">4+</div>
          <div className="landing-stat-label">Supported document formats</div>
        </div>
      </div>

      {/* FEATURES SECTION */}
      <section className="features-section">
        <div className="features-header">
          <div className="section-eyebrow">Platform capabilities</div>
          <h2 className="section-title">Built for rigorous academic environments</h2>
        </div>
        <div className="features">
          <div className="feature-card">
            <div className="feature-icon">
              <i className="ti ti-shield-lock" aria-hidden="true"></i>
            </div>
            <h3>Isolated student workspaces</h3>
            <p>Each enrolled student receives a private, access-controlled workbook instance. Submissions are visible exclusively to the student and the supervising lecturer.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <i className="ti ti-activity" aria-hidden="true"></i>
            </div>
            <h3>Live submission monitoring</h3>
            <p>Lecturers gain uninterrupted visibility into student responses as they are entered, enabling timely pedagogical intervention and academic integrity assurance.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <i className="ti ti-cloud-download" aria-hidden="true"></i>
            </div>
            <h3>Controlled export access</h3>
            <p>Download permissions are configured per workbook, limiting the number of exports a student may generate and preventing unauthorised redistribution of completed work.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <i className="ti ti-files" aria-hidden="true"></i>
            </div>
            <h3>Multi-format document support</h3>
            <p>Upload materials in PDF, DOCX, PPTX, or image formats. All content is rendered faithfully within the browser, requiring no additional software on the student side.</p>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS SECTION */}
      <section className="how-section">
        <div className="how-title-block">
          <div className="section-eyebrow">Workflow</div>
          <h2 className="how-title">How it works</h2>
        </div>
        <div className="steps-list">
          <div className="step-item">
            <div className="step-num">1</div>
            <div className="step-body">
              <h4>Lecturer uploads a workbook</h4>
              <p>Course materials in any supported format are uploaded and configured with access rules, download limits, and pricing.</p>
            </div>
          </div>
          <div className="step-item">
            <div className="step-num">2</div>
            <div className="step-body">
              <h4>Student enrols and pays</h4>
              <p>Students browse the course catalogue, complete a secure payment, and are granted immediate access to their private workbook instance.</p>
            </div>
          </div>
          <div className="step-item">
            <div className="step-num">3</div>
            <div className="step-body">
              <h4>Student completes the workbook online</h4>
              <p>Responses are entered directly in the browser. The lecturer's dashboard reflects changes in real time throughout the session.</p>
            </div>
          </div>
          <div className="step-item">
            <div className="step-num">4</div>
            <div className="step-body">
              <h4>Student exports their completed work</h4>
              <p>Upon completion, the student downloads a formatted copy of their submission within the permitted export quota.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="landing-footer">
        <p>© 2025 WorkBook Platform — Designed for educators.</p>
        <div className="footer-links">
          <a href="#">Privacy policy</a>
          <a href="#">Terms of use</a>
          <a href="#">Support</a>
        </div>
      </footer>
    </div>
  )
}