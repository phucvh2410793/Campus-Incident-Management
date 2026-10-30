/**
 * Task N7-W01: Mock API Role, Triage, 409 & SLA cho Nhân Viên & Quản Lý (Staff & Manager)
 * Dữ liệu W1 để thử quyền, triage, xung đột phiên bản và SLA theo docs/api-contract.md.
 */

import type { UserSummary } from '../types/auth.ts'
import type {
  Status,
  Priority,
  IncidentResponse,
  HistoryItem,
  Comment,
} from '../types/incident.ts'
import { MOCK_USERS, DEPARTMENTS } from './mock-users.ts'
import { INITIAL_MOCK_INCIDENTS, INITIAL_MOCK_HISTORY, INITIAL_MOCK_COMMENTS } from './mock-incidents.ts'
import { ErrorPresets } from './contract-errors.ts'

// ==========================================
// 1. MA TRẬN PHÂN QUYỀN VAI TRÒ (ROLE PERMISSIONS)
// ==========================================

export const N7_ROLE_PERMISSIONS = {
  reporter: {
    canViewAllInDept: false,
    canViewInternalNotes: false,
    canAssignHandler: false,
    canAcknowledge: false,
    canAdjustPriority: false,
    canResolve: false,
    canClose: false,
    canReopen: false,
    canDisposition: false,
    canTriage: false,
  },
  handler: {
    canViewAllInDept: false,
    canViewInternalNotes: true,
    canAssignHandler: false,
    canAcknowledge: true, // Chỉ incident được giao cho mình
    canAdjustPriority: false,
    canResolve: true, // Điền resolution note
    canClose: false,
    canReopen: false,
    canDisposition: false,
    canTriage: false,
  },
  department_manager: {
    canViewAllInDept: true,
    canViewInternalNotes: true,
    canAssignHandler: true,
    canAcknowledge: true,
    canAdjustPriority: true,
    canResolve: true,
    canClose: true,
    canReopen: true,
    canDisposition: true,
    canTriage: true, // Quản lý hàng đợi triage hoặc bộ phận
  },
  administrator: {
    canViewAllInDept: true, // Xem mọi bộ phận
    canViewInternalNotes: true,
    canAssignHandler: true,
    canAcknowledge: true,
    canAdjustPriority: true,
    canResolve: true,
    canClose: true,
    canReopen: true,
    canDisposition: true,
    canTriage: true,
  },
}

export interface TriageInput {
  expected_version: number
  department_id: string
  priority: Priority
  reason: string
}

export interface AssignInput {
  expected_version: number
  department_id: string
  handler_id: string | null
  reason: string
}

export interface PriorityInput {
  expected_version: number
  priority: Priority
  reason: string
}

export interface StatusTransitionInput {
  expected_version: number
  target_status: Status
  resolution?: string
  reason?: string | null
}

export interface DispositionInput {
  expected_version: number
  kind: 'duplicate' | 'invalid'
  reason: string
  duplicate_of_id?: string | null
}

export interface CursorPaginationParams {
  limit?: number
  cursor?: string
  status?: Status
  category?: string
  priority?: Priority
  department_id?: string
  triage_required?: boolean
  search?: string
  sla_state?: 'safe' | 'warning' | 'overdue' | 'met' | 'unassigned'
  tab?: string
}

export interface CursorPaginatedResult<T> {
  items: T[]
  next_cursor: string | null
  prev_cursor: string | null
  total: number
  page_size: number
  current_page: number
  total_pages: number
}

class N7StaffRoleMockApi {
  private incidents: IncidentResponse[] = JSON.parse(JSON.stringify(INITIAL_MOCK_INCIDENTS))
  private history: Record<string, HistoryItem[]> = JSON.parse(JSON.stringify(INITIAL_MOCK_HISTORY))
  private comments: Record<string, Comment[]> = JSON.parse(JSON.stringify(INITIAL_MOCK_COMMENTS))

