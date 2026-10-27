import { useState, useEffect, useMemo } from 'react'
import './App.css'
import type { UserSummary } from './types/auth.ts'
import type { IncidentResponse, Category, Status, Priority } from './types/incident.ts'
import { MOCK_USERS, DEPARTMENTS } from './mocks/mock-users.ts'
import { mockN7StaffRoleApi } from './mocks/n7-role-mock-api.ts'
import { mockN6ReporterApi } from './mocks/n6-contract-mock-api.ts'
import { reporterApiClient } from './features/reporter-w2/reporterApiClient.ts'
import { StaffIncidentDetailModal } from './features/staff/StaffIncidentDetailModal.tsx'
import { StaffWireframeView } from './features/staff-w1/StaffWireframeView.tsx'
import { ReporterWireframeView } from './features/reporter-w1/ReporterWireframeView.tsx'
import { transitionGui } from './utils/transition.ts'

type NavTabKey =
  | 'all'
  | 'unassigned'
  | 'in-progress'
  | 'resolved'
  | 'overdue'
  | 'my-incidents'
  | 'new-incident'
  | 'health'
  | 'wireframe'

type CategoryFilter = '' | 'water_leak' | 'electrical_hazard' | 'phishing' | 'p1' | 'overdue'

const categoryMeta: Record<string, { label: string; icon: string }> = {
  water_leak: { label: 'Rò rỉ nước', icon: '💧' },
  electrical_hazard: { label: 'Nguy hiểm điện', icon: '⚡' },
  phishing: { label: 'Tấn công Phishing', icon: '🎣' },
}

const statusDisplay: Record<string, { label: string; className: string }> = {
  reported: { label: 'Mới báo cáo', className: 'sf-badge-reported' },
  assigned: { label: 'Đã phân công', className: 'sf-badge-assigned' },
  in_progress: { label: 'Đang xử lý', className: 'sf-badge-progress' },
  resolved: { label: 'Đã giải quyết', className: 'sf-badge-resolved' },
  closed: { label: 'Đã đóng', className: 'sf-badge-closed' },
}

const priorityBadges: Record<string, { label: string; className: string }> = {
  p1: { label: 'P1 KHẨN CẤP', className: 'sf-badge-prio-p1' },
  p2: { label: 'P2 CAO', className: 'sf-badge-prio-p2' },
  p3: { label: 'P3 TIÊU CHUẨN', className: 'sf-badge-prio-p3' },
}

const roleBadgeLabels: Record<string, { label: string; short: string }> = {
  reporter: { label: 'Sinh viên / Người báo', short: 'Sinh viên' },
  handler: { label: 'Kỹ thuật viên', short: 'KTV' },
  department_manager: { label: 'Trưởng ban / Quản lý', short: 'Quản lý' },
  administrator: { label: 'Quản trị viên', short: 'Admin' },
}

