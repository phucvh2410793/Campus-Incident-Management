import { useState, useEffect } from 'react'
import type { UserSummary } from '../../types/auth.ts'
import type { IncidentResponse } from '../../types/incident.ts'
import { mockN7StaffRoleApi } from '../../mocks/n7-role-mock-api.ts'

import { StaffRoleNav } from './StaffRoleNav.tsx'
import { StaffNavigationTabs, type NavTabKey } from './StaffNavigationTabs.tsx'
import { StaffFilterBar, type StaffFiltersState } from './StaffFilterBar.tsx'
import { StaffQueueTable } from './StaffQueueTable.tsx'
import { StaffLoadingSkeleton, StaffEmptyState, StaffErrorState } from './StaffStateFeedback.tsx'
import { StaffIncidentDetailModal } from './StaffIncidentDetailModal.tsx'
import { StaffWireframeView } from '../staff-w1/StaffWireframeView.tsx'
import { matchesNavigationTab } from './matchesNavigationTab.ts'

const initialFilters: StaffFiltersState = {
  search: '',
  status: '',
  priority: '',
  category: '',
  department_id: '',
  sla_state: '',
}

function defaultTabForRole(user: UserSummary): NavTabKey {
  if (user.role === 'handler') return 'handler-my'
  if (user.role === 'administrator') return 'admin-all'
  if (user.department_id === 'dept-triage') return 'manager-triage'
  return 'manager-dept-all'
}