  private canRead(incident: IncidentResponse, actor: UserSummary): boolean {
    return actor.role === 'administrator' || (actor.role === 'handler'
      ? incident.assigned_handler_id === actor.id
      : actor.role === 'department_manager' && incident.department_id === actor.department_id)
  }

  private requireManager(incident: IncidentResponse, actor: UserSummary): void {
    if (actor.role !== 'administrator' && (actor.role !== 'department_manager' || incident.department_id !== actor.department_id)) {
      throw ErrorPresets.forbidden('thao tác ngoài bộ phận')
    }
  }

  private requireHandlerOrManager(incident: IncidentResponse, actor: UserSummary): void {
    if (!this.canRead(incident, actor)) throw ErrorPresets.forbidden('thao tác ngoài phạm vi')
  }

  /**
   * Tính deadline SLA tiếp nhận theo contract
   * P1: 15 phút, P2: 2 giờ, P3: 8 giờ tính từ reported_at
   */
  public calculateSlaDeadline(reportedAt: string, priority: Priority): string | null {
    if (!priority) return null
    const base = new Date(reportedAt).getTime()
    let offsetMs = 8 * 3600 * 1000 // P3
    if (priority === 'p1') offsetMs = 15 * 60 * 1000 // P1
    if (priority === 'p2') offsetMs = 2 * 3600 * 1000 // P2
    return new Date(base + offsetMs).toISOString()
  }

  /**
   * Tính trạng thái vi phạm SLA hiện tại
   */
  public getSlaStatus(incident: IncidentResponse): {
    state: 'safe' | 'warning' | 'overdue' | 'met' | 'unassigned'
    remainingMinutes: number
    label: string
  } {
    if (!incident.priority || incident.triage_required) {
      return { state: 'unassigned', remainingMinutes: 0, label: 'Chưa có SLA (Cần triage)' }
    }
    if (incident.acknowledged_at) {
      const late = !!incident.acknowledgment_deadline_at && Date.parse(incident.acknowledged_at) > Date.parse(incident.acknowledgment_deadline_at)
      return { state: late ? 'overdue' : 'met', remainingMinutes: 0, label: late ? 'Đã tiếp nhận trễ hạn' : 'Đã tiếp nhận đúng hạn' }
    }
    if (!incident.acknowledgment_deadline_at) {
      return { state: 'safe', remainingMinutes: 0, label: 'Đang theo dõi' }
    }

    const now = Date.now()
    const deadline = new Date(incident.acknowledgment_deadline_at).getTime()
    const diffMinutes = Math.round((deadline - now) / (60 * 1000))

    if (diffMinutes < 0) {
      return {
        state: 'overdue',
        remainingMinutes: diffMinutes,
        label: `QUÁ HẠN ${Math.abs(diffMinutes)} phút`,
      }
    }
    if (diffMinutes <= 15) {
      return {
        state: 'warning',
        remainingMinutes: diffMinutes,
        label: `Sắp quá hạn (còn ${diffMinutes} phút)`,
      }
    }
    return {
      state: 'safe',
      remainingMinutes: diffMinutes,
      label: `Còn ${diffMinutes} phút`,
    }
  }

  /**
   * Đặt lại dữ liệu mock về trạng thái ban đầu
   */
  public resetData(): void {
    this.incidents = JSON.parse(JSON.stringify(INITIAL_MOCK_INCIDENTS))
    this.history = JSON.parse(JSON.stringify(INITIAL_MOCK_HISTORY))
    this.comments = JSON.parse(JSON.stringify(INITIAL_MOCK_COMMENTS))
  }

  // ==========================================
  // HÀNG ĐỢI SỰ CỐ THEO VAI TRÒ (STAFF QUEUE)
  // ==========================================

