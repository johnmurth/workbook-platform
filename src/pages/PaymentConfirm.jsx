// src/pages/PaymentConfirm.jsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import Navbar from '../components/shared/Navbar'
import './PaymentConfirm.css'

export default function PaymentConfirm() {
  const { user, profile } = useAuth()
  const [purchases, setPurchases] = useState([])
  const [workbooks, setWorkbooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [dateRange, setDateRange] = useState('all')

  useEffect(() => {
    if (user) {
      fetchData()
    }
  }, [user])

  const fetchData = async () => {
    try {
      // Fetch lecturer's workbooks
      const workbooksQuery = query(
        collection(db, 'workbooks'),
        where('lecturerUid', '==', user.uid),
        orderBy('createdAt', 'desc')
      )
      const workbooksSnap = await getDocs(workbooksQuery)
      const workbooksList = workbooksSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      setWorkbooks(workbooksList)

      // Fetch all purchases for lecturer's workbooks
      const purchasesQuery = query(
        collection(db, 'WBpurchases'),
        where('lecturerUid', '==', user.uid),
        orderBy('purchaseDate', 'desc')
      )
      const purchasesSnap = await getDocs(purchasesQuery)
      const purchasesList = purchasesSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      setPurchases(purchasesList)

    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Filter purchases
  const getFilteredPurchases = () => {
    let filtered = [...purchases]

    if (filter !== 'all') {
      filtered = filtered.filter(p => p.workbookId === filter)
    }

    if (dateRange !== 'all') {
      const now = new Date()
      const startDate = new Date()
      
      switch(dateRange) {
        case 'week':
          startDate.setDate(now.getDate() - 7)
          break
        case 'month':
          startDate.setMonth(now.getMonth() - 1)
          break
        case 'quarter':
          startDate.setMonth(now.getMonth() - 3)
          break
        default:
          break
      }
      
      filtered = filtered.filter(p => {
        const purchaseDate = p.purchaseDate?.toDate?.() || new Date(p.purchaseDate)
        return purchaseDate >= startDate
      })
    }

    return filtered
  }

  const getTotalEarnings = () => {
    return getFilteredPurchases().reduce((sum, p) => sum + (p.price || 0), 0)
  }

  const getTotalPurchases = () => {
    return getFilteredPurchases().length
  }

  const getWorkbookEarnings = (workbookId) => {
    return purchases
      .filter(p => p.workbookId === workbookId)
      .reduce((sum, p) => sum + (p.price || 0), 0)
  }

  const getWorkbookPurchases = (workbookId) => {
    return purchases.filter(p => p.workbookId === workbookId).length
  }

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown'
    const date = timestamp.toDate?.() || new Date(timestamp)
    return date.toLocaleDateString('en-KE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const earnings = getTotalEarnings()
  const purchaseCount = getTotalPurchases()
  const filteredPurchases = getFilteredPurchases()

  if (loading) {
    return (
      <div>
        <Navbar />
        <div className="page-loader">
          <span className="spinner" /> Loading earnings data...
        </div>
      </div>
    )
  }

  return (
    <div>
      <Navbar />
      <div className="payment-confirm-page">
        <div className="container">
          <div className="page-header">
            <div>
              <h1>💰 Earnings & Payments</h1>
              <p>Track your workbook sales and manage payouts</p>
            </div>
            <Link to="/lecturer" className="btn btn-secondary">
              ← Back to Dashboard
            </Link>
          </div>

          {/* Stats Overview */}
          <div className="stats-overview">
            <div className="stat-card card">
              <div className="stat-icon">💰</div>
              <div className="stat-info">
                <span className="stat-label">Total Earnings</span>
                <span className="stat-value">KES {earnings.toLocaleString()}</span>
              </div>
            </div>
            <div className="stat-card card">
              <div className="stat-icon">📚</div>
              <div className="stat-info">
                <span className="stat-label">Total Sales</span>
                <span className="stat-value">{purchaseCount}</span>
              </div>
            </div>
            <div className="stat-card card">
              <div className="stat-icon">👥</div>
              <div className="stat-info">
                <span className="stat-label">Unique Students</span>
                <span className="stat-value">{new Set(purchases.map(p => p.studentUid)).size}</span>
              </div>
            </div>
            <div className="stat-card card">
              <div className="stat-icon">📊</div>
              <div className="stat-info">
                <span className="stat-label">Workbooks Sold</span>
                <span className="stat-value">{workbooks.filter(w => getWorkbookPurchases(w.id) > 0).length}</span>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="filters-section card">
            <div className="filter-group">
              <label>Workbook</label>
              <select 
                className="form-control"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All Workbooks</option>
                {workbooks.map(wb => (
                  <option key={wb.id} value={wb.id}>
                    {wb.title} ({getWorkbookPurchases(wb.id)} sales)
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Date Range</label>
              <select 
                className="form-control"
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
              >
                <option value="all">All Time</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last 30 Days</option>
                <option value="quarter">Last 90 Days</option>
              </select>
            </div>
          </div>

          {/* Workbook Performance Table */}
          <div className="performance-section">
            <h2>📊 Workbook Performance</h2>
            <div className="performance-table card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Workbook Title</th>
                    <th>Price</th>
                    <th>Sales</th>
                    <th>Revenue</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {workbooks.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="empty-row">
                        No workbooks uploaded yet
                      </td>
                    </tr>
                  ) : (
                    workbooks.map(wb => {
                      const sales = getWorkbookPurchases(wb.id)
                      const revenue = getWorkbookEarnings(wb.id)
                      return (
                        <tr key={wb.id}>
                          <td className="workbook-title-cell">
                            <div className="workbook-title">{wb.title}</div>
                            <div className="workbook-id">ID: {wb.id.slice(0, 8)}...</div>
                          </td>
                          <td>KES {wb.price?.toLocaleString()}</td>
                          <td>{sales}</td>
                          <td className="revenue-cell">KES {revenue.toLocaleString()}</td>
                          <td>
                            <Link to={`/lecturer/workbook/${wb.id}/edit`} className="btn-link">
                              Edit
                            </Link>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
                {workbooks.length > 0 && (
                  <tfoot>
                    <tr className="total-row">
                      <td><strong>Total</strong></td>
                      <td></td>
                      <td><strong>{purchaseCount}</strong></td>
                      <td><strong>KES {earnings.toLocaleString()}</strong></td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="transactions-section">
            <h2>📋 Recent Transactions</h2>
            {filteredPurchases.length === 0 ? (
              <div className="empty-state card">
                <div className="empty-icon">🛒</div>
                <h3>No transactions yet</h3>
                <p>When students purchase your workbooks, they'll appear here</p>
              </div>
            ) : (
              <div className="transactions-list">
                {filteredPurchases.slice(0, 20).map(purchase => (
                  <div key={purchase.id} className="transaction-item card">
                    <div className="transaction-main">
                      <div className="transaction-icon">🎓</div>
                      <div className="transaction-details">
                        <div className="transaction-title">{purchase.workbookTitle}</div>
                        <div className="transaction-meta">
                          <span>Student: {purchase.studentName}</span>
                          <span>Date: {formatDate(purchase.purchaseDate)}</span>
                        </div>
                      </div>
                      <div className="transaction-amount">
                        <span className="amount">+KES {purchase.price?.toLocaleString()}</span>
                        <span className="badge badge-green">Completed</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payout Info */}
          <div className="payout-info card">
            <div className="payout-header">
              <h3>💸 Withdrawal Information</h3>
              <button className="btn btn-primary" disabled>
                Request Payout (Coming Soon)
              </button>
            </div>
            <div className="payout-content">
              <p>Minimum payout: KES 1,000</p>
              <p>Processing time: 3-5 business days</p>
              <p>Available methods: M-Pesa, Bank Transfer (Coming soon)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}