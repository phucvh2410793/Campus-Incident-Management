import type { UserSummary } from '../../types/auth.ts'
import type { Status } from '../../types/incident.ts'
import { DEPARTMENTS } from '../../mocks/mock-users.ts'

export interface StaffFiltersState {
  search: string
  status: Status | ''
  priority: 'p1' | 'p2' | 'p3' | ''
  category: string
  department_id: string
  sla_state: 'overdue' | 'warning' | 'safe' | 'met' | ''
  triage: 'true' | 'false' | ''
}

interface StaffFilterBarProps {
  currentUser: UserSummary
  filters: StaffFiltersState
  onFilterChange: <K extends keyof StaffFiltersState>(key: K, value: StaffFiltersState[K]) => void
  onResetFilters: () => void
  totalCount: number
  filteredCount: number
}

const statusOptions: { value: Status | ''; label: string }[] = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'reported', label: 'Mới báo cáo (Reported)' },
  { value: 'assigned', label: 'Đã phân công (Assigned)' },
  { value: 'in_progress', label: 'Đang xử lý (In Progress)' },
  { value: 'resolved', label: 'Đã giải quyết (Resolved)' },
  { value: 'closed', label: 'Đã đóng (Closed)' },
]

const priorityOptions: { value: 'p1' | 'p2' | 'p3' | ''; label: string }[] = [
  { value: '', label: 'Tất cả mức ưu tiên' },
  { value: 'p1', label: 'P1 — Khẩn cấp (SLA 15p)' },
  { value: 'p2', label: 'P2 — Cao (SLA 2h)' },
  { value: 'p3', label: 'P3 — Tiêu chuẩn (SLA 8h)' },
]

const categoryOptions = [
  { value: '', label: 'Tất cả loại sự cố' },
  { value: 'water_leak', label: '💧 Rò rỉ nước' },
  { value: 'electrical_hazard', label: '⚡ Nguy hiểm điện' },
  { value: 'phishing', label: '🎣 Tấn công Phishing' },
]

const slaOptions: { value: StaffFiltersState['sla_state']; label: string }[] = [
  { value: '', label: 'Tất cả trạng thái SLA' },
  { value: 'overdue', label: '🚨 Quá hạn tiếp nhận' },
  { value: 'warning', label: '⏳ Sắp quá hạn (<15p)' },
  { value: 'safe', label: '🟢 Còn an toàn' },
  { value: 'met', label: '✅ Đã tiếp nhận đúng hạn' },
]

const triageOptions = [
  { value: '', label: 'Tất cả phân loại' },
  { value: 'true', label: '⏳ Cần phân loại (Triage)' },
  { value: 'false', label: '✅ Đã phân loại' },
]

