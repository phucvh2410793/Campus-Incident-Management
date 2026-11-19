import { useState } from 'react'
import type { UserSummary } from '../../types/auth.ts'
import type { IncidentResponse } from '../../types/incident.ts'
import { DEPARTMENTS } from '../../mocks/mock-users.ts'
import { N7_ROLE_PERMISSIONS, mockN7StaffRoleApi } from '../../mocks/n7-role-mock-api.ts'

interface StaffRoleNavProps {
  currentUser: UserSummary
  isSimulatedError: boolean
  onToggleSimulatedError: () => void
  onRefresh: () => void
  onResetData: () => void
  viewMode: 'interactive' | 'wireframe'
  onToggleViewMode: (mode: 'interactive' | 'wireframe') => void
  incidents?: IncidentResponse[]
  onSelectIncident?: (incident: IncidentResponse) => void
}

const roleBadgeLabels: Record<string, { label: string; className: string }> = {
  reporter: { label: 'Người báo cáo', className: 'badge-role-reporter' },
  handler: { label: 'Kỹ thuật viên', className: 'badge-role-handler' },
  department_manager: { label: 'Trưởng bộ phận', className: 'badge-role-manager' },
  administrator: { label: 'Quản trị viên', className: 'badge-role-admin' },
}

export function StaffRoleNav({
  currentUser,
  isSimulatedError,
  onToggleSimulatedError,
  onRefresh,
  onResetData,
  viewMode,
  onToggleViewMode,
  incidents = [],
  onSelectIncident,
}: StaffRoleNavProps) {
  const [showNotif, setShowNotif] = useState(false)
  const roleBadge = roleBadgeLabels[currentUser.role] || { label: currentUser.role, className: '' }
  const perms = N7_ROLE_PERMISSIONS[currentUser.role as keyof typeof N7_ROLE_PERMISSIONS]
  const deptName = currentUser.role === 'administrator'
    ? 'Toàn trường (Tất cả bộ phận)'
    : currentUser.department_id
    ? DEPARTMENTS[currentUser.department_id]?.name || currentUser.department_id
    : 'Chưa chỉ định bộ phận'

  // Các sự cố cần chú ý: P1, Quá hạn SLA, Cần triage
  const urgentIncidents = incidents.filter((i) => {
    const slaState = mockN7StaffRoleApi.getSlaStatus(i).state
    return i.priority === 'p1' || slaState === 'overdue' || slaState === 'warning' || i.triage_required
  })

  return (
    <div className="staff-role-nav-container">
      {/* Top Banner: Profile & View Switcher */}
      <div className="staff-role-header">
        <div className="user-profile-badge">
          <div className="avatar-circle">
            {currentUser.role === 'administrator' ? '🛡️' : currentUser.role === 'department_manager' ? '👔' : currentUser.role === 'handler' ? '🛠️' : '👤'}
          </div>
          <div className="profile-details">
            <div className="profile-name-row">
              <span className="user-name">{currentUser.display_name}</span>
              <span className={`badge ${roleBadge.className}`}>{roleBadge.label}</span>
            </div>
            <div className="profile-sub-row">
              <span className="profile-email">{currentUser.email}</span>
              <span className="profile-divider">•</span>
              <span className="profile-dept">Bộ phận: <strong>{deptName}</strong></span>
            </div>
          </div>
        </div>

        {/* Action Controls & Role Switcher */}
        <div className="staff-controls-cluster">
          {/* View mode toggle */}
          <div className="view-mode-toggle" role="tablist">
            <button
              type="button"
              className={`mode-btn ${viewMode === 'interactive' ? 'active' : ''}`}
              onClick={() => onToggleViewMode('interactive')}
              title="Bảng vận hành W2 trực quan kết nối Mock API"
            >
              🚀 Bảng Vận Hành W2
            </button>
            <button
              type="button"
              className={`mode-btn ${viewMode === 'wireframe' ? 'active' : ''}`}
              onClick={() => onToggleViewMode('wireframe')}
              title="Xem bản vẽ wireframe W1"
            >
              📐 Bản Vẽ Wireframe W1
            </button>
          </div>

          {/* Chuông thông báo sự cố tương tác thực tế */}
          <div className="sf-notif-wrapper">
            <button
              type="button"
              className="sf-notif-btn"
              onClick={() => setShowNotif((v) => !v)}
              aria-label="Thông báo sự cố khẩn cấp"
              title="Xem thông báo sự cố P1, quá hạn SLA và cần triage"
            >
              🔔
              {urgentIncidents.length > 0 && (
                <span className="sf-notif-badge">{urgentIncidents.length}</span>
              )}
            </button>

            {showNotif && (
              <div className="sf-notification-popover">
                <div className="sf-notif-header">
                  <span className="sf-notif-title">🔔 Sự Cố Cần Xử Lý Ngay</span>
                  <span className="sf-notif-count">{urgentIncidents.length} cảnh báo</span>
                </div>
                <div className="sf-notif-list">
                  {urgentIncidents.length === 0 ? (
                    <div className="sf-notif-empty">Hiện không có sự cố nào bị quá hạn hoặc khẩn cấp!</div>
                  ) : (
                    urgentIncidents.slice(0, 6).map((inc) => (
                      <div
                        key={inc.id}
                        className="sf-notif-item"
                        onClick={() => {
                          setShowNotif(false)
                          onSelectIncident?.(inc)
                        }}
                      >
                        <div className="sf-notif-item-top">
                          <span className={`sf-notif-prio sf-prio-${inc.priority || 'none'}`}>
                            {inc.priority ? inc.priority.toUpperCase() : 'TRIAGE'}
                          </span>
                          <span className="sf-notif-id">#{inc.id.substring(0, 8)}</span>
                        </div>
                        <div className="sf-notif-item-title">{inc.title}</div>
                        <div className="sf-notif-item-footer">
                          <span>{inc.building || 'Khuôn viên'}</span>
                          <span className="sf-notif-action-hint">Xem chi tiết →</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Permissions Strip & Testing Utilities */}
      <div className="staff-capability-strip">
        <div className="capability-list">
          <span className="capability-title">Phân quyền vai trò:</span>
          {perms ? (
            <div className="capability-chips">
              <span className={`cap-chip ${perms.canViewAllInDept ? 'cap-allowed' : 'cap-denied'}`}>
                {perms.canViewAllInDept ? '✓' : '✕'} Xem sự cố bộ phận
              </span>
              <span className={`cap-chip ${perms.canAcknowledge ? 'cap-allowed' : 'cap-denied'}`}>
                {perms.canAcknowledge ? '✓' : '✕'} Tiếp nhận SLA (Ack)
              </span>
              <span className={`cap-chip ${perms.canAssignHandler ? 'cap-allowed' : 'cap-denied'}`}>
                {perms.canAssignHandler ? '✓' : '✕'} Phân công KTV
              </span>
              <span className={`cap-chip ${perms.canAdjustPriority ? 'cap-allowed' : 'cap-denied'}`}>
                {perms.canAdjustPriority ? '✓' : '✕'} Đổi độ ưu tiên
              </span>
              <span className={`cap-chip ${perms.canTriage ? 'cap-allowed' : 'cap-denied'}`}>
                {perms.canTriage ? '✓' : '✕'} Phân loại Triage
              </span>
              <span className={`cap-chip ${perms.canResolve ? 'cap-allowed' : 'cap-denied'}`}>
                {perms.canResolve ? '✓' : '✕'} Xử lý sự cố
              </span>
            </div>
          ) : (
            <span className="text-muted font-italic">Không có quyền truy cập staff</span>
          )}
        </div>

        {/* Test Utilities */}
        <div className="test-utilities">
          <button
            type="button"
            className={`btn btn-xs ${isSimulatedError ? 'btn-danger' : 'btn-outline'}`}
            onClick={onToggleSimulatedError}
            title="Mô phỏng lỗi mạng 500 để kiểm thử Error State"
          >
            {isSimulatedError ? '⚡ Đang mô phỏng lỗi (500)' : '⚡ Mô phỏng lỗi API'}
          </button>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            onClick={onRefresh}
            title="Tải lại danh sách sự cố từ Mock API (Loading State)"
          >
            🔄 Tải lại
          </button>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            onClick={onResetData}
            title="Đặt lại toàn bộ dữ liệu mock về ban đầu"
          >
            ↺ Đặt lại dữ liệu mẫu
          </button>
        </div>
      </div>
    </div>
  )
}