  /**
   * Lấy danh sách sự cố theo quyền của nhân viên/quản lý
   */
  async getStaffQueue(
    user: UserSummary,
    filters?: {
      department_id?: string
      priority?: Priority
      status?: Status
      search?: string
      category?: string
      assigned_handler_id?: string | null
      triage_required?: boolean
      sla_state?: 'safe' | 'warning' | 'overdue' | 'met' | 'unassigned'
    }
  ): Promise<IncidentResponse[]> {
    if (user.role === 'reporter' || !['handler', 'department_manager', 'administrator'].includes(user.role)) {
      throw ErrorPresets.forbidden('truy cập bảng điều khiển nhân viên')
    }

    let list = this.incidents.filter((inc) => this.canRead(inc, user))

    // Bộ lọc tùy chọn
    if (filters?.department_id) {
      list = list.filter((inc) => inc.department_id === filters.department_id)
    }
    if (filters?.priority) {
      list = list.filter((inc) => inc.priority === filters.priority)
    }
    if (filters?.status) {
      list = list.filter((inc) => inc.status === filters.status)
    }
    if (filters?.category) {
      list = list.filter((inc) => inc.category === filters.category)
    }
    if (filters?.assigned_handler_id !== undefined) {
      list = list.filter((inc) => inc.assigned_handler_id === filters.assigned_handler_id)
    }
    if (filters?.triage_required !== undefined) {
      list = list.filter((inc) => inc.triage_required === filters.triage_required)
    }
    if (filters?.sla_state) {
      list = list.filter((inc) => this.getSlaStatus(inc).state === filters.sla_state)
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase()
      list = list.filter(
        (inc) =>
          inc.id.toLowerCase().includes(q) ||
          inc.title.toLowerCase().includes(q) ||
          inc.description.toLowerCase().includes(q) ||
          (inc.building && inc.building.toLowerCase().includes(q)) ||
          (inc.location_detail && inc.location_detail.toLowerCase().includes(q))
      )
    }

    return list
  }

  /**
   * Lấy hàng đợi phân loại thủ công (Triage Queue)
   * Các sự cố triage_required = true hoặc priority = null
   */
  async getTriageQueue(user: UserSummary): Promise<IncidentResponse[]> {
    if (user.role !== 'administrator' && (user.role !== 'department_manager' || user.department_id !== 'dept-triage')) {
      throw ErrorPresets.forbidden('truy cập Hàng đợi Triage')
    }
    return this.incidents.filter((inc) => inc.department_id === 'dept-triage' && inc.triage_required)
  }

