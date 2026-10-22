import { useState, useEffect, useCallback, useTransition } from 'react'
import type { UserSummary } from '../../types/auth.ts'
import type { IncidentResponse } from '../../types/incident.ts'
import { MOCK_USERS } from '../../mocks/mock-users.ts'
import { mockN7StaffRoleApi } from '../../mocks/n7-role-mock-api.ts'
import { transitionGui } from '../../utils/transition.ts'

import { StaffRoleNav } from './StaffRoleNav.tsx'
import { StaffNavigationTabs, type NavTabKey } from './StaffNavigationTabs.tsx'
import { StaffFilterBar, type StaffFiltersState } from './StaffFilterBar.tsx'
import { StaffQueueTable } from './StaffQueueTable.tsx'
import { StaffLoadingSkeleton, StaffEmptyState, StaffErrorState } from './StaffStateFeedback.tsx'
import { StaffIncidentDetailModal } from './StaffIncidentDetailModal.tsx'
import { StaffWireframeView } from '../staff-w1/StaffWireframeView.tsx'

const initialFilters: StaffFiltersState = {
  search: '',
  status: '',
  priority: '',
  category: '',
  department_id: '',
  sla_state: '',
}

export function StaffManagementView() {
  const [viewMode, setViewMode] = useState<'interactive' | 'wireframe'>('interactive')
  const [selectedUserId, setSelectedUserId] = useState<string>('user-manager-csvc')
  const [activeNavTabKey, setActiveNavTabKey] = useState<NavTabKey>('manager-dept-all')
  const [filters, setFilters] = useState<StaffFiltersState>(initialFilters)

  const [rawQueue, setRawQueue] = useState<IncidentResponse[]>([])
  const [displayQueue, setDisplayQueue] = useState<IncidentResponse[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isSimulatedError, setIsSimulatedError] = useState<boolean>(false)
  const [error, setError] = useState<{ isForbidden?: boolean; message?: string } | null>(null)
  const [selectedIncident, setSelectedIncident] = useState<IncidentResponse | null>(null)
  const [, startTransition] = useTransition()

  const [refreshCounter, setRefreshCounter] = useState<number>(0)

  const currentUser: UserSummary = MOCK_USERS[selectedUserId] || MOCK_USERS['user-manager-csvc']

  // Đồng bộ tab mặc định theo vai trò khi đổi user
  const getDefaultTabForRole = useCallback((user: UserSummary): NavTabKey => {
    if (user.role === 'handler') return 'handler-my'
    if (user.role === 'administrator') return 'admin-all'
    if (user.department_id === 'dept-triage') return 'manager-triage'
    return 'manager-dept-all'
  }, [])

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
        startTransition(() => {
          setRawQueue(fullQueue)
          setDisplayQueue(filtered)
          setError(null)
          setIsLoading(false)
        })
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
  }, [currentUser, filters, isSimulatedError, refreshCounter])

  // Xử lý làm mới dữ liệu
  const handleRefresh = () => {
    setIsLoading(true)
    setRefreshCounter((v) => v + 1)
  }

  // Xử lý chuyển vai trò người dùng
  const handleSelectUser = (newUserId: string) => {
    const newUser = MOCK_USERS[newUserId]
    if (!newUser) return

    setIsLoading(true)
    transitionGui(() => {
      setSelectedUserId(newUserId)
      setActiveNavTabKey(getDefaultTabForRole(newUser))
      setFilters(initialFilters)
      setIsSimulatedError(false)
      setSelectedIncident(null)
    })
  }

  // Xử lý chọn tab điều hướng
  const handleSelectNavTab = (tabKey: NavTabKey) => {
    setIsLoading(true)
    transitionGui(() => {
      setActiveNavTabKey(tabKey)

      // Áp dụng bộ lọc nhanh tương ứng với tab điều hướng
      if (tabKey === 'handler-my') {
        setFilters((prev) => ({ ...prev, status: '', sla_state: '', search: '' }))
      } else if (tabKey === 'handler-in-progress') {
        setFilters((prev) => ({ ...prev, status: 'in_progress', sla_state: '' }))
      } else if (tabKey === 'handler-completed') {
        setFilters((prev) => ({ ...prev, status: 'resolved', sla_state: '' }))
      } else if (tabKey === 'manager-dept-all' || tabKey === 'admin-all') {
        setFilters(initialFilters)
      } else if (tabKey === 'manager-unassigned' || tabKey === 'admin-unassigned') {
        setFilters((prev) => ({ ...prev, status: 'reported', sla_state: '' }))
      } else if (tabKey === 'manager-sla' || tabKey === 'admin-sla') {
        setFilters((prev) => ({ ...prev, sla_state: 'overdue' }))
      }
    })
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
    transitionGui(() => {
      setFilters(initialFilters)
    })
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
          selectedUserId={selectedUserId}
          onSelectUser={handleSelectUser}
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
        selectedUserId={selectedUserId}
        onSelectUser={handleSelectUser}
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
              onSwitchToManager={() => handleSelectUser('user-manager-csvc')}
              onSwitchToHandler={() => handleSelectUser('user-handler-csvc')}
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
