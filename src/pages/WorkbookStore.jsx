// src/pages/WorkbookStore.jsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import Navbar from '../components/shared/Navbar'
import './WorkbookStore.css'
import { getFileIcon, getFileTypeLabel } from '../lib/fileUtils'

export default function WorkbookStore() {
  const { user } = useAuth()
  const [workbooks, setWorkbooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [priceRange, setPriceRange] = useState('all')
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')

    const q = query(
      collection(db, 'workbooks'),
      where('active', '==', true),
      orderBy('createdAt', 'desc')
    )

    const unsub = onSnapshot(
      q,
      snap => {
        const workbookList = snap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          // Exclude soft-deleted workbooks — 'active' alone doesn't cover this
          .filter(wb => !wb.isDeleted)

        setWorkbooks(workbookList)
        setLoading(false)
      },
      err => {
        console.error('Error fetching workbooks:', err)
        setError('Failed to load workbooks. Please refresh the page.')
        setLoading(false)
      }
    )

    return unsub
  }, [])

  const filteredWorkbooks = workbooks.filter(wb => {
    const matchesSearch = wb.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          wb.lecturerName?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesPrice = priceRange === 'all' ||
                        (priceRange === 'free' && wb.price === 0) ||
                        (priceRange === 'under500' && wb.price < 500) ||
                        (priceRange === '500to1000' && wb.price >= 500 && wb.price <= 1000) ||
                        (priceRange === 'over1000' && wb.price > 1000)
    return matchesSearch && matchesPrice
  })

  const getFileIcon = (fileType) => {
    if (fileType?.includes('pdf')) return '📕'
    if (fileType?.includes('word') || fileType?.includes('document')) return '📘'
    if (fileType?.includes('powerpoint') || fileType?.includes('presentation')) return '📙'
    if (fileType?.includes('image')) return '🖼️'
    return '📄'
  }

  return (
    <div>
      <Navbar />
      <div className="store-page">
        <div className="container">
          <div className="store-header">
            <h1>Workbook Store</h1>
            <p>Discover quality educational content from expert lecturers</p>
          </div>

          {error && <div className="error-msg">{error}</div>}

          {/* Search and Filters */}
          <div className="store-filters">
            <div className="search-bar">
              <input 
                type="text" 
                className="form-control"
                placeholder="🔍 Search by title or lecturer..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="filter-group">
              <select 
                className="form-control"
                value={priceRange}
                onChange={(e) => setPriceRange(e.target.value)}
              >
                <option value="all">All Prices</option>
                <option value="free">Free</option>
                <option value="under500">Under KES 500</option>
                <option value="500to1000">KES 500 - 1,000</option>
                <option value="over1000">Over KES 1,000</option>
              </select>
            </div>
          </div>

          {/* Results Count */}
          <div className="results-count">
            {filteredWorkbooks.length} workbook{filteredWorkbooks.length !== 1 ? 's' : ''} found
          </div>

          {/* Workbooks Grid */}
          {loading ? (
            <div className="page-loader">
              <span className="spinner" /> Loading workbooks...
            </div>
          ) : filteredWorkbooks.length === 0 ? (
            <div className="empty-state card">
              <div className="empty-icon">📚</div>
              <h3>No workbooks found</h3>
              <p>Try adjusting your search or filters</p>
            </div>
          ) : (
            <div className="workbooks-grid">
              {filteredWorkbooks.map(wb => (
                <div key={wb.id} className="workbook-card card">
                  <div className="workbook-badge">
                    <span className="badge">{getFileIcon(wb.fileType)} {getFileTypeLabel(wb.fileType)}</span>
                    {wb.price === 0 && <span className="badge badge-green">Free</span>}
                  </div>
                  
                  <h3 className="workbook-title">{wb.title}</h3>
                  <p className="workbook-description">{wb.description || 'No description provided'}</p>
                  
                  <div className="workbook-meta">
                    <div className="lecturer-info">
                      <span className="lecturer-icon">👨‍🏫</span>
                      <span>{wb.lecturerName || 'Unknown Lecturer'}</span>
                    </div>
                    <div className="purchase-count">
                      <span>🎓 {wb.totalPurchases || 0} purchased</span>
                    </div>
                  </div>
                  
                  <div className="workbook-price">
                    {wb.price === 0 ? 'Free' : `KES ${wb.price.toLocaleString()}`}
                  </div>
                  
                  <Link 
                    to={user ? `/pay/${wb.id}` : '/login'} 
                    className="btn btn-primary purchase-btn"
                  >
                    {user ? 'Purchase Now →' : 'Login to Purchase'}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}