  /**
   * Task N7-W03: Hàng đợi với Cursor Pagination & Bộ lọc nghiệp vụ
   * GET /api/v1/incidents
   */
  async getStaffQueueWithCursor(
    user: UserSummary,
    params?: CursorPaginationParams
  ): Promise<CursorPaginatedResult<IncidentResponse>> {
    if (user.role === 'reporter' || !['handler', 'department_manager', 'administrator'].includes(user.role)) {
      throw ErrorPresets.forbidden('truy cập bảng điều khiển nhân viên')
    }

    let list = this.incidents.filter((inc) => this.canRead(inc, user))

    // 1. Lọc theo department
    if (params?.department_id) {
      list = list.filter((inc) => inc.department_id === params.department_id)
    }

    // 2. Lọc theo priority
    if (params?.priority) {
      list = list.filter((inc) => inc.priority === params.priority)
    }

    // 3. Lọc theo status
    if (params?.status) {
      list = list.filter((inc) => inc.status === params.status)
    }

    // 4. Lọc theo category
    if (params?.category) {
      list = list.filter((inc) => inc.category === params.category)
    }

    // 5. Lọc theo triage
    if (params?.triage_required !== undefined) {
      list = list.filter((inc) => inc.triage_required === params.triage_required)
    }

    // 6. Lọc theo SLA
    if (params?.sla_state) {
      list = list.filter((inc) => this.getSlaStatus(inc).state === params.sla_state)
    }

    // 7. Lọc theo search
    if (params?.search && params.search.trim()) {
      const q = params.search.toLowerCase().trim()
      list = list.filter(
        (inc) =>
          inc.id.toLowerCase().includes(q) ||
          inc.title.toLowerCase().includes(q) ||
          inc.description.toLowerCase().includes(q) ||
          (inc.building && inc.building.toLowerCase().includes(q)) ||
          (inc.location_detail && inc.location_detail.toLowerCase().includes(q))
      )
    }

    // 8. Lọc theo tab điều hướng nếu có
    if (params?.tab) {
      if (params.tab === 'handler-in-progress') list = list.filter((i) => i.status === 'in_progress')
      else if (params.tab === 'handler-completed') list = list.filter((i) => i.status === 'resolved' || i.status === 'closed')
      else if (params.tab === 'manager-unassigned' || params.tab === 'admin-unassigned') {
        list = list.filter((i) => !i.assigned_handler_id && (i.status === 'reported' || i.status === 'assigned'))
      } else if (params.tab === 'manager-triage' || params.tab === 'admin-triage') {
        list = list.filter((i) => i.triage_required)
      } else if (params.tab === 'manager-sla' || params.tab === 'admin-sla') {
        list = list.filter((i) => ['overdue', 'warning'].includes(this.getSlaStatus(i).state))
      }
    }

    // Sắp xếp ổn định theo contract: reported_at DESC, id DESC
    list.sort((a, b) => {
      const timeDiff = new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()
      if (timeDiff !== 0) return timeDiff
      return b.id.localeCompare(a.id)
    })

    const limit = Math.max(1, Math.min(params?.limit || 5, 100))
    let startIndex = 0

    const encodeCursor = (offset: number) => {
      const payload = JSON.stringify({ offset, v: 1, ts: 1729000000 })
      if (typeof btoa !== 'undefined') return btoa(payload)
      const g = globalThis as { Buffer?: { from: (s: string, enc?: string) => { toString: (e: string) => string } } }
      return g.Buffer?.from(payload, 'utf8').toString('base64') || payload
    }

    const decodeCursor = (cursorStr: string): number => {
      try {
        let decoded = ''
        if (typeof atob !== 'undefined') {
          decoded = atob(cursorStr)
        } else {
          const g = globalThis as { Buffer?: { from: (s: string, enc?: string) => { toString: (e: string) => string } } }
          decoded = g.Buffer?.from(cursorStr, 'base64').toString('utf8') || ''
        }
        const parsed = JSON.parse(decoded) as { offset?: number }
        return typeof parsed.offset === 'number' && parsed.offset >= 0 ? parsed.offset : 0
      } catch {
        return 0
      }
    }

    if (params?.cursor) {
      startIndex = decodeCursor(params.cursor)
    }

    const items = list.slice(startIndex, startIndex + limit)
    const nextOffset = startIndex + limit
    const prevOffset = Math.max(0, startIndex - limit)

    const next_cursor = nextOffset < list.length ? encodeCursor(nextOffset) : null
    const prev_cursor = startIndex > 0 ? encodeCursor(prevOffset) : null
    const current_page = Math.floor(startIndex / limit) + 1
    const total_pages = Math.max(1, Math.ceil(list.length / limit))

    return {
      items,
      next_cursor,
      prev_cursor,
      total: list.length,
      page_size: limit,
      current_page,
      total_pages,
    }
  }

  // ==========================================
  // CÁC THAO TÁC CỦA NHÂN VIÊN & QUẢN LÝ
  // ==========================================