export function StaffFilterBar({
  currentUser,
  filters,
  onFilterChange,
  onResetFilters,
  totalCount,
  filteredCount,
}: StaffFilterBarProps) {
  const isAdmin = currentUser.role === 'administrator'
  const isManager = currentUser.role === 'department_manager'

  // Has active filters
  const hasActiveFilters = Boolean(
    filters.search ||
    filters.status ||
    filters.priority ||
    filters.category ||
    filters.sla_state ||
    filters.triage ||
    (isAdmin && filters.department_id)
  )

  return (
    <div className="staff-filter-toolbar">
      {/* Primary Row: Search and Core Selects */}
      <div className="filter-controls-row">
        {/* Search input with clear */}
        <div className="filter-search-box">
          <span className="search-icon">🔎</span>
          <input
            type="text"
            className="input-text filter-search-input"
            placeholder="Tìm theo mã sự cố #ID, tiêu đề, địa điểm..."
            value={filters.search}
            onChange={(e) => onFilterChange('search', e.target.value)}
          />
          {filters.search && (
            <button
              type="button"
              className="btn-clear-search"
              onClick={() => onFilterChange('search', '')}
              aria-label="Xóa từ khóa tìm kiếm"
            >
              ✕
            </button>
          )}
        </div>

        {/* Status Dropdown */}
        <div className="filter-item">
          <select
            className="input-select filter-select"
            value={filters.status}
            onChange={(e) => onFilterChange('status', e.target.value as Status | '')}
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Priority Dropdown */}
        <div className="filter-item">
          <select
            className="input-select filter-select"
            value={filters.priority}
            onChange={(e) => onFilterChange('priority', e.target.value as 'p1' | 'p2' | 'p3' | '')}
          >
            {priorityOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Category Dropdown */}
        <div className="filter-item">
          <select
            className="input-select filter-select"
            value={filters.category}
            onChange={(e) => onFilterChange('category', e.target.value)}
          >
            {categoryOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* SLA Status Dropdown */}
        <div className="filter-item">
          <select
            className="input-select filter-select"
            value={filters.sla_state}
            onChange={(e) => onFilterChange('sla_state', e.target.value as StaffFiltersState['sla_state'])}
          >
            {slaOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Triage Filter Dropdown */}
        <div className="filter-item">
          <select
            className="input-select filter-select"
            value={filters.triage}
            onChange={(e) => onFilterChange('triage', e.target.value as 'true' | 'false' | '')}
          >
            {triageOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Department Dropdown (Admin selectable, Manager/Handler locked) */}
        {isAdmin && (
          <div className="filter-item">
            <select
              className="input-select filter-select"
              value={filters.department_id}
              onChange={(e) => onFilterChange('department_id', e.target.value)}
            >
              <option value="">🏢 Tất cả phòng ban</option>
              {Object.values(DEPARTMENTS).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Reset Filters button */}
        {hasActiveFilters && (
          <button
            type="button"
            className="btn btn-sm btn-outline filter-reset-btn"
            onClick={onResetFilters}
          >
            ✕ Đặt lại bộ lọc
          </button>
        )}
      </div>

      {/* Summary Row: Counter & Active Filter Tags */}
      <div className="filter-summary-row">
        <span className="results-counter">
          Đang hiển thị <strong>{filteredCount}</strong> / {totalCount} sự cố
          {currentUser.department_id && !isAdmin && (
            <span className="dept-scope-tag">
              (Phạm vi: {DEPARTMENTS[currentUser.department_id]?.name || currentUser.department_id})
            </span>
          )}
          {isManager && (
            <span className="role-scope-tag">
              [Quản lý]
            </span>
          )}
        </span>

        {/* Active Filter Chips */}
        {hasActiveFilters && (
          <div className="active-chips-container">
            <span className="active-chips-label">Đang lọc theo:</span>
            {filters.search && (
              <span className="active-chip">
                Từ khóa: "{filters.search}"
                <button type="button" onClick={() => onFilterChange('search', '')}>✕</button>
              </span>
            )}
            {filters.status && (
              <span className="active-chip">
                Trạng thái: {statusOptions.find((o) => o.value === filters.status)?.label}
                <button type="button" onClick={() => onFilterChange('status', '')}>✕</button>
              </span>
            )}
            {filters.priority && (
              <span className="active-chip">
                Ưu tiên: {filters.priority.toUpperCase()}
                <button type="button" onClick={() => onFilterChange('priority', '')}>✕</button>
              </span>
            )}
            {filters.category && (
              <span className="active-chip">
                Loại: {categoryOptions.find((o) => o.value === filters.category)?.label}
                <button type="button" onClick={() => onFilterChange('category', '')}>✕</button>
              </span>
            )}
            {filters.sla_state && (
              <span className="active-chip">
                SLA: {slaOptions.find((o) => o.value === filters.sla_state)?.label}
                <button type="button" onClick={() => onFilterChange('sla_state', '')}>✕</button>
              </span>
            )}
            {filters.triage && (
              <span className="active-chip">
                Phân loại: {triageOptions.find((o) => o.value === filters.triage)?.label}
                <button type="button" onClick={() => onFilterChange('triage', '')}>✕</button>
              </span>
            )}
            {isAdmin && filters.department_id && (
              <span className="active-chip">
                Bộ phận: {DEPARTMENTS[filters.department_id]?.code || filters.department_id}
                <button type="button" onClick={() => onFilterChange('department_id', '')}>✕</button>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