export function StaffManagementView({ user }: { user: UserSummary }) {
  const [viewMode, setViewMode] = useState<'interactive' | 'wireframe'>('interactive')
  const [activeNavTabKey, setActiveNavTabKey] = useState<NavTabKey>(() => defaultTabForRole(user))
  const [filters, setFilters] = useState<StaffFiltersState>(initialFilters)

  const [rawQueue, setRawQueue] = useState<IncidentResponse[]>([])
  const [displayQueue, setDisplayQueue] = useState<IncidentResponse[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isSimulatedError, setIsSimulatedError] = useState<boolean>(false)
  const [error, setError] = useState<{ isForbidden?: boolean; message?: string } | null>(null)
  const [selectedIncident, setSelectedIncident] = useState<IncidentResponse | null>(null)
  const [refreshCounter, setRefreshCounter] = useState<number>(0)
  const currentUser = user

  // Effect nạp dữ liệu từ Mock API
  useEffect(() => {
    let active = true

    const loadData = async () => {
      // Role Guard: Nếu là reporter thì báo lỗi 403 Forbidden
      if (currentUser.role === 'reporter') {
        await new Promise((r) => setTimeout(r, 120))
        if (!active) return
        setError({
          isForbidden: true,
          message: 'Quyền truy cập bị từ chối: Tài khoản Người báo cáo (Reporter) không có quyền vào Staff Console.',
        })
        setRawQueue([])
        setDisplayQueue([])
        setIsLoading(false)
        return
      }

      // Kiểm tra mô phỏng lỗi mạng
      if (isSimulatedError) {
        await new Promise((r) => setTimeout(r, 180))
        if (!active) return
        setError({
          isForbidden: false,
          message: 'Lỗi mô phỏng kết nối Mock API (Mã lỗi: 500 / E_MOCK_NETWORK_FAILURE). Vui lòng thử lại.',
        })
        setIsLoading(false)
        return
      }

      try {
        await new Promise((r) => setTimeout(r, 180))
        if (!active) return

        // 1. Lấy toàn bộ hàng đợi cho người dùng này để tính counter trên nav tabs
        const fullQueue = await mockN7StaffRoleApi.getStaffQueue(currentUser)

        // 2. Lấy danh sách đã áp dụng bộ lọc từ Mock API
        const filtered = await mockN7StaffRoleApi.getStaffQueue(currentUser, {
          department_id: filters.department_id || undefined,
          priority: filters.priority || undefined,
          status: filters.status || undefined,
          category: filters.category || undefined,
          search: filters.search || undefined,
          sla_state: filters.sla_state || undefined,
        })

        if (!active) return
        setRawQueue(fullQueue)
        setDisplayQueue(filtered.filter((incident) => matchesNavigationTab(incident, activeNavTabKey)))
        setError(null)
        setIsLoading(false)
      } catch (err: unknown) {
        if (!active) return
        const errObj = err as { error?: { code?: string; message?: string } }
        setError({
          isForbidden: errObj?.error?.code === 'forbidden',
          message: errObj?.error?.message || 'Không thể tải hàng đợi sự cố.',
        })
        setIsLoading(false)
      }
    }

    loadData()

    return () => {
      active = false
    }
  }, [currentUser, filters, isSimulatedError, refreshCounter, activeNavTabKey])

  // Xử lý làm mới dữ liệu
  const handleRefresh = () => {
    setIsLoading(true)
    setRefreshCounter((v) => v + 1)
  }

  // Xử lý chọn tab điều hướng
  const handleSelectNavTab = (tabKey: NavTabKey) => {
    if (tabKey === activeNavTabKey) return
    setIsLoading(true)
    setActiveNavTabKey(tabKey)
    setFilters({ ...initialFilters })
    setSelectedIncident(null)
  }

  // Xử lý thay đổi từng trường bộ lọc
  const handleFilterChange = <K extends keyof StaffFiltersState>(
    key: K,
    value: StaffFiltersState[K]
  ) => {
    setIsLoading(true)
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  // Đặt lại bộ lọc
  const handleResetFilters = () => {
    setIsLoading(true)
    setFilters({ ...initialFilters })
  }

  // Đặt lại dữ liệu mẫu
  const handleResetData = () => {
    mockN7StaffRoleApi.resetData()
    handleRefresh()
  }

  // Nếu người dùng chọn xem Wireframe W1
  if (viewMode === 'wireframe') {
    return (
      <div className="staff-view-wrapper">
        <StaffRoleNav
          currentUser={currentUser}
          isSimulatedError={isSimulatedError}
          onToggleSimulatedError={() => {
            setIsLoading(true)
            setIsSimulatedError((v) => !v)
          }}
          onRefresh={handleRefresh}
          onResetData={handleResetData}
          viewMode={viewMode}
          onToggleViewMode={setViewMode}
        />
        <div className="mt-3">
          <StaffWireframeView />
        </div>
      </div>
    )
  }

  return (
    <div className="staff-management-container">
      {/* 1. Header phân quyền và thanh công cụ vai trò */}
      <StaffRoleNav
        currentUser={currentUser}
        isSimulatedError={isSimulatedError}
        onToggleSimulatedError={() => {
          setIsLoading(true)
          setIsSimulatedError((v) => !v)
        }}
        onRefresh={handleRefresh}
        onResetData={handleResetData}
        viewMode={viewMode}
        onToggleViewMode={setViewMode}
      />

      {/* 2. Menu điều hướng theo vai trò (Role Navigation) */}
      {currentUser.role !== 'reporter' && (
        <StaffNavigationTabs
          currentUser={currentUser}
          activeTabKey={activeNavTabKey}
          onSelectTab={handleSelectNavTab}
          queueItems={rawQueue}
        />
      )}

      {/* 3. Bảng điều khiển chính và Bộ lọc */}
      <div className="staff-main-card">
        {currentUser.role !== 'reporter' && !error && (
          <StaffFilterBar
            currentUser={currentUser}
            filters={filters}
            onFilterChange={handleFilterChange}
            onResetFilters={handleResetFilters}
            totalCount={rawQueue.length}
            filteredCount={displayQueue.length}
          />
        )}

        {/* 4. Vùng hiển thị trạng thái: Loading / Error / Empty / Data Table */}
        <div className="staff-content-region">
          {isLoading ? (
            <StaffLoadingSkeleton rowCount={5} />
          ) : error ? (
            <StaffErrorState
              isForbidden={error.isForbidden}
              errorMessage={error.message}
              onRetry={() => {
                setIsSimulatedError(false)
                handleRefresh()
              }}
            />
          ) : displayQueue.length === 0 ? (
            <StaffEmptyState
              hasActiveFilters={Boolean(
                filters.search ||
                filters.status ||
                filters.priority ||
                filters.category ||
                filters.sla_state ||
                (currentUser.role === 'administrator' && filters.department_id)
              )}
              onResetFilters={handleResetFilters}
              onRefresh={handleRefresh}
            />
          ) : (
            <StaffQueueTable
              incidents={displayQueue}
              onSelectIncident={(inc) => setSelectedIncident(inc)}
            />
          )}
        </div>
      </div>

      {/* 5. Modal xem nhanh chi tiết sự cố */}
      {selectedIncident && (
        <StaffIncidentDetailModal
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
        />
      )}
    </div>
  )
}