  /**
   * POST /api/v1/incidents/:id/triage
   * Quản lý phân loại thủ công sự cố thiếu dữ liệu
   */
  async triageIncident(id: string, input: TriageInput, actor: UserSummary): Promise<IncidentResponse> {
    const incident = this.incidents.find((inc) => inc.id === id)
    if (!incident) throw ErrorPresets.notFound()
    if (incident.department_id !== 'dept-triage' || (actor.role !== 'administrator' && (actor.role !== 'department_manager' || actor.department_id !== 'dept-triage'))) {
      throw ErrorPresets.forbidden('phân loại Triage')
    }
    if (!incident.triage_required || incident.status !== 'reported') throw ErrorPresets.invalidTransition(incident.status, 'triage')
    if (!DEPARTMENTS[input.department_id] || input.department_id === 'dept-triage' || !['p1', 'p2', 'p3'].includes(input.priority || '') || !input.reason?.trim()) {
      throw ErrorPresets.validationError([{ field: 'triage', reason: 'Cần bộ phận đích, độ ưu tiên và lý do hợp lệ.' }])
    }

    // Optimistic Concurrency Control 409
    if (incident.version !== input.expected_version) {
      throw ErrorPresets.versionConflict(input.expected_version, incident.version)
    }

    const nowIso = new Date().toISOString()
    incident.version += 1
    incident.department_id = input.department_id
    incident.department_name = DEPARTMENTS[input.department_id]?.name || input.department_id
    incident.priority = input.priority
    incident.triage_required = false
    incident.acknowledgment_deadline_at = this.calculateSlaDeadline(incident.reported_at, input.priority)

    if (!this.history[id]) this.history[id] = []
    this.history[id].push({
      id: 'hist-' + Date.now(),
      action: 'triaged',
      actor_display_name: actor.display_name,
      visibility: 'internal',
      created_at: nowIso,
      details: {
        department_id: input.department_id,
        priority: input.priority,
        reason: input.reason,
        new_version: incident.version,
      },
    })

    return incident
  }

  /**
   * POST /api/v1/incidents/:id/assign
   * Quản lý phân công kỹ thuật viên (Handler) xử lý sự cố
   */
  async assignIncident(id: string, input: AssignInput, actor: UserSummary): Promise<IncidentResponse> {
    const incident = this.incidents.find((inc) => inc.id === id)
    if (!incident) throw ErrorPresets.notFound()
    this.requireManager(incident, actor)
    if (!['reported', 'assigned', 'in_progress'].includes(incident.status)) throw ErrorPresets.invalidTransition(incident.status, 'assigned')
    if (!DEPARTMENTS[input.department_id] || input.department_id === 'dept-triage' || !input.reason?.trim()) {
      throw ErrorPresets.validationError([{ field: 'department_id', reason: 'Bộ phận đích hoặc lý do không hợp lệ.' }])
    }
    if (incident.triage_required && input.department_id === 'dept-triage') throw ErrorPresets.invalidTransition('triage', 'assigned')

    // Optimistic Concurrency Control 409
    if (incident.version !== input.expected_version) {
      throw ErrorPresets.versionConflict(input.expected_version, incident.version)
    }

    const handler = input.handler_id ? Object.values(MOCK_USERS).find((u) => u.id === input.handler_id) : null
    if (input.handler_id && (!handler || handler.role !== 'handler' || handler.department_id !== input.department_id)) {
      throw ErrorPresets.validationError([{ field: 'handler_id', reason: 'Nhân viên chỉ định không hợp lệ.' }])
    }

    const nowIso = new Date().toISOString()
    incident.version += 1
    incident.department_id = input.department_id
    incident.department_name = DEPARTMENTS[input.department_id].name
    incident.triage_required = false
    incident.assigned_handler_id = handler?.id || null
    incident.assigned_handler_name = handler?.display_name
    incident.assigned_at = nowIso
    if (incident.status === 'reported') incident.status = 'assigned'

    if (!this.history[id]) this.history[id] = []
    this.history[id].push({
      id: 'hist-' + Date.now(),
      action: 'handler_assigned',
      actor_display_name: actor.display_name,
      visibility: 'internal',
      created_at: nowIso,
      details: {
        handler_name: handler?.display_name || null,
        reason: input.reason,
        new_version: incident.version,
      },
    })

    return incident
  }

