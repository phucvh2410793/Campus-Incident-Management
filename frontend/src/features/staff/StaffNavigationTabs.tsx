import type { UserSummary } from '../../types/auth.ts'
import type { IncidentResponse } from '../../types/incident.ts'
import { mockN7StaffRoleApi } from '../../mocks/n7-role-mock-api.ts'

export type NavTabKey =
  | 'handler-my'
  | 'handler-in-progress'
  | 'handler-completed'
  | 'manager-dept-all'
  | 'manager-unassigned'
  | 'manager-sla'
  | 'manager-triage'
  | 'admin-all'
  | 'admin-triage'
  | 'admin-sla'
  | 'admin-unassigned'

interface StaffNavigationTabsProps {
  currentUser: UserSummary
  activeTabKey: NavTabKey
  onSelectTab: (key: NavTabKey) => void
  queueItems: IncidentResponse[]
}

export function StaffNavigationTabs({
  currentUser,
  activeTabKey,
  onSelectTab,
  queueItems,
}: StaffNavigationTabsProps) {
  const role = currentUser.role

  // Helper counts from current loaded queue
  const myCount = queueItems.filter((i) => i.assigned_handler_id === currentUser.id).length
  const inProgressCount = queueItems.filter((i) => i.status === 'in_progress').length
  const completedCount = queueItems.filter((i) => i.status === 'resolved' || i.status === 'closed').length
  const unassignedCount = queueItems.filter((i) => !i.assigned_handler_id && (i.status === 'reported' || i.status === 'assigned')).length
  const slaAlertsCount = queueItems.filter((i) => {
    const s = mockN7StaffRoleApi.getSlaStatus(i).state
    return s === 'overdue' || s === 'warning'
  }).length
  const triageCount = queueItems.filter((i) => i.triage_required).length

  // HANDLER MENU
  if (role === 'handler') {
    return (
      <nav className="staff-nav-tabs" aria-label="Menu điều hướng kỹ thuật viên">
        <button
          type="button"
          className={`staff-nav-item ${activeTabKey === 'handler-my' ? 'active' : ''}`}
          onClick={() => onSelectTab('handler-my')}
        >
          <span className="tab-icon">📥</span>
          <span className="tab-text">Hàng đợi việc của tôi</span>
          <span className="tab-badge">{myCount}</span>
        </button>

        <button
          type="button"
          className={`staff-nav-item ${activeTabKey === 'handler-in-progress' ? 'active' : ''}`}
          onClick={() => onSelectTab('handler-in-progress')}
        >
          <span className="tab-icon">🛠️</span>
          <span className="tab-text">Đang xử lý</span>
          <span className="tab-badge">{inProgressCount}</span>
        </button>

        <button
          type="button"
          className={`staff-nav-item ${activeTabKey === 'handler-completed' ? 'active' : ''}`}
          onClick={() => onSelectTab('handler-completed')}
        >
          <span className="tab-icon">✅</span>
          <span className="tab-text">Đã giải quyết / Đóng</span>
          <span className="tab-badge">{completedCount}</span>
        </button>
      </nav>
    )
  }

  // DEPARTMENT MANAGER MENU
  if (role === 'department_manager') {
    const isTriageDept = currentUser.department_id === 'dept-triage'

    return (
      <nav className="staff-nav-tabs" aria-label="Menu điều hướng quản lý bộ phận">
        <button
          type="button"
          className={`staff-nav-item ${activeTabKey === 'manager-dept-all' ? 'active' : ''}`}
          onClick={() => onSelectTab('manager-dept-all')}
        >
          <span className="tab-icon">📂</span>
          <span className="tab-text">Tất cả sự cố bộ phận</span>
          <span className="tab-badge">{queueItems.length}</span>
        </button>

        <button
          type="button"
          className={`staff-nav-item ${activeTabKey === 'manager-unassigned' ? 'active' : ''}`}
          onClick={() => onSelectTab('manager-unassigned')}
        >
          <span className="tab-icon">👤</span>
          <span className="tab-text">Chờ phân công KTV</span>
          <span className={`tab-badge ${unassignedCount > 0 ? 'badge-warn' : ''}`}>
            {unassignedCount}
          </span>
        </button>

        <button
          type="button"
          className={`staff-nav-item ${activeTabKey === 'manager-sla' ? 'active' : ''}`}
          onClick={() => onSelectTab('manager-sla')}
        >
          <span className="tab-icon">🚨</span>
          <span className="tab-text">Cảnh báo SLA</span>
          <span className={`tab-badge ${slaAlertsCount > 0 ? 'badge-crit' : ''}`}>
            {slaAlertsCount}
          </span>
        </button>

        {isTriageDept && (
          <button
            type="button"
            className={`staff-nav-item ${activeTabKey === 'manager-triage' ? 'active' : ''}`}
            onClick={() => onSelectTab('manager-triage')}
          >
            <span className="tab-icon">⚡</span>
            <span className="tab-text">Hàng đợi Triage</span>
            <span className={`tab-badge ${triageCount > 0 ? 'badge-warn' : ''}`}>
              {triageCount}
            </span>
          </button>
        )}
      </nav>
    )
  }

  // ADMINISTRATOR MENU
  if (role === 'administrator') {
    return (
      <nav className="staff-nav-tabs" aria-label="Menu điều hướng quản trị viên toàn trường">
        <button
          type="button"
          className={`staff-nav-item ${activeTabKey === 'admin-all' ? 'active' : ''}`}
          onClick={() => onSelectTab('admin-all')}
        >
          <span className="tab-icon">🌐</span>
          <span className="tab-text">Toàn viện (Tất cả sự cố)</span>
          <span className="tab-badge">{queueItems.length}</span>
        </button>

        <button
          type="button"
          className={`staff-nav-item ${activeTabKey === 'admin-triage' ? 'active' : ''}`}
          onClick={() => onSelectTab('admin-triage')}
        >
          <span className="tab-icon">⚡</span>
          <span className="tab-text">Hàng đợi Triage trung tâm</span>
          <span className={`tab-badge ${triageCount > 0 ? 'badge-warn' : ''}`}>
            {triageCount}
          </span>
        </button>

        <button
          type="button"
          className={`staff-nav-item ${activeTabKey === 'admin-sla' ? 'active' : ''}`}
          onClick={() => onSelectTab('admin-sla')}
        >
          <span className="tab-icon">🚨</span>
          <span className="tab-text">Vi phạm SLA toàn viện</span>
          <span className={`tab-badge ${slaAlertsCount > 0 ? 'badge-crit' : ''}`}>
            {slaAlertsCount}
          </span>
        </button>

        <button
          type="button"
          className={`staff-nav-item ${activeTabKey === 'admin-unassigned' ? 'active' : ''}`}
          onClick={() => onSelectTab('admin-unassigned')}
        >
          <span className="tab-icon">⚠️</span>
          <span className="tab-text">Chưa phân công KTV</span>
          <span className={`tab-badge ${unassignedCount > 0 ? 'badge-warn' : ''}`}>
            {unassignedCount}
          </span>
        </button>
      </nav>
    )
  }

  return null
}