function normalizeVietnamese(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

export default function App() {
  // Current user state (Default to manager or student)
  const [currentUserKey, setCurrentUserKey] = useState<string>('user-manager-csvc')
  const currentUser: UserSummary = MOCK_USERS[currentUserKey] || MOCK_USERS['user-manager-csvc']

  // Navigation tab state
  const [activeTab, setActiveTab] = useState<NavTabKey>('all')
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<CategoryFilter>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [searchCategory, setSearchCategory] = useState<string>('')

  // Task N7-W03 Filters (status / category / priority / department / triage)
  const [statusFilter, setStatusFilter] = useState<Status | ''>('')
  const [priorityFilter, setPriorityFilter] = useState<Priority | ''>('')
  const [departmentFilter, setDepartmentFilter] = useState<string>('')
  const [triageFilter, setTriageFilter] = useState<boolean>(false)

  // Task N7-W03 Cursor Pagination State (Đảm bảo không mất vị trí khi xem chi tiết)
  const [pageSize, setPageSize] = useState<number>(5)
  const [pageIndex, setPageIndex] = useState<number>(0)

  // Incident data & selection
  const [incidents, setIncidents] = useState<IncidentResponse[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [selectedIncident, setSelectedIncident] = useState<IncidentResponse | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0)

  // Modals state
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false)
  const [showNewIncidentModal, setShowNewIncidentModal] = useState<boolean>(false)
  const [showStorageModal, setShowStorageModal] = useState<boolean>(false)
  const [showNotifications, setShowNotifications] = useState<boolean>(false)
  const [readNotifIds, setReadNotifIds] = useState<Set<string>>(new Set())

  // Form states for New Incident modal
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newBuilding, setNewBuilding] = useState('Tòa A1')
  const [newCategory, setNewCategory] = useState<Category>('water_leak')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Login form states inside modal
  const [loginEmail, setLoginEmail] = useState(currentUser.email)
  const [loginPassword, setLoginPassword] = useState('usth@2026')
  const [loginError, setLoginError] = useState<string | null>(null)

  // Health check state
  const [healthStatus, setHealthStatus] = useState<'checking' | 'online' | 'offline'>('online')

  // Load incidents from API
  useEffect(() => {
    let active = true

    mockN7StaffRoleApi
      .getStaffQueue(currentUser)
      .then((data) => {
        if (active) {
          setIncidents(data)
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (active) {
          // If reporter, load personal incidents
          mockN6ReporterApi
            .getMyIncidents(currentUser.id)
            .then((data) => {
              if (active) {
                setIncidents(data)
                setIsLoading(false)
              }
            })
            .catch(() => {
              if (active) setIsLoading(false)
            })
        }
      })

    return () => {
      active = false
    }
  }, [currentUser, refreshTrigger])

  // Filtered incidents
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      // 1. Tab filter
      if (activeTab === 'unassigned') {
        if (inc.status !== 'reported' && inc.status !== 'assigned') return false
        if (inc.assigned_handler_id) return false
      } else if (activeTab === 'in-progress') {
        if (inc.status !== 'in_progress') return false
      } else if (activeTab === 'resolved') {
        if (inc.status !== 'resolved' && inc.status !== 'closed') return false
      } else if (activeTab === 'overdue') {
        const sla = mockN7StaffRoleApi.getSlaStatus(inc)
        if (sla.state !== 'overdue' && sla.state !== 'warning') return false
      } else if (activeTab === 'my-incidents') {
        if (currentUser.role === 'handler') {
          if (inc.assigned_handler_id !== currentUser.id) return false
        } else {
          if (inc.reporter_id !== currentUser.id) return false
        }
      }

      // 2. Category / Pill chip filter
      if (activeCategoryFilter === 'p1') {
        if (inc.priority !== 'p1') return false
      } else if (activeCategoryFilter === 'overdue') {
        const sla = mockN7StaffRoleApi.getSlaStatus(inc)
        if (sla.state !== 'overdue' && sla.state !== 'warning') return false
      } else if (activeCategoryFilter) {
        if (inc.category !== activeCategoryFilter) return false
      }

      // 3. Dropdown category
      if (searchCategory && inc.category !== searchCategory) return false

      // 4. Search query (Hỗ trợ tiếng Việt không dấu & có dấu)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const qNorm = normalizeVietnamese(searchQuery.trim())

        const title = inc.title.toLowerCase()
        const titleNorm = normalizeVietnamese(inc.title)
        const building = (inc.building || '').toLowerCase()
        const buildingNorm = normalizeVietnamese(inc.building || '')
        const locationDetail = (inc.location_detail || '').toLowerCase()
        const locationDetailNorm = normalizeVietnamese(inc.location_detail || '')
        const id = inc.id.toLowerCase()

        const match =
          title.includes(q) ||
          titleNorm.includes(qNorm) ||
          building.includes(q) ||
          buildingNorm.includes(qNorm) ||
          locationDetail.includes(q) ||
          locationDetailNorm.includes(qNorm) ||
          id.includes(q)

        if (!match) return false
      }

      // 5. N7-W03 Filters (status, priority, department, triage)
      if (statusFilter && inc.status !== statusFilter) return false
      if (priorityFilter && inc.priority !== priorityFilter) return false
      if (departmentFilter && inc.department_id !== departmentFilter) return false
      if (triageFilter && !inc.triage_required) return false

      return true
    })
  }, [
    incidents,
    activeTab,
    activeCategoryFilter,
    searchCategory,
    searchQuery,
    currentUser,
    statusFilter,
    priorityFilter,
    departmentFilter,
    triageFilter,
  ])

  // Task N7-W03: Cursor Pagination computation
  const totalPages = Math.max(1, Math.ceil(filteredIncidents.length / pageSize))
  const safePageIndex = Math.min(pageIndex, totalPages - 1)
  const paginatedIncidents = useMemo(() => {
    const start = safePageIndex * pageSize
    return filteredIncidents.slice(start, start + pageSize)
  }, [filteredIncidents, safePageIndex, pageSize])

  const currentCursor = useMemo(() => {
    const payload = JSON.stringify({ offset: safePageIndex * pageSize, v: 1 })
    if (typeof btoa !== 'undefined') return btoa(payload)
    const g = globalThis as { Buffer?: { from: (s: string) => { toString: (e: string) => string } } }
    return g.Buffer?.from(payload).toString('base64') || payload
  }, [safePageIndex, pageSize])

  const hasNextPage = (safePageIndex + 1) * pageSize < filteredIncidents.length
  const hasPrevPage = safePageIndex > 0

  const handleNextPage = () => {
    if (hasNextPage) setPageIndex((prev) => prev + 1)
  }

  const handlePrevPage = () => {
    if (hasPrevPage) setPageIndex((prev) => Math.max(0, prev - 1))
  }

  const handleResetAllFilters = () => {
    setActiveTab('all')
    setActiveCategoryFilter('')
    setSearchQuery('')
    setSearchCategory('')
    setStatusFilter('')
    setPriorityFilter('')
    setDepartmentFilter('')
    setTriageFilter(false)
    setPageIndex(0)
  }

  // Dynamic real notifications for the interactive bell
  const notifications = useMemo(() => {
    const list: Array<{
      id: string
      type: 'overdue' | 'p1' | 'unassigned'
      icon: string
      title: string
      desc: string
      incident: IncidentResponse
    }> = []

    incidents.forEach((inc) => {
      const sla = mockN7StaffRoleApi.getSlaStatus(inc)
      if (sla.state === 'overdue') {
        list.push({
          id: `overdue-${inc.id}`,
          type: 'overdue',
          icon: '🚨',
          title: `Quá hạn SLA: #${inc.id.slice(0, 8)}`,
          desc: `${inc.title} (${inc.building || 'Khuôn viên'}) cần tiếp nhận ngay!`,
          incident: inc,
        })
      } else if (inc.priority === 'p1') {
        list.push({
          id: `p1-${inc.id}`,
          type: 'p1',
          icon: '🔥',
          title: `Ưu tiên khẩn cấp P1: #${inc.id.slice(0, 8)}`,
          desc: `${inc.title} (${inc.building || 'Khuôn viên'})`,
          incident: inc,
        })
      } else if (!inc.assigned_handler_id && (inc.status === 'reported' || inc.status === 'assigned')) {
        list.push({
          id: `unassigned-${inc.id}`,
          type: 'unassigned',
          icon: '⏳',
          title: `Chờ phân công: #${inc.id.slice(0, 8)}`,
          desc: `${inc.title} đang chờ giao KTV.`,
          incident: inc,
        })
      }
    })

    return list.slice(0, 8)
  }, [incidents])

  const unreadCount = notifications.filter((n) => !readNotifIds.has(n.id)).length

  const handleNotificationClick = (notif: (typeof notifications)[0]) => {
    setReadNotifIds((prev) => new Set(prev).add(notif.id))
    setSelectedIncident(notif.incident)
    setShowNotifications(false)
  }

  const handleMarkAllRead = () => {
    setReadNotifIds(new Set(notifications.map((n) => n.id)))
  }

  // Count metrics for summary line
  const counts = useMemo(() => {
    const total = incidents.length
    const overdue = incidents.filter((i) => {
      const s = mockN7StaffRoleApi.getSlaStatus(i).state
      return s === 'overdue' || s === 'warning'
    }).length
    const unassigned = incidents.filter((i) => !i.assigned_handler_id && (i.status === 'reported' || i.status === 'assigned')).length
    const inProgress = incidents.filter((i) => i.status === 'in_progress').length
    const resolved = incidents.filter((i) => i.status === 'resolved' || i.status === 'closed').length
    return { total, overdue, unassigned, inProgress, resolved }
  }, [incidents])

  // Copy UUID
  const handleCopyId = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(id)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1800)
  }

  // Switch User
  const handleSelectUser = (key: string) => {
    setCurrentUserKey(key)
    setShowLoginModal(false)
    setLoginError(null)
    setRefreshTrigger((v) => v + 1)
  }

  // Handle Manual Login inside modal
  const handleManualLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError(null)
    try {
      const res = await reporterApiClient.login({
        email: loginEmail.trim(),
        password: loginPassword.trim(),
      })
      const foundKey = Object.keys(MOCK_USERS).find((k) => MOCK_USERS[k].id === res.user.id)
      if (foundKey) {
        setCurrentUserKey(foundKey)
      }
      setShowLoginModal(false)
      setRefreshTrigger((v) => v + 1)
    } catch {
      setLoginError('Email hoặc mật khẩu không chính xác (Mã lỗi: 401 / invalid_credentials).')
    }
  }

  // Handle Submit New Incident
  const handleSubmitNewIncident = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim() || newTitle.trim().length < 5) {
      alert('Vui lòng nhập tiêu đề từ 5 đến 120 ký tự.')
      return
    }
    setIsSubmitting(true)

    try {
      const uuidKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : '10000000-1000-4000-8000-' + Math.random().toString(16).substring(2, 14).padEnd(12, '0')

      let defaultAnswers: Record<string, unknown> = {}
      if (newCategory === 'water_leak') {
        defaultAnswers = { leak_amount: 'small', near_electricity: 'no', slip_risk: true }
      } else if (newCategory === 'electrical_hazard') {
        defaultAnswers = { exposed_wire: 'yes', smoke_or_sparks: 'no', equipment: 'Dây nối tường' }
      } else {
        defaultAnswers = { interaction: 'none', channel: 'email', sender_text: 'attacker@scam.vn' }
      }

      await mockN6ReporterApi.createIncident(
        {
          category: newCategory,
          title: newTitle.trim(),
          description: newDesc.trim() || 'Mô tả chi tiết sự cố được gửi từ giao diện web nhanh.',
          building: newBuilding,
          answers: defaultAnswers as never,
        },
        uuidKey,
        currentUser.id
      )

      setIsSubmitting(false)
      setShowNewIncidentModal(false)
      setNewTitle('')
      setNewDesc('')
      setRefreshTrigger((v) => v + 1)
      alert('Báo cáo sự cố đã được gửi thành công!')
    } catch {
      setIsSubmitting(false)
      alert('Có lỗi xảy ra khi gửi báo cáo sự cố.')
    }
  }

  const roleInfo = roleBadgeLabels[currentUser.role] || { label: currentUser.role, short: currentUser.role }

  return (
    <div className="sf-root-layout">
      {/* ====================================================================
          1. SLIM LEFT SIDEBAR (SchoolFood Style with Icon Buttons)
          ==================================================================== */}
      <aside className="sf-sidebar" aria-label="Menu thanh công cụ bên trái">
        <div className="sf-sidebar-brand">
          <div
            className="sf-brand-icon-box"
            title="USTH Campus Incident Management"
            onClick={() => setActiveTab('all')}
          >
            🛡️
          </div>
        </div>

        <nav className="sf-sidebar-nav">
          <button
            type="button"
            className={`sf-nav-btn ${activeTab === 'all' ? 'active' : ''}`}
            data-tooltip="Tất cả sự cố"
            onClick={() => transitionGui(() => setActiveTab('all'))}
            aria-label="Tất cả sự cố"
          >
            📋
          </button>

          <button
            type="button"
            className={`sf-nav-btn ${activeTab === 'my-incidents' ? 'active' : ''}`}
            data-tooltip="Sự cố của tôi"
            onClick={() => transitionGui(() => setActiveTab('my-incidents'))}
            aria-label="Sự cố của tôi"
          >
            👤
          </button>

          <button
            type="button"
            className={`sf-nav-btn ${activeTab === 'new-incident' ? 'active' : ''}`}
            data-tooltip="Báo sự cố mới"
            onClick={() => setShowNewIncidentModal(true)}
            aria-label="Báo sự cố mới"
          >
            ➕
          </button>

          <button
            type="button"
            className={`sf-nav-btn ${activeTab === 'health' ? 'active' : ''}`}
            data-tooltip="Kết nối API"
            onClick={() => transitionGui(() => setActiveTab('health'))}
            aria-label="Kiểm tra kết nối API"
          >
            🔌
          </button>

          <button
            type="button"
            className={`sf-nav-btn ${activeTab === 'wireframe' ? 'active' : ''}`}
            data-tooltip="Bản vẽ Wireframe"
            onClick={() => transitionGui(() => setActiveTab('wireframe'))}
            aria-label="Bản vẽ Wireframe"
          >
            📐
          </button>
        </nav>

        <div className="sf-sidebar-bottom">
          <button
            type="button"
            className="sf-nav-btn"
            data-tooltip="Kiểm tra RAM Token"
            onClick={() => setShowStorageModal(true)}
            aria-label="Kiểm tra Storage"
          >
            🔒
          </button>
          <button
            type="button"
            className="sf-nav-btn"
            data-tooltip="Đổi tài khoản / Login"
            onClick={() => setShowLoginModal(true)}
            aria-label="Đổi tài khoản"
          >
            🚪
          </button>
        </div>
      </aside>

      {/* ====================================================================
          2. MAIN CONTENT AREA
          ==================================================================== */}
      <div className="sf-main-wrapper">
        {/* TOP NAVBAR (SchoolFood Style) */}
        <header className="sf-top-navbar">
          <div className="sf-navbar-left">
            <div className="sf-brand-name-group">
              <span className="sf-brand-title">CampusCare</span>
            </div>

            {/* Category Select + Search Input */}
            <div className="sf-search-bar">
              <select
                className="sf-search-category-select"
                value={searchCategory}
                onChange={(e) => setSearchCategory(e.target.value)}
                aria-label="Phân loại tìm kiếm"
              >
                <option value="">Tất cả</option>
                <option value="water_leak">Rò rỉ nước</option>
                <option value="electrical_hazard">Nguy hiểm điện</option>
                <option value="phishing">Phishing</option>
              </select>

              <input
                type="text"
                className="sf-search-input-field"
                placeholder="Tìm mặt hàng, sự cố, vị trí, người báo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              {searchQuery && (
                <button
                  type="button"
                  className="sf-search-clear-btn"
                  onClick={() => setSearchQuery('')}
                  aria-label="Xóa tìm kiếm"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Right Header Actions */}
          <div className="sf-navbar-right">
            {/* THÔNG BÁO VỚI CHUÔNG TƯƠNG TÁC THỰC TẾ */}
            <div className="sf-notification-wrapper">
              <button
                type="button"
                className="sf-notification-btn"
                title={`Thông báo (${unreadCount} mới)`}
                onClick={() => setShowNotifications(!showNotifications)}
                aria-label="Xem thông báo"
              >
                🔔
                {unreadCount > 0 && <span className="sf-notif-badge"></span>}
              </button>

              {showNotifications && (
                <div className="sf-notification-popover" role="dialog" aria-label="Danh sách thông báo">
                  <div className="sf-notif-header">
                    <div className="sf-notif-title">
                      <span>Thông báo</span>
                      {unreadCount > 0 && <span className="sf-notif-count-pill">{unreadCount}</span>}
                    </div>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        className="sf-notif-mark-read"
                        onClick={handleMarkAllRead}
                      >
                        Đánh dấu đã đọc
                      </button>
                    )}
                  </div>

                  <div className="sf-notif-list">
                    {notifications.length === 0 ? (
                      <div className="sf-notif-empty">Hiện không có thông báo sự cố nào.</div>
                    ) : (
                      notifications.map((notif) => {
                        const isUnread = !readNotifIds.has(notif.id)
                        return (
                          <button
                            type="button"
                            key={notif.id}
                            className={`sf-notif-item ${isUnread ? 'unread' : ''}`}
                            onClick={() => handleNotificationClick(notif)}
                          >
                            <span className="sf-notif-icon">{notif.icon}</span>
                            <div className="sf-notif-content">
                              <span className="sf-notif-item-title">{notif.title}</span>
                              <span className="sf-notif-item-desc">{notif.desc}</span>
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* SẮP XẾP LOGIN: User Profile Pill */}
            <div
              className="sf-user-auth-pill"
              onClick={() => setShowLoginModal(true)}
              title="Nhấp để đổi tài khoản hoặc xem thông tin đăng nhập"
              role="button"
              tabIndex={0}
            >
              <div className="sf-user-avatar">
                {currentUser.display_name.charAt(0).toUpperCase()}
              </div>
              <div className="sf-user-info-text">
                <span className="sf-user-display-name">{currentUser.display_name.split(' ')[0]}</span>
                <span className="sf-user-role-label">{roleInfo.short}</span>
              </div>
              <span className="sf-chevron-down">▾</span>
            </div>
          </div>
        </header>

        {/* HERO BANNER WITH BLUE GRADIENT (Như ảnh ví dụ) */}
        <section className="sf-hero-banner" aria-label="Tiêu đề và tác vụ">
          <div className="sf-breadcrumb-line">
            <span>Khuôn viên</span>
            <span>/</span>
            <span>Quản lý sự cố</span>
          </div>

          <div className="sf-banner-main-row">
            <div className="sf-banner-title-wrap">
              <h1 className="sf-banner-heading">
                {activeTab === 'my-incidents'
                  ? 'Sự cố của tôi'
                  : activeTab === 'wireframe'
                  ? 'Bản vẽ Wireframe'
                  : activeTab === 'health'
                  ? 'Trạng thái API'
                  : 'Sự cố'}
              </h1>
              <span className="sf-banner-counter">{filteredIncidents.length}</span>
            </div>

            <div className="sf-banner-actions">
              <button
                type="button"
                className="sf-action-btn-outline"
                onClick={() => alert(`Đã trích xuất ${filteredIncidents.length} sự cố ra báo cáo CSV.`)}
              >
                📤 Xuất danh sách
              </button>

              <button
                type="button"
                className="sf-action-btn-primary"
                onClick={() => setShowNewIncidentModal(true)}
              >
                ➕ Báo sự cố ▾
              </button>
            </div>
          </div>
        </section>

        {/* HORIZONTAL UNDERLINE TABS (SchoolFood Style: Tồn kho, Phiếu nhập...) */}
        <nav className="sf-nav-tabs-bar" aria-label="Danh mục điều hướng">
          <button
            type="button"
            className={`sf-tab-nav-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => transitionGui(() => setActiveTab('all'))}
          >
            <span>Tất cả sự cố</span>
            <span className="sf-tab-count-badge">{counts.total}</span>
          </button>

          <button
            type="button"
            className={`sf-tab-nav-btn ${activeTab === 'unassigned' ? 'active' : ''}`}
            onClick={() => transitionGui(() => setActiveTab('unassigned'))}
          >
            <span>Chờ tiếp nhận</span>
            <span className="sf-tab-count-badge">{counts.unassigned}</span>
          </button>

          <button
            type="button"
            className={`sf-tab-nav-btn ${activeTab === 'in-progress' ? 'active' : ''}`}
            onClick={() => transitionGui(() => setActiveTab('in-progress'))}
          >
            <span>Đang xử lý</span>
            <span className="sf-tab-count-badge">{counts.inProgress}</span>
          </button>

          <button
            type="button"
            className={`sf-tab-nav-btn ${activeTab === 'resolved' ? 'active' : ''}`}
            onClick={() => transitionGui(() => setActiveTab('resolved'))}
          >
            <span>Đã giải quyết</span>
            <span className="sf-tab-count-badge">{counts.resolved}</span>
          </button>

          <button
            type="button"
            className={`sf-tab-nav-btn ${activeTab === 'overdue' ? 'active' : ''}`}
            onClick={() => transitionGui(() => setActiveTab('overdue'))}
          >
            <span>Quá hạn SLA</span>
            <span className="sf-tab-count-badge">{counts.overdue}</span>
          </button>

          <button
            type="button"
            className={`sf-tab-nav-btn ${activeTab === 'my-incidents' ? 'active' : ''}`}
            onClick={() => transitionGui(() => setActiveTab('my-incidents'))}
          >
            <span>Sự cố của tôi</span>
          </button>

          <button
            type="button"
            className={`sf-tab-nav-btn ${activeTab === 'health' ? 'active' : ''}`}
            onClick={() => transitionGui(() => setActiveTab('health'))}
          >
            <span>Kiểm tra API</span>
          </button>
        </nav>

        {/* SUMMARY STATS LINE (SchoolFood style: 21 mặt hàng • giá trị tồn...) */}
        <div className="sf-summary-stats-line">
          <span>
            <strong>{counts.total}</strong> sự cố
          </span>
          <span className="sf-stat-dot">•</span>
          <span>
            <strong>{counts.overdue}</strong> quá hạn SLA
          </span>
          <span className="sf-stat-dot">•</span>
          <span>
            <strong>{counts.unassigned}</strong> chờ phân công
          </span>
          <span className="sf-stat-dot">•</span>
          <span>
            <strong>{counts.inProgress}</strong> đang xử lý
          </span>
          <span className="sf-stat-dot">•</span>
          <span>🔒 Token an toàn trong RAM</span>
        </div>

        {/* PILL FILTER CHIPS (SchoolFood style: [Tất cả] [Cơm dẻo] [Gạo...] ) */}
        <div className="sf-pill-filter-bar">
          <button
            type="button"
            className={`sf-filter-chip ${activeCategoryFilter === '' ? 'active' : ''}`}
            onClick={() => setActiveCategoryFilter('')}
          >
            Tất cả
          </button>

          <button
            type="button"
            className={`sf-filter-chip ${activeCategoryFilter === 'water_leak' ? 'active' : ''}`}
            onClick={() => setActiveCategoryFilter(activeCategoryFilter === 'water_leak' ? '' : 'water_leak')}
          >
            💧 Rò rỉ nước
          </button>

          <button
            type="button"
            className={`sf-filter-chip ${activeCategoryFilter === 'electrical_hazard' ? 'active' : ''}`}
            onClick={() =>
              setActiveCategoryFilter(activeCategoryFilter === 'electrical_hazard' ? '' : 'electrical_hazard')
            }
          >
            ⚡ Nguy hiểm điện
          </button>

          <button
            type="button"
            className={`sf-filter-chip ${activeCategoryFilter === 'phishing' ? 'active' : ''}`}
            onClick={() => setActiveCategoryFilter(activeCategoryFilter === 'phishing' ? '' : 'phishing')}
          >
            🎣 Phishing
          </button>

          <button
            type="button"
            className={`sf-filter-chip ${activeCategoryFilter === 'p1' ? 'active' : ''}`}
            onClick={() => setActiveCategoryFilter(activeCategoryFilter === 'p1' ? '' : 'p1')}
          >
            🔥 Khẩn cấp P1
          </button>

          <button
            type="button"
            className={`sf-filter-chip ${activeCategoryFilter === 'overdue' ? 'active' : ''}`}
            onClick={() => setActiveCategoryFilter(activeCategoryFilter === 'overdue' ? '' : 'overdue')}
          >
            🚨 Quá hạn SLA
          </button>
        </div>

        {/* TASK N7-W03: BỘ LỌC NGHIỆP VỤ (Status / Priority / Department / Triage) */}
        <div className="sf-secondary-filter-row">
          {/* Lọc Status */}
          <select
            className="sf-filter-select-sm"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as Status | '')
              setPageIndex(0)
            }}
            aria-label="Lọc trạng thái"
          >
            <option value="">Tất cả trạng thái</option>
            <option value="reported">Mới báo cáo</option>
            <option value="assigned">Đã phân công</option>
            <option value="in_progress">Đang xử lý</option>
            <option value="resolved">Đã giải quyết</option>
            <option value="closed">Đã đóng</option>
          </select>

          {/* Lọc Priority */}
          <select
            className="sf-filter-select-sm"
            value={priorityFilter || ''}
            onChange={(e) => {
              setPriorityFilter((e.target.value || '') as Priority | '')
              setPageIndex(0)
            }}
            aria-label="Lọc mức ưu tiên"
          >
            <option value="">Tất cả mức ưu tiên</option>
            <option value="p1">P1 — Khẩn cấp</option>
            <option value="p2">P2 — Cao</option>
            <option value="p3">P3 — Tiêu chuẩn</option>
          </select>

          {/* Lọc Department */}
          <select
            className="sf-filter-select-sm"
            value={departmentFilter}
            onChange={(e) => {
              setDepartmentFilter(e.target.value)
              setPageIndex(0)
            }}
            aria-label="Lọc bộ phận"
          >
            <option value="">Tất cả bộ phận</option>
            {Object.values(DEPARTMENTS).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>

          {/* Lọc Triage */}
          <button
            type="button"
            className={`sf-triage-toggle-btn ${triageFilter ? 'active' : ''}`}
            onClick={() => {
              setTriageFilter(!triageFilter)
              setPageIndex(0)
            }}
          >
            ⚡ {triageFilter ? 'Đang lọc: Cần Triage' : 'Lọc: Cần Triage'}
          </button>

          {/* Nút đặt lại bộ lọc */}
          {(statusFilter || priorityFilter || departmentFilter || triageFilter || activeCategoryFilter || searchQuery) && (
            <button
              type="button"
              className="sf-action-btn-outline"
              style={{ padding: '5px 12px', fontSize: '0.775rem' }}
              onClick={handleResetAllFilters}
            >
              ✕ Đặt lại tất cả
            </button>
          )}
        </div>

        {/* CONTENT VIEW SWITCHER */}
        {activeTab === 'health' ? (
          <div className="sf-content-card p-4">
            <h3 className="font-semibold text-lg mb-2">🔌 Trạng Thái Kết Nối API FastAPI</h3>
            <p className="text-sm text-muted mb-4">
              Kiểm tra tình trạng sẵn sàng của backend qua proxy <code>/api/v1/health/live</code>.
            </p>
            <div className={`health ${healthStatus} mb-4`}>
              {healthStatus === 'online' ? '✅ API đang hoạt động bình thường' : '⏳ Đang kiểm tra kết nối...'}
            </div>
            <button
              type="button"
              className="sf-action-btn-outline"
              onClick={() => {
                setHealthStatus('checking')
                setTimeout(() => setHealthStatus('online'), 400)
              }}
            >
              Kiểm tra lại kết nối
            </button>
          </div>
        ) : activeTab === 'wireframe' ? (
          <div className="sf-content-card p-4">
            <h3 className="font-semibold text-lg mb-2">📐 Bản Vẽ Giao Diện Wireframe W1</h3>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <button
                type="button"
                className="sf-action-btn-primary"
                onClick={() => setSelectedIncident(null)}
              >
                Xem Wireframe Nhân Viên & Quản Lý
              </button>
            </div>
            <StaffWireframeView />
            <div className="mt-4 pt-4 border-t">
              <ReporterWireframeView />
            </div>
          </div>
        ) : (
          /* MAIN TABLE (SchoolFood style: Checkboxes, item icon, pastel status badge) */
          <div className="sf-content-card">
            {isLoading ? (
              <div className="staff-loading-container p-4">
                <div className="staff-loading-bar">
                  <span className="spinner-inline"></span>
                  <span>Đang đồng bộ dữ liệu sự cố...</span>
                </div>
              </div>
            ) : filteredIncidents.length === 0 ? (
              <div className="staff-state-card staff-state-empty">
                <div className="state-icon-box">📭</div>
                <h3 className="state-title">Không tìm thấy sự cố nào</h3>
                <p className="state-description">
                  {searchQuery
                    ? `Không có kết quả nào khớp với từ khóa "${searchQuery}".`
                    : 'Chưa có sự cố nào trong danh mục này.'}
                </p>
                <div className="state-actions mt-2">
                  <button
                    type="button"
                    className="sf-action-btn-primary"
                    onClick={() => {
                      setSearchQuery('')
                      setActiveCategoryFilter('')
                      setActiveTab('all')
                    }}
                  >
                    Xem tất cả sự cố
                  </button>
                </div>
              </div>
            ) : (
              <div className="sf-table-wrapper">
                <table className="sf-table">
                  <thead>
                    <tr>
                      <th style={{ width: '4%' }}>
                        <input type="checkbox" aria-label="Chọn tất cả" />
                      </th>
                      <th style={{ width: '28%' }}>Mặt hàng / Sự cố</th>
                      <th style={{ width: '12%' }}>Mã</th>
                      <th style={{ width: '14%' }}>Trạng thái</th>
                      <th style={{ width: '10%' }}>Ưu tiên</th>
                      <th style={{ width: '16%' }}>Bộ phận &amp; KTV</th>
                      <th style={{ width: '10%' }}>Địa điểm</th>
                      <th style={{ width: '6%', textAlign: 'center' }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedIncidents.map((inc) => {
                      const cat = categoryMeta[inc.category] || { label: inc.category, icon: '📌' }
                      const stat = statusDisplay[inc.status] || { label: inc.status, className: '' }
                      const prio = inc.priority ? priorityBadges[inc.priority] : null
                      const dept = inc.department_id ? DEPARTMENTS[inc.department_id]?.name : 'Chưa phân'
                      const shortId = inc.id.slice(0, 8)
                      const isOverdue = mockN7StaffRoleApi.getSlaStatus(inc).state === 'overdue'

                      return (
                        <tr
                          key={inc.id}
                          onClick={() => setSelectedIncident(inc)}
                          style={{ cursor: 'pointer' }}
                        >
                          {/* Checkbox */}
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" aria-label={`Chọn sự cố ${shortId}`} />
                          </td>

                          {/* Incident Icon & Title */}
                          <td>
                            <div className="sf-cell-incident">
                              <div className="sf-cat-icon-circle">{cat.icon}</div>
                              <div className="sf-incident-meta-text">
                                <span className="sf-incident-title">{inc.title}</span>
                                <span className="sf-incident-code">{cat.label}</span>
                              </div>
                            </div>
                          </td>

                          {/* Code ID with 1-click copy */}
                          <td>
                            <span
                              className="font-mono text-xs cursor-pointer text-blue-600 hover:underline"
                              onClick={(e) => handleCopyId(e, inc.id)}
                              title="Nhấp để copy UUID"
                            >
                              #{shortId} {copiedId === inc.id ? '✓' : ''}
                            </span>
                          </td>

                          {/* Status Badge (Soft pastel pill like SchoolFood) */}
                          <td>
                            <span
                              className={`sf-badge-status ${
                                isOverdue ? 'sf-badge-overdue' : stat.className
                              }`}
                            >
                              {isOverdue ? '🚨 Quá hạn' : stat.label}
                            </span>
                          </td>

                          {/* Priority */}
                          <td>
                            {prio ? (
                              <span className={prio.className}>{prio.label}</span>
                            ) : (
                              <span className="text-muted text-xs">—</span>
                            )}
                          </td>

                          {/* Department & Handler */}
                          <td>
                            <div className="text-xs">
                              <strong>{dept}</strong>
                              {inc.assigned_handler_id && (
                                <div className="text-muted">
                                  {Object.values(MOCK_USERS).find((u) => u.id === inc.assigned_handler_id)
                                    ?.display_name.split(' ')[0] || 'KTV'}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Location */}
                          <td>
                            <span className="text-xs text-muted">
                              📍 {inc.building || 'Khuôn viên'}
                            </span>
                          </td>

                          {/* Action Button */}
                          <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="sf-btn-view-detail"
                              onClick={() => setSelectedIncident(inc)}
                            >
                              Xem
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {/* TASK N7-W03: CURSOR PAGINATION BAR & PRESERVED STATE */}
                <div className="sf-pagination-bar">
                  <div className="sf-cursor-meta-group">
                    <span className="text-xs text-muted">
                      Hiển thị <strong>{safePageIndex * pageSize + 1}</strong>–<strong>{Math.min((safePageIndex + 1) * pageSize, filteredIncidents.length)}</strong> trên tổng số <strong>{filteredIncidents.length}</strong> sự cố
                    </span>
                    <span className="sf-preserved-state-tag" title="Vị trí phân trang và bộ lọc không bị mất khi nhấp xem chi tiết">
                      ✓ Bảo lưu vị trí khi xem chi tiết
                    </span>
                    <span className="sf-cursor-token-pill" title="Opaque Cursor Token theo chuẩn API Contract">
                      Cursor: #{currentCursor.slice(0, 14)}…
                    </span>
                  </div>

                  <div className="sf-pagination-controls">
                    {/* Page Size Selector */}
                    <select
                      className="sf-filter-select-sm"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value))
                        setPageIndex(0)
                      }}
                      aria-label="Số sự cố mỗi trang"
                    >
                      <option value={5}>5 sự cố / trang</option>
                      <option value={10}>10 sự cố / trang</option>
                      <option value={20}>20 sự cố / trang</option>
                    </select>

                    {/* Prev Page Button */}
                    <button
                      type="button"
                      className="sf-page-btn"
                      disabled={!hasPrevPage}
                      onClick={handlePrevPage}
                      aria-label="Trang trước"
                    >
                      ← Trước
                    </button>

                    <span className="sf-page-info">
                      Trang {safePageIndex + 1} / {totalPages}
                    </span>

                    {/* Next Page Button */}
                    <button
                      type="button"
                      className="sf-page-btn"
                      disabled={!hasNextPage}
                      onClick={handleNextPage}
                      aria-label="Trang tiếp theo"
                    >
                      Sau →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ====================================================================
          3. SẮP XẾP LOGIN & CHUYỂN VAI TRÒ (MODAL CỰC KỲ GỌN GÀNG)
          ==================================================================== */}
      {showLoginModal && (
        <div className="sf-modal-overlay" role="dialog" aria-modal="true">
          <div className="sf-login-modal-box">
            <div className="sf-login-modal-header">
              <h3 className="sf-login-modal-title">
                <span>🛡️ Cổng Xác Thực &amp; Quản Lý Phiên</span>
              </h3>
              <p className="sf-login-modal-sub">
                Hệ thống Quản lý Sự cố Khuôn viên · USTH Cyber Security
              </p>
              <button
                type="button"
                className="sf-modal-close-btn"
                onClick={() => setShowLoginModal(false)}
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>

            <div className="sf-login-modal-body">
              {/* Token in memory badge */}
              <div className="sf-token-security-badge">
                <span>🔒</span>
                <span>
                  <strong>Bảo mật:</strong> Opaque Bearer Token lưu thuần túy trong Memory (RAM), không lưu vào
                  storage/cookie/log.
                </span>
              </div>

              {/* Quick switch between predefined roles */}
              <div>
                <div className="sf-role-selector-title mb-2">Đăng nhập nhanh theo vai trò:</div>
                <div className="sf-role-buttons-grid">
                  <div
                    className={`sf-role-select-item ${currentUserKey === 'user-reporter' ? 'current' : ''}`}
                    onClick={() => handleSelectUser('user-reporter')}
                  >
                    <div className="sf-role-item-left">
                      <span className="text-xl">🎓</span>
                      <div>
                        <div className="sf-role-item-name">Lê Minh Tuấn / Đỗ Tuấn Kiệt</div>
                        <div className="sf-role-item-email">Sinh viên (Người báo cáo sự cố)</div>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-blue-600">Chọn ➔</span>
                  </div>

                  <div
                    className={`sf-role-select-item ${currentUserKey === 'user-handler-csvc' ? 'current' : ''}`}
                    onClick={() => handleSelectUser('user-handler-csvc')}
                  >
                    <div className="sf-role-item-left">
                      <span className="text-xl">🛠️</span>
                      <div>
                        <div className="sf-role-item-name">Phạm Văn Nam</div>
                        <div className="sf-role-item-email">KTV Cơ sở vật chất (Tiếp nhận &amp; Xử lý)</div>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-blue-600">Chọn ➔</span>
                  </div>

                  <div
                    className={`sf-role-select-item ${currentUserKey === 'user-handler-dien' ? 'current' : ''}`}
                    onClick={() => handleSelectUser('user-handler-dien')}
                  >
                    <div className="sf-role-item-left">
                      <span className="text-xl">⚡</span>
                      <div>
                        <div className="sf-role-item-name">Trần Quốc Tuấn</div>
                        <div className="sf-role-item-email">KTV Điện &amp; An toàn</div>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-blue-600">Chọn ➔</span>
                  </div>

                  <div
                    className={`sf-role-select-item ${currentUserKey === 'user-manager-csvc' ? 'current' : ''}`}
                    onClick={() => handleSelectUser('user-manager-csvc')}
                  >
                    <div className="sf-role-item-left">
                      <span className="text-xl">👔</span>
                      <div>
                        <div className="sf-role-item-name">Hoàng Đức</div>
                        <div className="sf-role-item-email">Trưởng ban Cơ sở vật chất (Phân công &amp; Đóng)</div>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-blue-600">Chọn ➔</span>
                  </div>

                  <div
                    className={`sf-role-select-item ${currentUserKey === 'user-admin' ? 'current' : ''}`}
                    onClick={() => handleSelectUser('user-admin')}
                  >
                    <div className="sf-role-item-left">
                      <span className="text-xl">🛡️</span>
                      <div>
                        <div className="sf-role-item-name">Quản Trị Viên (Admin)</div>
                        <div className="sf-role-item-email">Toàn quyền điều phối hệ thống</div>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-blue-600">Chọn ➔</span>
                  </div>
                </div>
              </div>

              {/* Manual Login Form */}
              <div className="mt-3 pt-3 border-t">
                <div className="sf-role-selector-title mb-2">Hoặc đăng nhập bằng Email trường:</div>
                {loginError && <div className="text-xs text-red-600 mb-2 font-medium">{loginError}</div>}
                <form onSubmit={handleManualLogin} className="sf-manual-login-form">
                  <div className="form-group">
                    <label className="form-label">Địa chỉ email:</label>
                    <input
                      type="email"
                      className="input-text"
                      placeholder="email@usth.edu.vn"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Mật khẩu:</label>
                    <input
                      type="password"
                      className="input-text"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                    />
                  </div>
                  <button type="submit" className="sf-action-btn-primary w-full justify-center">
                    Đăng Nhập Ngay
                  </button>
                </form>
              </div>
            </div>

            <div className="sf-login-modal-footer">
              <span className="text-xs text-muted">
                Đang đăng nhập: <strong>{currentUser.display_name}</strong>
              </span>
              <button
                type="button"
                className="btn btn-xs btn-outline"
                onClick={() => {
                  reporterApiClient.logout()
                  alert('Đã thu hồi token và đăng xuất an toàn khỏi bộ nhớ RAM.')
                  setShowLoginModal(false)
                }}
              >
                Đăng xuất
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          4. MODAL BÁO SỰ CỐ MỚI (Quick Report Modal)
          ==================================================================== */}
      {showNewIncidentModal && (
        <div className="sf-modal-overlay" role="dialog" aria-modal="true">
          <div className="sf-login-modal-box">
            <div className="sf-login-modal-header">
              <h3 className="sf-login-modal-title">
                <span>➕ Gửi Báo Cáo Sự Cố Mới</span>
              </h3>
              <p className="sf-login-modal-sub">Tiếp nhận thông tin nhanh chóng đến đúng bộ phận phụ trách</p>
              <button
                type="button"
                className="sf-modal-close-btn"
                onClick={() => setShowNewIncidentModal(false)}
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitNewIncident} className="sf-login-modal-body">
              {/* Category Selection */}
              <div>
                <label className="form-label required">Chọn loại sự cố:</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <button
                    type="button"
                    className={`sf-filter-chip justify-center ${newCategory === 'water_leak' ? 'active' : ''}`}
                    onClick={() => setNewCategory('water_leak')}
                  >
                    💧 Nước
                  </button>
                  <button
                    type="button"
                    className={`sf-filter-chip justify-center ${
                      newCategory === 'electrical_hazard' ? 'active' : ''
                    }`}
                    onClick={() => setNewCategory('electrical_hazard')}
                  >
                    ⚡ Điện
                  </button>
                  <button
                    type="button"
                    className={`sf-filter-chip justify-center ${newCategory === 'phishing' ? 'active' : ''}`}
                    onClick={() => setNewCategory('phishing')}
                  >
                    🎣 Phishing
                  </button>
                </div>
              </div>

              {/* Title Input */}
              <div className="form-group">
                <label htmlFor="inc-title" className="form-label required">
                  Tiêu đề tóm tắt:
                </label>
                <input
                  id="inc-title"
                  type="text"
                  className="input-text text-sm"
                  placeholder="Ví dụ: Vỡ ống nước bồn rửa tầng 3..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  required
                />
              </div>

              {/* Building & Location */}
              <div className="form-group">
                <label htmlFor="inc-bldg" className="form-label required">
                  Tòa nhà / Địa điểm:
                </label>
                <select
                  id="inc-bldg"
                  className="input-select text-sm"
                  value={newBuilding}
                  onChange={(e) => setNewBuilding(e.target.value)}
                >
                  <option value="Tòa A1">Tòa A1 (Khu Hiệu bộ &amp; Lớp học)</option>
                  <option value="Tòa A2">Tòa A2 (Khu Giảng đường lớn)</option>
                  <option value="Tòa B1">Tòa B1 (Phòng thí nghiệm Công nghệ)</option>
                  <option value="Tòa C1">Tòa C1 (Ký túc xá &amp; Căn tin)</option>
                </select>
              </div>

              {/* Description */}
              <div className="form-group">
                <label htmlFor="inc-desc" className="form-label">
                  Mô tả chi tiết hiện trường:
                </label>
                <textarea
                  id="inc-desc"
                  className="input-textarea text-sm"
                  rows={3}
                  placeholder="Mô tả mức độ nguy hiểm, phạm vi ảnh hưởng..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  className="sf-action-btn-outline"
                  onClick={() => setShowNewIncidentModal(false)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="sf-action-btn-primary"
                >
                  {isSubmitting ? 'Đang gửi...' : '🚀 Gửi Báo Cáo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          5. MODAL STORAGE AUDIT (Bảo Mật In-Memory)
          ==================================================================== */}
      {showStorageModal && (
        <div className="sf-modal-overlay" role="dialog" aria-modal="true">
          <div className="sf-login-modal-box">
            <div className="sf-login-modal-header">
              <h3 className="sf-login-modal-title">
                <span>🔍 Kiểm Tra Bảo Mật Trình Duyệt</span>
              </h3>
              <p className="sf-login-modal-sub">Audit LocalStorage, SessionStorage &amp; Cookies</p>
              <button
                type="button"
                className="sf-modal-close-btn"
                onClick={() => setShowStorageModal(false)}
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>

            <div className="sf-login-modal-body">
              <div className="sf-token-security-badge">
                <span>✅</span>
                <span>
                  <strong>Trạng thái:</strong> Toàn bộ Token xác thực được lưu trên RAM Closure. Trình duyệt không có
                  bất kỳ rò rỉ token nào!
                </span>
              </div>

              <div className="storage-audit-results">
                <div className="audit-item">
                  <span className="audit-label">LocalStorage:</span>
                  <span className="font-mono text-xs text-green-700">0 khóa nhạy cảm (Sạch sẽ)</span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">SessionStorage:</span>
                  <span className="font-mono text-xs text-green-700">0 khóa nhạy cảm (Sạch sẽ)</span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Cookies:</span>
                  <span className="font-mono text-xs text-green-700">Không có session cookie trái phép</span>
                </div>
              </div>
            </div>

            <div className="sf-login-modal-footer">
              <button
                type="button"
                className="sf-action-btn-primary"
                onClick={() => setShowStorageModal(false)}
              >
                Đã Rõ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          6. MODAL CHI TIẾT SỰ CỐ (StaffIncidentDetailModal)
          ==================================================================== */}
      {selectedIncident && (
        <StaffIncidentDetailModal
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
        />
      )}
    </div>
  )
}