  /**
   * POST /api/v1/incidents/:id/acknowledge
   * Handler nhận việc: chuyển assigned -> in_progress, ghi acknowledged_at, DỪNG SLA VI PHẠM
   */
  async acknowledgeIncident(id: string, expectedVersion: number, handler: UserSummary): Promise<IncidentResponse> {
    const incident = this.incidents.find((inc) => inc.id === id)
    if (!incident) throw ErrorPresets.notFound()
    this.requireHandlerOrManager(incident, handler)
    if (incident.status !== 'assigned') throw ErrorPresets.invalidTransition(incident.status, 'in_progress')

    if (incident.version !== expectedVersion) {
      throw ErrorPresets.versionConflict(expectedVersion, incident.version)
    }

    const nowIso = new Date().toISOString()
    incident.version += 1
    incident.status = 'in_progress'
    incident.acknowledged_at = nowIso

    if (!this.history[id]) this.history[id] = []
    this.history[id].push({
      id: 'hist-' + Date.now(),
      action: 'acknowledged',
      actor_display_name: handler.display_name,
      visibility: 'public',
      created_at: nowIso,
      details: {
        acknowledged_at: nowIso,
        status: 'in_progress',
        note: 'Kỹ thuật viên đã tiếp nhận hiện trường. Đồng hồ SLA dừng tính thời gian vi phạm ban đầu.',
      },
    })

    return incident
  }

  /**
   * PATCH /api/v1/incidents/:id/priority
   * Quản lý điều chỉnh độ ưu tiên P1/P2/P3: Tự động tính lại deadline SLA từ reported_at
   */
  async adjustPriority(id: string, input: PriorityInput, actor: UserSummary): Promise<IncidentResponse> {
    const incident = this.incidents.find((inc) => inc.id === id)
    if (!incident) throw ErrorPresets.notFound()
    this.requireManager(incident, actor)
    if (!['p1', 'p2', 'p3'].includes(input.priority || '') || !input.reason?.trim()) {
      throw ErrorPresets.validationError([{ field: 'priority', reason: 'Cần ưu tiên và lý do hợp lệ.' }])
    }

    if (incident.version !== input.expected_version) {
      throw ErrorPresets.versionConflict(input.expected_version, incident.version)
    }

    const nowIso = new Date().toISOString()
    const oldPriority = incident.priority
    incident.version += 1
    incident.priority = input.priority
    // Tính lại SLA deadline từ ngày báo cáo gốc
    if (!incident.acknowledged_at) incident.acknowledgment_deadline_at = this.calculateSlaDeadline(incident.reported_at, input.priority)

    if (!this.history[id]) this.history[id] = []
    this.history[id].push({
      id: 'hist-' + Date.now(),
      action: 'priority_changed',
      actor_display_name: actor.display_name,
      visibility: 'internal',
      created_at: nowIso,
      details: {
        from_priority: oldPriority,
        to_priority: input.priority,
        reason: input.reason,
        new_deadline: incident.acknowledgment_deadline_at,
      },
    })

    return incident
  }

  /**
   * POST /api/v1/incidents/:id/transitions
   * Chuyển trạng thái xử lý sự cố (Transitions)
   */
  async transitionStatus(id: string, input: StatusTransitionInput, actor: UserSummary): Promise<IncidentResponse> {
    const incident = this.incidents.find((inc) => inc.id === id)
    if (!incident) throw ErrorPresets.notFound()
    this.requireHandlerOrManager(incident, actor)

    if (incident.version !== input.expected_version) {
      throw ErrorPresets.versionConflict(input.expected_version, incident.version)
    }

    const nowIso = new Date().toISOString()
    const oldStatus = incident.status

    const edge = `${oldStatus}->${input.target_status}`
    if (!['in_progress->resolved', 'resolved->closed', 'resolved->in_progress', 'closed->in_progress'].includes(edge)) {
      throw ErrorPresets.invalidTransition(oldStatus, input.target_status)
    }
    if (input.target_status !== 'resolved' && actor.role !== 'department_manager' && actor.role !== 'administrator') {
      throw ErrorPresets.forbidden('đóng hoặc mở lại sự cố')
    }
    if (input.target_status === 'resolved') {
      if (!input.resolution?.trim()) {
        throw ErrorPresets.validationError([
          { field: 'resolution', reason: 'Bắt buộc nhập kết quả xử lý.' },
        ])
      }
      incident.resolved_at = nowIso
      incident.resolution = input.resolution.trim()
    } else if (input.target_status === 'closed') {
      incident.closed_at = nowIso
    } else if (!input.reason?.trim()) {
      throw ErrorPresets.validationError([{ field: 'reason', reason: 'Bắt buộc nêu lý do mở lại.' }])
    }

    incident.version += 1
    incident.status = input.target_status

    if (!this.history[id]) this.history[id] = []
    this.history[id].push({
      id: 'hist-' + Date.now(),
      action: `status_${input.target_status}`,
      actor_display_name: actor.display_name,
      visibility: 'public',
      created_at: nowIso,
      details: {
        from_status: oldStatus,
        to_status: input.target_status,
        note: input.resolution || input.reason || 'Cập nhật trạng thái sự cố',
      },
    })

    return incident
  }

