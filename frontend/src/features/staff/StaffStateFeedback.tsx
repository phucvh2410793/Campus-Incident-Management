interface StaffLoadingSkeletonProps {
  rowCount?: number
}

export function StaffLoadingSkeleton({ rowCount = 5 }: StaffLoadingSkeletonProps) {
  return (
    <div className="staff-loading-container" aria-busy="true" aria-label="Đang tải danh sách sự cố">
      <div className="staff-loading-bar">
        <span className="spinner-inline"></span>
        <span className="loading-text">Đang đồng bộ dữ liệu hàng đợi từ Mock API theo phân quyền...</span>
      </div>
      <table className="queue-table table-skeleton">
        <thead>
          <tr>
            <th style={{ width: '15%' }}>MÃ &amp; PHIÊN BẢN</th>
            <th style={{ width: '25%' }}>TIÊU ĐỀ &amp; ĐỊA ĐIỂM</th>
            <th style={{ width: '12%' }}>LOẠI SỰ CỐ</th>
            <th style={{ width: '10%' }}>ƯU TIÊN</th>
            <th style={{ width: '15%' }}>BỘ PHẬN &amp; KTV</th>
            <th style={{ width: '10%' }}>TRẠNG THÁI</th>
            <th style={{ width: '13%' }}>GIÁM SÁT SLA</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }).map((_, idx) => (
            <tr key={idx} className="skeleton-row">
              <td>
                <div className="skeleton-line line-short"></div>
              </td>
              <td>
                <div className="skeleton-line line-long"></div>
                <div className="skeleton-line line-medium mt-1"></div>
              </td>
              <td>
                <div className="skeleton-line line-badge"></div>
              </td>
              <td>
                <div className="skeleton-line line-badge"></div>
              </td>
              <td>
                <div className="skeleton-line line-medium"></div>
              </td>
              <td>
                <div className="skeleton-line line-badge"></div>
              </td>
              <td>
                <div className="skeleton-line line-long"></div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface StaffEmptyStateProps {
  hasActiveFilters: boolean
  onResetFilters?: () => void
  onRefresh?: () => void
}

export function StaffEmptyState({ hasActiveFilters, onResetFilters, onRefresh }: StaffEmptyStateProps) {
  return (
    <div className="staff-state-card staff-state-empty">
      <div className="state-icon-box">
        {hasActiveFilters ? '🔍' : '📭'}
      </div>
      <h3 className="state-title">
        {hasActiveFilters ? 'Không tìm thấy sự cố phù hợp' : 'Hàng đợi sự cố trống'}
      </h3>
      <p className="state-description">
        {hasActiveFilters
          ? 'Không có sự cố nào khớp với các tiêu chí tìm kiếm hoặc bộ lọc hiện tại của bạn.'
          : 'Hiện không có sự cố nào cần xử lý trong phạm vi quyền hạn và bộ phận của bạn.'}
      </p>
      <div className="state-actions">
        {hasActiveFilters && onResetFilters && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onResetFilters}>
            ✕ Đặt lại tất cả bộ lọc
          </button>
        )}
        {onRefresh && (
          <button type="button" className="btn btn-outline btn-sm" onClick={onRefresh}>
            🔄 Kiểm tra lại hàng đợi
          </button>
        )}
      </div>
    </div>
  )
}

interface StaffErrorStateProps {
  isForbidden?: boolean
  errorMessage?: string
  onRetry?: () => void
  onSwitchToManager?: () => void
  onSwitchToHandler?: () => void
}

export function StaffErrorState({
  isForbidden = false,
  errorMessage,
  onRetry,
  onSwitchToManager,
  onSwitchToHandler,
}: StaffErrorStateProps) {
  if (isForbidden) {
    return (
      <div className="staff-state-card staff-state-forbidden" role="alert">
        <div className="state-icon-box forbidden-icon">🔒</div>
        <h3 className="state-title text-danger">403 Forbidden — Quyền Truy Cập Bị Từ Chối</h3>
        <p className="state-description">
          Tài khoản hiện tại của bạn thuộc vai trò <strong>Người báo cáo (Reporter)</strong>.
          <br />
          Theo ma trận phân quyền hệ thống, bảng điều khiển vận hành này chỉ dành riêng cho{' '}
          <strong>Kỹ thuật viên (Handler)</strong> và <strong>Quản lý bộ phận (Manager / Admin)</strong>.
        </p>
        <div className="permission-matrix-callout">
          <strong>Ma trận phân quyền nhân viên &amp; quản lý:</strong>
          <ul>
            <li><code>reporter</code>: Chỉ được xem và gửi báo cáo của chính mình (Tab Người báo cáo).</li>
            <li><code>handler</code>: Tiếp nhận và xử lý sự cố được phân công trực tiếp trong bộ phận.</li>
            <li><code>department_manager</code>: Phân công KTV, đổi độ ưu tiên, giám sát SLA và đóng sự cố thuộc bộ phận.</li>
            <li><code>administrator</code>: Toàn quyền truy cập mọi bộ phận và hàng đợi Triage trung tâm.</li>
          </ul>
        </div>
        <div className="state-actions mt-3">
          {onSwitchToManager && (
            <button type="button" className="btn btn-primary" onClick={onSwitchToManager}>
              👤 Chuyển sang Trưởng ban CSVC (Manager)
            </button>
          )}
          {onSwitchToHandler && (
            <button type="button" className="btn btn-outline" onClick={onSwitchToHandler}>
              🛠️ Chuyển sang KTV CSVC (Handler)
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="staff-state-card staff-state-error" role="alert">
      <div className="state-icon-box error-icon">⚠️</div>
      <h3 className="state-title text-danger">Không thể tải danh sách sự cố</h3>
      <p className="state-description">
        {errorMessage || 'Đã xảy ra lỗi khi kết nối với dịch vụ Mock API lấy dữ liệu hàng đợi.'}
      </p>
      <div className="state-error-details">
        <code>Mã lỗi: 500 / E_MOCK_NETWORK_FAILURE</code>
        <span>•</span>
        <span>Hệ thống thử kết nối lại hoặc kiểm tra cài đặt mô phỏng.</span>
      </div>
      <div className="state-actions mt-3">
        {onRetry && (
          <button type="button" className="btn btn-danger btn-sm" onClick={onRetry}>
            🔄 Thử lại ngay
          </button>
        )}
      </div>
    </div>
  )
}
