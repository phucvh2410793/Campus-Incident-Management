import { useState, useEffect } from 'react'
import './StaffDashboardView.css'
import type { UserSummary } from '../../types/auth.ts'
import type { IncidentResponse } from '../../types/incident.ts'
import { staffApiAdapter } from '../../api/staff-api-adapter.ts'
import {
  mockAutomationOutboxApi,
  type OutboxEventMock,
} from '../../mocks/automation-outbox-mock.ts'
import {
  calculateRoleDashboard,
  type RoleDashboardMetrics,
} from './dashboard-metrics.ts'

interface StaffDashboardViewProps {
  currentUser: UserSummary
  onSelectIncident?: (incident: IncidentResponse) => void
}

export function StaffDashboardView({
  currentUser,
  onSelectIncident,
}: StaffDashboardViewProps) {
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isSimulatedError, setIsSimulatedError] = useState<boolean>(false)
  const [isSimulatedEmpty, setIsSimulatedEmpty] = useState<boolean>(false)
  const [error, setError] = useState<{ isForbidden?: boolean; message?: string } | null>(null)
  const [metrics, setMetrics] = useState<RoleDashboardMetrics | null>(null)
  const [refreshCounter, setRefreshCounter] = useState<number>(0)

  // State cho Modal Admin can thiệp Retry Event
  const [retryTargetEvent, setRetryTargetEvent] = useState<OutboxEventMock | null>(null)
  const [retryReason, setRetryReason] = useState<string>('')
  const [retrySubmitting, setRetrySubmitting] = useState<boolean>(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // Tải dữ liệu Dashboard
  useEffect(() => {
    let active = true

    const loadData = async () => {
      setIsLoading(true)

      // 1. Role Guard: Nếu là Reporter thì chặn ngay 403 Forbidden
      if (currentUser.role === 'reporter') {
        await new Promise((r) => setTimeout(r, 100))
        if (!active) return
        setError({
          isForbidden: true,
          message: 'Quyền truy cập bị từ chối: Tài khoản Người báo cáo (Reporter) không có quyền truy cập Dashboard Quản lý & Nhân viên.',
        })
        setMetrics(null)
        setIsLoading(false)
        return
      }

      // 2. Kiểm tra nếu bật mô phỏng lỗi Dashboard
      if (isSimulatedError) {
        await new Promise((r) => setTimeout(r, 120))
        if (!active) return
        setError({
          isForbidden: false,
          message: 'Lỗi mô phỏng kết nối Dashboard API (Mã lỗi: 500 / E_DASHBOARD_CONNECTION_FAILURE). Vui lòng kiểm tra lại đường truyền.',
        })
        setMetrics(null)
        setIsLoading(false)
        return
      }

      try {
        await new Promise((r) => setTimeout(r, 120))
        if (!active) return

        // Lấy danh sách sự cố qua Adapter
        const queueResult = await staffApiAdapter.getStaffQueue(currentUser)
        const incidents = queueResult.items

        // Lấy danh sách sự kiện Outbox & Notifications
        const outboxEvents = await mockAutomationOutboxApi.getOutboxEvents(currentUser)
        const notifications = await mockAutomationOutboxApi.getNotifications(currentUser)

        // Tính toán các chỉ số theo đúng phạm vi Role
        const dashMetrics = calculateRoleDashboard(
          currentUser,
          incidents,
          outboxEvents,
          notifications,
          isSimulatedEmpty
        )

        if (!active) return
        setMetrics(dashMetrics)
        setError(null)
        setIsLoading(false)
      } catch (err: unknown) {
        if (!active) return
        const errObj = err as { error?: { code?: string; message?: string } }
        setError({
          isForbidden: errObj?.error?.code === 'forbidden',
          message: errObj?.error?.message || 'Không thể tải chỉ số Dashboard.',
        })
        setIsLoading(false)
      }
    }

    loadData()

    return () => {
      active = false
    }
  }, [currentUser, isSimulatedError, isSimulatedEmpty, refreshCounter])

  const handleRefresh = () => {
    setRefreshCounter((v) => v + 1)
  }

  const handleResetData = () => {
    mockAutomationOutboxApi.resetData()
    staffApiAdapter.resetData()
    setIsSimulatedEmpty(false)
    setIsSimulatedError(false)
    setToast({ kind: 'success', text: 'Đã đặt lại dữ liệu mẫu ban đầu thành công.' })
    handleRefresh()
  }

  const handleOpenRetryModal = (event: OutboxEventMock) => {
    setRetryTargetEvent(event)
    setRetryReason('')
    setRetryError(null)
  }

  const handleConfirmRetry = async () => {
    if (!retryTargetEvent) return
    if (!retryReason.trim() || retryReason.trim().length < 5) {
      setRetryError('Vui lòng nhập lý do can thiệp (tối thiểu 5 ký tự) để phục vụ nhật ký kiểm toán (Audit).')
      return
    }

    setRetrySubmitting(true)
    setRetryError(null)

    try {
      await mockAutomationOutboxApi.retryOutboxEvent(retryTargetEvent.id, retryReason, currentUser)
      setRetryTargetEvent(null)
      setToast({
        kind: 'success',
        text: `Đã kích hoạt thử lại sự kiện ${retryTargetEvent.id} thành công! Trạng thái đã chuyển sang Pending.`,
      })
      handleRefresh()
    } catch (err: unknown) {
      const errObj = err as { error?: { message?: string } }
      setRetryError(errObj?.error?.message || 'Không thể thử lại sự kiện lỗi.')
    } finally {
      setRetrySubmitting(false)
    }
  }

  // Nếu đang gặp trạng thái lỗi (Error State)
  if (error) {
    return (
      <div className="n7-dashboard-container">
        <div className="n7-dash-header">
          <div className="n7-dash-title-group">
            <h2>📊 Dashboard Chỉ Số & Quá Hạn SLA</h2>
            <div className="n7-dash-scope-pill">Phạm vi: {currentUser.display_name}</div>
          </div>
          <div className="n7-dash-controls">
            <button
              type="button"
              className={`n7-dash-btn ${isSimulatedError ? 'active-sim' : ''}`}
              onClick={() => setIsSimulatedError((v) => !v)}
            >
              {isSimulatedError ? '🔴 Đang bật mô phỏng lỗi (Tắt)' : '🧪 Bật mô phỏng lỗi'}
            </button>
            <button type="button" className="n7-dash-btn" onClick={handleRefresh}>
              🔄 Thử lại
            </button>
          </div>
        </div>

        <div className="n7-error-state-box" role="alert">
          <div className="n7-error-icon">{error.isForbidden ? '🚫' : '⚠️'}</div>
          <h4>{error.isForbidden ? 'Truy cập bị từ chối (403 Forbidden)' : 'Lỗi tải dữ liệu Dashboard'}</h4>
          <p>{error.message}</p>
          <div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setIsSimulatedError(false)
                handleRefresh()
              }}
            >
              🔄 Tải lại trang Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Skeleton loading
  if (isLoading || !metrics) {
    return (
      <div className="n7-dashboard-container">
        <div className="n7-dash-header">
          <div className="n7-dash-title-group">
            <h2>📊 Đang tải dữ liệu Dashboard…</h2>
          </div>
        </div>
        <div className="n7-kpi-grid">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="n7-kpi-card" style={{ height: '90px', background: '#f1f5f9' }} />
          ))}
        </div>
      </div>
    )
  }

  // Tính tỷ lệ SLA
  const totalSlaIncidents = metrics.safeCount + metrics.warningCount + metrics.overdueCount
  const safePct = totalSlaIncidents > 0 ? (metrics.safeCount / totalSlaIncidents) * 100 : 100
  const warningPct = totalSlaIncidents > 0 ? (metrics.warningCount / totalSlaIncidents) * 100 : 0
  const overduePct = totalSlaIncidents > 0 ? (metrics.overdueCount / totalSlaIncidents) * 100 : 0

  return (
    <div className="n7-dashboard-container">
      {/* Toast thông báo */}
      {toast && (
        <div
          className={`n6-form-notice ${toast.kind}`}
          style={{ margin: '0 0 10px 0', cursor: 'pointer' }}
          onClick={() => setToast(null)}
        >
          {toast.text} (Nhấn để đóng)
        </div>
      )}

      {/* 1. Header & Bộ Điều Khiển Dashboard */}
      <div className="n7-dash-header">
        <div className="n7-dash-title-group">
          <h2>📊 Dashboard Chỉ Số, Quá Hạn & Tự Động Hóa</h2>
          <div className="n7-dash-scope-pill">
            <span>🛡️</span>
            <strong>Phạm vi số liệu:</strong> {metrics.scopeLabel}
          </div>
        </div>

        <div className="n7-dash-controls">
          <button
            type="button"
            className="n7-dash-btn"
            onClick={handleRefresh}
            title="Làm mới toàn bộ số liệu"
          >
            🔄 Làm mới
          </button>
          <button
            type="button"
            className={`n7-dash-btn ${isSimulatedEmpty ? 'active-empty' : ''}`}
            onClick={() => setIsSimulatedEmpty((v) => !v)}
            title="Kiểm thử giao diện khi không có dữ liệu / sạch lỗi"
          >
            {isSimulatedEmpty ? '🧹 Tắt rỗng (Dữ liệu thật)' : '🧹 Mô phỏng trạng thái Rỗng'}
          </button>
          <button
            type="button"
            className={`n7-dash-btn ${isSimulatedError ? 'active-sim' : ''}`}
            onClick={() => setIsSimulatedError((v) => !v)}
            title="Kiểm thử giao diện khi gặp lỗi mạng / API"
          >
            🧪 Mô phỏng lỗi
          </button>
          <button
            type="button"
            className="n7-dash-btn"
            onClick={handleResetData}
            title="Khôi phục trạng thái ban đầu"
          >
            ⚙️ Reset Mock Data
          </button>
        </div>
      </div>

      {/* 2. Bento KPI Metric Cards */}
      <div className="n7-kpi-grid">
        {/* Card 1: Tổng số sự cố */}
        <div className="n7-kpi-card card-primary">
          <span className="n7-kpi-label">Tổng Sự Cố</span>
          <div className="n7-kpi-value-row">
            <span className="n7-kpi-value">{metrics.totalIncidents}</span>
            <span className="n7-kpi-icon">📋</span>
          </div>
          <span className="n7-kpi-subtext">Trong phạm vi được phân quyền</span>
        </div>

        {/* Card 2: Quá hạn SLA (Màu đỏ nếu > 0) */}
        <div className={`n7-kpi-card ${metrics.overdueCount > 0 ? 'card-danger' : 'card-success'}`}>
          <span className="n7-kpi-label">Quá Hạn SLA Tiếp Nhận</span>
          <div className="n7-kpi-value-row">
            <span className="n7-kpi-value" style={{ color: metrics.overdueCount > 0 ? '#dc2626' : '#16a34a' }}>
              {metrics.overdueCount}
            </span>
            <span className="n7-kpi-icon">{metrics.overdueCount > 0 ? '🚨' : '✅'}</span>
          </div>
          <span className="n7-kpi-subtext">
            {metrics.overdueCount > 0 ? 'Cần tiếp nhận & xử lý khẩn' : '0 sự cố trễ hạn cam kết'}
          </span>
        </div>

        {/* Card 3: Sự cố P1 Khẩn Cấp */}
        <div className="n7-kpi-card card-danger">
          <span className="n7-kpi-label">Ưu Tiên Cao (P1)</span>
          <div className="n7-kpi-value-row">
            <span className="n7-kpi-value">{metrics.priorityCounts.p1}</span>
            <span className="n7-kpi-icon">🔥</span>
          </div>
          <span className="n7-kpi-subtext">
            P2: {metrics.priorityCounts.p2} · P3: {metrics.priorityCounts.p3}
          </span>
        </div>

        {/* Card 4: Cần Triage / Chưa phân loại */}
        <div className="n7-kpi-card card-warning">
          <span className="n7-kpi-label">Cần Triage Phân Loại</span>
          <div className="n7-kpi-value-row">
            <span className="n7-kpi-value">{metrics.triageRequiredCount}</span>
            <span className="n7-kpi-icon">⚙️</span>
          </div>
          <span className="n7-kpi-subtext">Cần quản lý rà soát nguyên nhân</span>
        </div>

        {/* Card 5: Đang xử lý */}
        <div className="n7-kpi-card card-info">
          <span className="n7-kpi-label">Đang Xử Lý</span>
          <div className="n7-kpi-value-row">
            <span className="n7-kpi-value">{metrics.statusCounts.in_progress}</span>
            <span className="n7-kpi-icon">⚡</span>
          </div>
          <span className="n7-kpi-subtext">
            Đã giải quyết: {metrics.statusCounts.resolved} · Đóng: {metrics.statusCounts.closed}
          </span>
        </div>

        {/* Card 6: Lỗi Automation Outbox */}
        <div className={`n7-kpi-card ${metrics.automationStats.failedEvents > 0 ? 'card-danger' : 'card-success'}`}>
          <span className="n7-kpi-label">Lỗi Tự Động Hóa (Outbox)</span>
          <div className="n7-kpi-value-row">
            <span className="n7-kpi-value" style={{ color: metrics.automationStats.failedEvents > 0 ? '#dc2626' : '#16a34a' }}>
              {metrics.automationStats.failedEvents}
            </span>
            <span className="n7-kpi-icon">{metrics.automationStats.failedEvents > 0 ? '🤖' : '🛡️'}</span>
          </div>
          <span className="n7-kpi-subtext">
            Tổng {metrics.automationStats.totalEvents} events · {metrics.automationStats.doneEvents} done
          </span>
        </div>
      </div>

      {/* 3. Phân bổ Tuân thủ SLA */}
      <div className="n7-progress-card">
        <div className="n7-progress-title">
          <span>Tiến độ tuân thủ thời hạn tiếp nhận SLA</span>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            {metrics.safeCount} đúng hạn · {metrics.warningCount} sắp tới hạn · {metrics.overdueCount} quá hạn
          </span>
        </div>
        <div className="n7-stacked-bar">
          <div className="n7-stacked-segment seg-safe" style={{ width: `${safePct}%` }} title={`Đúng hạn: ${safePct.toFixed(1)}%`} />
          <div className="n7-stacked-segment seg-warning" style={{ width: `${warningPct}%` }} title={`Cảnh báo: ${warningPct.toFixed(1)}%`} />
          <div className="n7-stacked-segment seg-overdue" style={{ width: `${overduePct}%` }} title={`Quá hạn: ${overduePct.toFixed(1)}%`} />
        </div>
        <div className="n7-stacked-legend">
          <div className="n7-legend-item">
            <span className="n7-legend-dot dot-safe" />
            <span>Đúng hạn ({metrics.safeCount})</span>
          </div>
          <div className="n7-legend-item">
            <span className="n7-legend-dot dot-warning" />
            <span>Sắp đến hạn ({metrics.warningCount})</span>
          </div>
          <div className="n7-legend-item">
            <span className="n7-legend-dot dot-overdue" />
            <strong style={{ color: '#dc2626' }}>Quá hạn SLA ({metrics.overdueCount})</strong>
          </div>
        </div>
      </div>

      {/* 4. PHẦN 1: GIÁM SÁT SỰ CỐ QUÁ HẠN SLA */}
      <div className="n7-dash-section">
        <div className="n7-dash-section-header">
          <h3>
            <span>🚨</span>
            Giám sát sự cố quá hạn SLA tiếp nhận
          </h3>
          <span className={`n7-badge-count ${metrics.isOverdueEmpty ? 'count-safe' : ''}`}>
            {metrics.overdueCount} sự cố
          </span>
        </div>

        {metrics.isOverdueEmpty ? (
          <div className="n7-empty-state-box clean-state">
            <div className="n7-empty-icon">🛡️</div>
            <h4>Không có sự cố nào bị quá hạn SLA</h4>
            <p>
              Tuyệt vời! Toàn bộ các sự cố trong phạm vi của bạn đều đang được xử lý và tiếp nhận đúng hạn cam kết SLA.
            </p>
          </div>
        ) : (
          <div className="n7-dash-table-wrap">
            <table className="n7-dash-table">
              <thead>
                <tr>
                  <th>Mã sự cố</th>
                  <th>Tiêu đề & Vị trí</th>
                  <th>Ưu tiên</th>
                  <th>Bộ phận</th>
                  <th>Kỹ thuật viên</th>
                  <th>Hạn tiếp nhận</th>
                  <th>Thời gian trễ</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {metrics.overdueIncidents.map(({ incident, overdueMinutes, deadlineFormatted, handlerName, departmentName, isAcknowledgedLate }) => (
                  <tr key={incident.id}>
                    <td>
                      <code style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '2px 4px', borderRadius: '4px' }}>
                        #{incident.id.substring(0, 8)}
                      </code>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: '#1e293b' }}>{incident.title}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        📍 {incident.building} {incident.location_detail ? `· ${incident.location_detail}` : ''}
                      </div>
                    </td>
                    <td>
                      <span className={`n7-tag-priority ${incident.priority || 'p3'}`}>
                        {incident.priority ? incident.priority.toUpperCase() : 'N/A'}
                      </span>
                    </td>
                    <td>{departmentName}</td>
                    <td>{handlerName}</td>
                    <td style={{ fontSize: '0.8rem', color: '#475569' }}>{deadlineFormatted}</td>
                    <td>
                      <span className="n7-tag-overdue">
                        ⏱️ Trễ {overdueMinutes} phút
                        {isAcknowledgedLate && ' (Đã nhận trễ)'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => onSelectIncident?.(incident)}
                      >
                        👁️ Xem chi tiết
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. PHẦN 2: GIÁM SÁT TỰ ĐỘNG HÓA OUTBOX & WEBHOOK */}
      <div className="n7-dash-section">
        <div className="n7-dash-section-header">
          <h3>
            <span>🤖</span>
            Giám sát tự động hóa Outbox, Webhook & Thông báo
          </h3>
          <span className={`n7-badge-count ${metrics.isAutomationClean ? 'count-safe' : ''}`}>
            {metrics.automationStats.failedEvents} lỗi
          </span>
        </div>

        {metrics.isAutomationClean ? (
          <div className="n7-empty-state-box clean-state">
            <div className="n7-empty-icon">✅</div>
            <h4>Hệ thống tự động hóa Outbox hoạt động bình thường</h4>
            <p>
              Không có sự kiện Outbox nào rơi vào hàng chờ lỗi (Dead-letter). Toàn bộ {metrics.automationStats.doneEvents} sự kiện đã được chuyển phát thành công sang webhook n8n.
            </p>
          </div>
        ) : (
          <div className="n7-dash-table-wrap">
            <table className="n7-dash-table">
              <thead>
                <tr>
                  <th>Mã Event</th>
                  <th>Loại sự kiện</th>
                  <th>Sự cố liên quan</th>
                  <th>Bộ phận</th>
                  <th>Lần thử</th>
                  <th>Mã / Chi tiết lỗi</th>
                  <th>Trạng thái</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {metrics.automationStats.failedList.map((ev) => (
                  <tr key={ev.id}>
                    <td>
                      <code style={{ fontSize: '0.8rem', background: '#fee2e2', padding: '2px 4px', borderRadius: '4px', color: '#991b1b' }}>
                        {ev.id}
                      </code>
                    </td>
                    <td>
                      <strong style={{ fontSize: '0.8rem', color: '#1e293b' }}>{ev.event_type}</strong>
                    </td>
                    <td style={{ maxWidth: '240px' }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155' }}>{ev.incident_title}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>#{ev.incident_id.substring(0, 8)}…</div>
                    </td>
                    <td>{ev.department_name}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: ev.attempt_count >= ev.max_attempts ? '#dc2626' : '#d97706' }}>
                        {ev.attempt_count} / {ev.max_attempts}
                      </span>
                    </td>
                    <td style={{ maxWidth: '280px', fontSize: '0.78rem', color: '#991b1b' }}>
                      {ev.error_message}
                    </td>
                    <td>
                      <span className="n7-status-pill status-failed">Dead-letter</span>
                    </td>
                    <td>
                      {(currentUser.role === 'administrator' || currentUser.role === 'department_manager') && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => handleOpenRetryModal(ev)}
                          title="Thử lại sự kiện lỗi với lý do can thiệp"
                        >
                          🛠️ Thử lại
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 6. PHẦN 3: PHÂN BỔ BỘ PHẬN (DÀNH RIÊNG CHO QUẢN TRỊ VIÊN ADMIN) */}
      {currentUser.role === 'administrator' && metrics.departmentBreakdown.length > 0 && (
        <div className="n7-dash-section">
          <div className="n7-dash-section-header">
            <h3>
              <span>🏢</span>
              Thống kê toàn trường theo từng bộ phận
            </h3>
            <span style={{ fontSize: '0.82rem', color: '#64748b' }}>Dành riêng cho Quản trị viên (Admin)</span>
          </div>

          <div className="n7-dash-table-wrap">
            <table className="n7-dash-table">
              <thead>
                <tr>
                  <th>Mã & Tên bộ phận</th>
                  <th>Tổng sự cố</th>
                  <th>Ưu tiên P1</th>
                  <th>Đang xử lý</th>
                  <th>Quá hạn SLA</th>
                  <th>Tỷ lệ quá hạn</th>
                </tr>
              </thead>
              <tbody>
                {metrics.departmentBreakdown.map((dept) => {
                  const deptOverdueRate = dept.totalCount > 0 ? ((dept.overdueCount / dept.totalCount) * 100).toFixed(1) : '0.0'
                  return (
                    <tr key={dept.departmentId}>
                      <td>
                        <strong>{dept.departmentName}</strong>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{dept.departmentId}</div>
                      </td>
                      <td><strong>{dept.totalCount}</strong></td>
                      <td>
                        <span className="n7-tag-priority p1">{dept.p1Count} P1</span>
                      </td>
                      <td>{dept.inProgressCount}</td>
                      <td>
                        <span style={{ color: dept.overdueCount > 0 ? '#dc2626' : '#16a34a', fontWeight: 700 }}>
                          {dept.overdueCount} sự cố
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{deptOverdueRate}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 7. MODAL ADMIN CAN THIỆP RETRY OUTBOX EVENT */}
      {retryTargetEvent && (
        <div className="n7-modal-overlay" role="dialog" aria-modal="true">
          <div className="n7-modal-card">
            <div className="n7-modal-header">
              <h3>🛠️ Yêu cầu thử lại sự kiện Automation (Outbox Retry)</h3>
              <button
                type="button"
                className="n7-modal-close-btn"
                onClick={() => setRetryTargetEvent(null)}
              >
                ✕
              </button>
            </div>

            <div className="n7-modal-body">
              <div className="n7-event-meta-box">
                <p><strong>Mã Event:</strong> <code>{retryTargetEvent.id}</code></p>
                <p><strong>Loại sự kiện:</strong> {retryTargetEvent.event_type}</p>
                <p><strong>Sự cố:</strong> {retryTargetEvent.incident_title}</p>
                <p><strong>Bộ phận:</strong> {retryTargetEvent.department_name}</p>
                <p><strong>Số lần đã thử:</strong> {retryTargetEvent.attempt_count} / {retryTargetEvent.max_attempts} (Dead-letter)</p>
                <p style={{ color: '#991b1b', marginTop: '6px' }}><strong>Lỗi:</strong> {retryTargetEvent.error_message}</p>
              </div>

              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                Lý do can thiệp kỹ thuật (*)
                <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: '#64748b', marginLeft: '6px' }}>
                  (Bắt buộc ghi nhận vào lịch sử kiểm toán audit, tối thiểu 5 ký tự)
                </span>
              </label>

              <textarea
                className="n7-reason-input"
                placeholder="VD: Đã khởi động lại n8n webhook container; Đã sửa timeout kết nối cổng 5678..."
                value={retryReason}
                onChange={(e) => setRetryReason(e.target.value)}
                maxLength={500}
              />

              {retryError && (
                <p style={{ color: '#dc2626', fontSize: '0.82rem', marginTop: '6px' }}>
                  ⚠️ {retryError}
                </p>
              )}
            </div>

            <div className="n7-modal-footer">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setRetryTargetEvent(null)}
                disabled={retrySubmitting}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleConfirmRetry}
                disabled={retrySubmitting}
              >
                {retrySubmitting ? 'Đang gửi…' : '✓ Xác nhận thử lại sự kiện'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