  /**
   * POST /api/v1/incidents/:id/disposition
   * Đánh dấu sự cố là báo trùng (Duplicate) hoặc không hợp lệ (Invalid)
   */
  async dispositionIncident(id: string, input: DispositionInput, actor: UserSummary): Promise<IncidentResponse> {
    const incident = this.incidents.find((inc) => inc.id === id)
    if (!incident) throw ErrorPresets.notFound()
    this.requireManager(incident, actor)
    if (incident.status === 'closed') throw ErrorPresets.invalidTransition('closed', 'disposition')
    if (!['duplicate', 'invalid'].includes(input.kind) || !input.reason?.trim() || (input.kind === 'duplicate' && !input.duplicate_of_id)) {
      throw ErrorPresets.validationError([{ field: 'disposition', reason: 'Loại, lý do hoặc mã báo cáo trùng không hợp lệ.' }])
    }

    if (incident.version !== input.expected_version) {
      throw ErrorPresets.versionConflict(input.expected_version, incident.version)
    }

    const nowIso = new Date().toISOString()
    incident.version += 1
    incident.status = 'closed'
    incident.closed_at = nowIso
    incident.disposition = {
      kind: input.kind,
      reason: input.reason,
      duplicate_of_id: input.duplicate_of_id || null,
    }

    if (!this.history[id]) this.history[id] = []
    this.history[id].push({
      id: 'hist-' + Date.now(),
      action: `disposition_${input.kind}`,
      actor_display_name: actor.display_name,
      visibility: 'internal',
      created_at: nowIso,
      details: {
        kind: input.kind,
        reason: input.reason,
        duplicate_of_id: input.duplicate_of_id,
      },
    })

    return incident
  }

  /**
   * Xem toàn bộ timeline bao gồm cả ghi chú nội bộ (dành cho Staff/Manager)
   */
  async getStaffFullHistory(id: string, actor: UserSummary): Promise<HistoryItem[]> {
    const incident = this.incidents.find((inc) => inc.id === id)
    if (!incident) throw ErrorPresets.notFound()
    this.requireHandlerOrManager(incident, actor)
    return this.history[id] || []
  }

  /**
   * Thêm ghi chú nội bộ của nhân viên
   */
  async addInternalNote(id: string, content: string, actor: UserSummary): Promise<Comment> {
    const incident = this.incidents.find((inc) => inc.id === id)
    if (!incident) throw ErrorPresets.notFound()
    this.requireHandlerOrManager(incident, actor)
    if (!content?.trim() || content.length > 2000) throw ErrorPresets.validationError([{ field: 'body', reason: 'Từ 1 đến 2000 ký tự.' }])

    const newComment: Comment = {
      id: 'cmt-' + Date.now(),
      body: content.trim(),
      visibility: 'internal',
      author_id: actor.id,
      author_name: actor.display_name,
      created_at: new Date().toISOString(),
    }

    if (!this.comments[id]) this.comments[id] = []
    this.comments[id].push(newComment)
    return newComment
  }
}

export const mockN7StaffRoleApi = new N7StaffRoleMockApi()
