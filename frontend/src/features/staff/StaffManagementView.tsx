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

const initialFilters: StaffFiltersState = {
  search: '',
  status: '',
  priority: '',
  category: '',
  department_id: '',
  sla_state: '',
  triage: '',
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

  // Trạng thái Cursor Pagination
  const [pageSize, setPageSize] = useState<number>(5)
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined)
  const [cursorStack, setCursorStack] = useState<string[]>([])
  const [pageInfo, setPageInfo] = useState<{
    currentPage: number
    totalPages: number
    total: number
    nextCursor: string | null
    prevCursor: string | null
  }>({
    currentPage: 1,
    totalPages: 1,
    total: 0,
    nextCursor: null,
    prevCursor: null,
  })

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
        await new Promise((r) => setTimeout(r, 120))
        if (!active) return

        // 1. Lấy toàn bộ hàng đợi cho người dùng này để tính counter trên nav tabs
        const fullQueue = await mockN7StaffRoleApi.getStaffQueue(currentUser)

        // 2. Chuyển đổi triage sang boolean nếu có
        const triageBool = filters.triage === 'true' ? true : filters.triage === 'false' ? false : undefined

        // 3. Lấy dữ liệu phân trang theo cursor từ Mock API
        const paginatedResult = await mockN7StaffRoleApi.getStaffQueueWithCursor(currentUser, {
          department_id: filters.department_id || undefined,
          priority: filters.priority || undefined,
          status: filters.status || undefined,
          category: filters.category || undefined,
          search: filters.search || undefined,
          sla_state: filters.sla_state || undefined,
          triage_required: triageBool,
          tab: activeNavTabKey,
          cursor: currentCursor,
          limit: pageSize,
        })

        if (!active) return
        setRawQueue(fullQueue)
        setDisplayQueue(paginatedResult.items)
        setPageInfo({
          currentPage: paginatedResult.current_page,
          totalPages: paginatedResult.total_pages,
          total: paginatedResult.total,
          nextCursor: paginatedResult.next_cursor,
          prevCursor: paginatedResult.prev_cursor,
        })
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
  }, [currentUser, filters, isSimulatedError, refreshCounter, activeNavTabKey, currentCursor, pageSize])

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
    setCurrentCursor(undefined)
    setCursorStack([])
    setFilters({ ...initialFilters })
    setSelectedIncident(null)
  }

  // Xử lý thay đổi từng trường bộ lọc (reset trang về 1)
  const handleFilterChange = <K extends keyof StaffFiltersState>(
    key: K,
    value: StaffFiltersState[K]
  ) => {
    setIsLoading(true)
    setCurrentCursor(undefined)
    setCursorStack([])
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  // Đặt lại bộ lọc
  const handleResetFilters = () => {
    setIsLoading(true)
    setCurrentCursor(undefined)
    setCursorStack([])
    setFilters({ ...initialFilters })
  }

  // Đổi số lượng phần tử mỗi trang
  const handlePageSizeChange = (newSize: number) => {
    setIsLoading(true)
    setPageSize(newSize)
    setCurrentCursor(undefined)
    setCursorStack([])
  }

  // Chuyển trang sau
  const handleNextPage = () => {
    if (!pageInfo.nextCursor) return
    setIsLoading(true)
    setCursorStack((prev) => [...prev, currentCursor || ''])
    setCurrentCursor(pageInfo.nextCursor)
  }

  // Chuyển trang trước
  const handlePrevPage = () => {
    if (cursorStack.length === 0 && !pageInfo.prevCursor) return
    setIsLoading(true)
    const prevStack = [...cursorStack]
    const lastCursor = prevStack.pop()
    setCursorStack(prevStack)
    setCurrentCursor(lastCursor || undefined)
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
        incidents={rawQueue}
        onSelectIncident={(inc) => setSelectedIncident(inc)}
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
            filteredCount={pageInfo.total}
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
                filters.triage ||
                (currentUser.role === 'administrator' && filters.department_id)
              )}
              onResetFilters={handleResetFilters}
              onRefresh={handleRefresh}
            />
          ) : (
            <>
              <StaffQueueTable
                incidents={displayQueue}
                onSelectIncident={(inc) => setSelectedIncident(inc)}
              />

              {/* Thanh điều khiển phân trang Cursor */}
              <div className="sf-pagination-bar">
                <div className="sf-pagination-left">
                  <span className="sf-pagination-info">
                    Trang <strong>{pageInfo.currentPage}</strong> / {pageInfo.totalPages} ({pageInfo.total} sự cố)
                  </span>
                  <span className="sf-preserved-state-tag" title="Vị trí và bộ lọc được bảo lưu nguyên vẹn khi xem chi tiết sự cố">
                    ✓ Bảo lưu vị trí khi xem chi tiết
                  </span>
                </div>

                <div className="sf-pagination-center">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline sf-page-btn"
                    disabled={!pageInfo.prevCursor && cursorStack.length === 0}
                    onClick={handlePrevPage}
                  >
                    ← Trang trước
                  </button>

                  <span className="sf-page-badge">
                    Trang {pageInfo.currentPage}
                  </span>

                  <button
                    type="button"
                    className="btn btn-sm btn-outline sf-page-btn"
                    disabled={!pageInfo.nextCursor}
                    onClick={handleNextPage}
                  >
                    Trang sau →
                  </button>
                </div>

                <div className="sf-pagination-right">
                  <label className="sf-page-size-label">
                    Hiển thị:
                    <select
                      className="input-select sf-page-size-select"
                      value={pageSize}
                      onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                    >
                      <option value={5}>5 / trang</option>
                      <option value={10}>10 / trang</option>
                      <option value={20}>20 / trang</option>
                    </select>
                  </label>
                  {currentCursor && (
                    <span className="sf-cursor-token-pill" title={`Cursor: ${currentCursor}`}>
                      Cursor: #{currentCursor.substring(0, 8)}…
                    </span>
                  )}
                </div>
              </div>
            </>
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
