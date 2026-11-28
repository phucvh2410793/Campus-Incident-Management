/**
 * Task N7-W08: Staff API Adapter kết nối Backend API thật (N1 / N2 / N3 / N4 / N5)
 * Cung cấp cầu nối Adapter chuẩn cho Staff & Management Console:
 * - Hỗ trợ cả 2 chế độ: API Thật (Real Backend qua DB) và Mock Adapter (Dự phòng / Demo).
 * - Hoàn thành chu trình vòng đời sự cố cốt lõi: Triage → assign → ack → resolve → close.
 * - Tuân thủ Optimistic Concurrency Control (expected_version, 409 conflict).
 */

import type { UserSummary } from '../types/auth.ts'
import type {
  IncidentResponse,
  Comment,
  HistoryItem,
  AttachmentSummary,
  Priority,
  Status,
} from '../types/incident.ts'
import {
  mockN7StaffRoleApi,
  type AssignInput,
  type TriageInput,
  type PriorityInput,
  type AddCommentInput,
  type StatusTransitionInput,
  type DispositionInput,
  type PermissionStatus,
} from '../mocks/n7-role-mock-api.ts'
import { DEPARTMENTS, MOCK_USERS } from '../mocks/mock-users.ts'

export type AdapterMode = 'real' | 'mock'

const demoDepartmentIds: Record<string, string> = {
  'dept-csvc': '20000000-0000-4000-8000-000000000001',
  'dept-dien': '20000000-0000-4000-8000-000000000002',
  'dept-it': '20000000-0000-4000-8000-000000000003',
  'dept-triage': '20000000-0000-4000-8000-000000000004',
}
export const realDepartmentId = (id: string) => demoDepartmentIds[id] || id
export const departmentName = (id: string | null) => {
  if (!id) return 'Chưa gán'
  const alias = Object.keys(demoDepartmentIds).find(key => demoDepartmentIds[key] === id) || id
  return DEPARTMENTS[alias]?.name || id
}
const realHandlerId = (id: string | null) => id === 'user-handler-csvc'
  ? '10000000-0000-4000-8000-000000000002' : id
export const handlerName = (id: string | null) => {
  if (!id) return 'Chưa chỉ định'
  if (id === '10000000-0000-4000-8000-000000000002') return 'Demo Handler'
  return Object.values(MOCK_USERS).find(user => user.id === id)?.display_name || `Nhân viên ${id.slice(0, 8)}`
}

export interface StaffQueueParams {
  department_id?: string
  priority?: Priority
  status?: Status
  category?: string
  search?: string
  sla_state?: 'safe' | 'warning' | 'overdue' | 'met' | 'unassigned'
  triage_required?: boolean
  tab?: string
  cursor?: string
  limit?: number
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  current_page: number
  total_pages: number
  next_cursor: string | null
  prev_cursor: string | null
}

export interface TransitionInput {
  expected_version: number
  target_status: Status
  resolution?: string
  reason?: string | null
}

class StaffApiAdapter {
  private mode: AdapterMode = 'real'
  private token: string | null = null
  private baseUrl = '/api/v1'

  constructor() {
    // Tự động kiểm tra nếu có cấu hình môi trường hoặc cờ lưu tạm
    if (typeof window !== 'undefined') {
      const savedMode = window.localStorage?.getItem('cim_adapter_mode') as AdapterMode | null
      if (savedMode === 'real' || savedMode === 'mock') {
        this.mode = savedMode
      }
    }
  }

  getMode(): AdapterMode {
    return this.mode
  }

  setMode(mode: AdapterMode): void {
    this.mode = mode
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem('cim_adapter_mode', mode)
    }
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '')
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  setBearerToken(token: string | null): void {
    this.token = token
  }

  getBearerToken(): string | null {
    return this.token
  }

  /**
   * Đăng nhập xác thực và thiết lập Bearer Token (hỗ trợ cả Real API N1 và Mock)
   */
  async login(
    email: string,
    password: string = 'password123'
  ): Promise<{ user: UserSummary; token: string }> {
    if (this.mode === 'real') {
      const res = await fetch(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) await this.handleFetchError(res)
      const data = await res.json()
      this.setBearerToken(data.access_token)
      const userSummary: UserSummary = {
        id: data.user.id,
        email: data.user.email,
        display_name: data.user.display_name,
        role: data.user.role,
        department_id: data.user.department_id,
        is_active: data.user.is_active,
      }
      return { user: userSummary, token: data.access_token }
    }

    const mockUser = Object.values(MOCK_USERS).find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    )
    if (!mockUser) {
      throw {
        error: {
          code: 'user_not_found',
          message: 'Không tìm thấy tài khoản người dùng tương ứng.',
          status: 404,
        },
      }
    }
    const token = `mock-bearer-token-${mockUser.id}`
    this.setBearerToken(token)
    return { user: mockUser, token }
  }

  /**
   * Kiểm tra khả năng kết nối đến backend API thật
   */
  async checkBackendHealth(): Promise<{ live: boolean; ready: boolean }> {
    try {
      const res = await fetch(`${this.baseUrl}/health/ready`, { method: 'GET' })
      if (!res.ok) return { live: true, ready: false }
      const data = await res.json()
      return { live: true, ready: data.status === 'ok' }
    } catch {
      return { live: false, ready: false }
    }
  }

  private authHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }
    return headers
  }

  private clone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj))
  }

  private async handleFetchError(res: Response): Promise<never> {
    let errorData: {
      error?: { code?: string; message?: string; details?: Array<{ field: string; reason: string }> }
      detail?: unknown
    } = {}
    try {
      errorData = await res.json()
    } catch {
      // Body không phải JSON
    }

    const code =
      errorData.error?.code ||
      (res.status === 409
        ? 'version_conflict'
        : res.status === 403
        ? 'forbidden'
        : res.status === 422
        ? 'validation_error'
        : res.status === 404
        ? 'not_found'
        : res.status === 401
        ? 'unauthenticated'
        : 'server_error')

    const message =
      errorData.error?.message ||
      (typeof errorData.detail === 'string' ? errorData.detail : undefined) ||
      (res.status === 409
        ? 'Xung đột phiên bản: Sự cố đã được cập nhật bởi một người khác.'
        : res.status === 403
        ? 'Quyền truy cập bị từ chối: Bạn không có quyền thực hiện thao tác này.'
        : res.status === 422
        ? 'Dữ liệu yêu cầu không hợp lệ.'
        : `Lỗi máy chủ (${res.status}).`)

    throw {
      error: {
        code,
        message,
        details: errorData.error?.details || [],
        status: res.status,
      },
    }
  }

  /**
   * 1. LẤY HÀNG ĐỢI SỰ CỐ (GET /api/v1/incidents)
   */
  async getStaffQueue(
    actor: UserSummary,
    params: StaffQueueParams = {}
  ): Promise<PaginatedResult<IncidentResponse>> {
    if (this.mode === 'real') {
      try {
        const query = new URLSearchParams()
        if (params.limit) query.set('limit', String(params.limit))
        if (params.cursor) query.set('cursor', params.cursor)
        if (params.status) query.set('status', params.status)
        if (params.category) query.set('category', params.category)
        if (params.priority) query.set('priority', params.priority)
        if (params.department_id) query.set('department_id', realDepartmentId(params.department_id))
        if (params.triage_required !== undefined) query.set('triage_required', String(params.triage_required))
        if (params.sla_state === 'overdue') query.set('overdue', 'true')

        const res = await fetch(`${this.baseUrl}/incidents?${query.toString()}`, {
          method: 'GET',
          headers: this.authHeaders(),
        })

        if (!res.ok) await this.handleFetchError(res)
        const data = await res.json()
        const items: IncidentResponse[] = (data.items || []).map((summary: Record<string, unknown>) => ({
          ...summary,
          department_name: departmentName(summary.department_id as string | null),
        }))

        return {
          items,
          total: items.length,
          current_page: 1,
          total_pages: data.next_cursor ? 2 : 1,
          next_cursor: data.next_cursor || null,
          prev_cursor: null,
        }
      } catch (err) {
        throw err
      }
    }

    return mockN7StaffRoleApi.getStaffQueueWithCursor(actor, params)
  }

  /**
   * Lấy toàn bộ hàng đợi sự cố không phân trang (cho counter và test)
   */
  async getAllStaffIncidents(
    actor: UserSummary,
    filters: { status?: Status; priority?: Priority; department_id?: string; search?: string } = {}
  ): Promise<IncidentResponse[]> {
    if (this.mode === 'real') {
      const res = await this.getStaffQueue(actor, { ...filters, limit: 100 })
      return res.items
    }
    return mockN7StaffRoleApi.getStaffQueue(actor, filters)
  }

  /**
   * 2. LẤY CHI TIẾT SỰ CỐ (GET /api/v1/incidents/:id)
   */
  async getIncidentDetail(id: string, actor: UserSummary): Promise<IncidentResponse> {
    if (this.mode === 'real') {
      try {
        const res = await fetch(`${this.baseUrl}/incidents/${id}`, {
          method: 'GET',
          headers: this.authHeaders(),
        })
        if (!res.ok) await this.handleFetchError(res)
        const data = await res.json()
        return {
          ...data,
          department_name: departmentName(data.department_id),
        }
      } catch (err) {
        throw err
      }
    }

    return mockN7StaffRoleApi.getIncidentDetail(id, actor)
  }

  /**
   * 3. PHÂN LOẠI TRIAGE SỰ CỐ
   * Luồng: Chuyển khỏi dept-triage, gán bộ phận hợp lệ và ấn định độ ưu tiên
   */
  async triageIncident(
    id: string,
    input: TriageInput,
    actor: UserSummary
  ): Promise<IncidentResponse> {
    if (this.mode === 'real') {
      const res = await fetch(`${this.baseUrl}/incidents/${id}/triage`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({
          department_id: realDepartmentId(input.department_id),
          priority: input.priority,
          severity: input.priority === 'p1' ? 'high' : input.priority === 'p2' ? 'medium' : 'low',
          reason: input.reason,
          expected_version: input.expected_version,
        }),
      })
      if (!res.ok) await this.handleFetchError(res)
      const data = await res.json()
      const updated: IncidentResponse = data.incident || data
      return {
        ...updated,
        department_name: DEPARTMENTS[input.department_id]?.name || input.department_id,
      }
    }

    return this.clone(await mockN7StaffRoleApi.triageIncident(id, input, actor))
  }

  /**
   * 4. PHÂN CÔNG / CHUYỂN BỘ PHẬN (POST /api/v1/incidents/:id/assign)
   */
  async assignIncident(
    id: string,
    input: AssignInput,
    actor: UserSummary
  ): Promise<IncidentResponse> {
    if (this.mode === 'real') {
      const res = await fetch(`${this.baseUrl}/incidents/${id}/assign`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({
          department_id: realDepartmentId(input.department_id),
          handler_id: realHandlerId(input.handler_id || null),
          reason: input.reason,
          expected_version: input.expected_version,
        }),
      })
      if (!res.ok) await this.handleFetchError(res)
      const data = await res.json()
      const updated = data.incident || data
      return {
        ...updated,
        department_name: DEPARTMENTS[input.department_id]?.name || input.department_id,
      }
    }

    return this.clone(await mockN7StaffRoleApi.assignIncident(id, input, actor))
  }

  /**
   * 5. TIẾP NHẬN SỰ CỐ (ACKNOWLEDGE) (POST /api/v1/incidents/:id/acknowledge)
   * Kỹ thuật viên nhận việc: assigned -> in_progress, ghi acknowledged_at, DỪNG ĐỒNG HỒ SLA
   */
  async acknowledgeIncident(
    id: string,
    expectedVersion: number,
    actor: UserSummary
  ): Promise<IncidentResponse> {
    if (this.mode === 'real') {
      const res = await fetch(`${this.baseUrl}/incidents/${id}/acknowledge`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({
          expected_version: expectedVersion,
        }),
      })
      if (!res.ok) await this.handleFetchError(res)
      const data = await res.json()
      return data.incident || data
    }

    return this.clone(await mockN7StaffRoleApi.acknowledgeIncident(id, expectedVersion, actor))
  }

  /**
   * 6. GIẢI QUYẾT SỰ CỐ (RESOLVE)
   * Chuyển trạng thái in_progress -> resolved, bắt buộc có resolution note
   */
  async resolveIncident(
    id: string,
    input: { expected_version: number; resolution: string; reason?: string },
    actor: UserSummary
  ): Promise<IncidentResponse> {
    const transitionInput: StatusTransitionInput = {
      expected_version: input.expected_version,
      target_status: 'resolved',
      resolution: input.resolution,
      reason: input.reason || null,
    }

    if (this.mode === 'real') {
      const res = await fetch(`${this.baseUrl}/incidents/${id}/transitions`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(transitionInput),
      })
      if (!res.ok) await this.handleFetchError(res)
      const data = await res.json()
      return data.incident || data
    }

    return this.clone(await mockN7StaffRoleApi.transitionStatus(id, transitionInput, actor))
  }

  /**
   * 7. NGHIỆM THU & ĐÓNG SỰ CỐ (CLOSE)
   * Chuyển trạng thái resolved -> closed
   */
  async closeIncident(
    id: string,
    input: { expected_version: number; reason?: string },
    actor: UserSummary
  ): Promise<IncidentResponse> {
    const transitionInput: StatusTransitionInput = {
      expected_version: input.expected_version,
      target_status: 'closed',
      reason: input.reason || 'Đã kiểm tra và nghiệm thu xử lý sự cố thành công.',
    }

    if (this.mode === 'real') {
      const res = await fetch(`${this.baseUrl}/incidents/${id}/transitions`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(transitionInput),
      })
      if (!res.ok) await this.handleFetchError(res)
      const data = await res.json()
      return data.incident || data
    }

    return this.clone(await mockN7StaffRoleApi.transitionStatus(id, transitionInput, actor))
  }

  /**
   * 8. MỞ LẠI SỰ CỐ (REOPEN)
   * Chuyển trạng thái resolved/closed -> in_progress, bắt buộc có reason
   */
  async reopenIncident(
    id: string,
    input: { expected_version: number; reason: string },
    actor: UserSummary
  ): Promise<IncidentResponse> {
    const transitionInput: StatusTransitionInput = {
      expected_version: input.expected_version,
      target_status: 'in_progress',
      reason: input.reason,
    }

    if (this.mode === 'real') {
      const res = await fetch(`${this.baseUrl}/incidents/${id}/transitions`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(transitionInput),
      })
      if (!res.ok) await this.handleFetchError(res)
      const data = await res.json()
      return data.incident || data
    }

    return this.clone(await mockN7StaffRoleApi.transitionStatus(id, transitionInput, actor))
  }

  /**
   * 9. ĐIỀU CHỈNH ĐỘ ƯU TIÊN (PRIORITY)
   */
  async adjustPriority(
    id: string,
    input: PriorityInput,
    actor: UserSummary
  ): Promise<IncidentResponse> {
    if (this.mode === 'real') {
      const res = await fetch(`${this.baseUrl}/incidents/${id}/priority`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(input),
      })
      if (!res.ok) await this.handleFetchError(res)
      const data = await res.json()
      return data.incident || data
    }

    return this.clone(await mockN7StaffRoleApi.adjustPriority(id, input, actor))
  }

  /**
   * 10. KẾT THÚC HỒ SƠ DO TRÙNG LẶP HOẶC KHÔNG HỢP LỆ (POST /api/v1/incidents/:id/disposition)
   */
  async dispositionIncident(
    id: string,
    input: DispositionInput,
    actor: UserSummary
  ): Promise<IncidentResponse> {
    if (this.mode === 'real') {
      const res = await fetch(`${this.baseUrl}/incidents/${id}/disposition`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(input),
      })
      if (!res.ok) await this.handleFetchError(res)
      const data = await res.json()
      return data.incident || data
    }

    return this.clone(await mockN7StaffRoleApi.dispositionIncident(id, input, actor))
  }

  /**
   * 11. GỬI BÌNH LUẬN / GHI CHÚ NỘI BỘ (POST /api/v1/incidents/:id/comments)
   */
  async addComment(
    id: string,
    input: AddCommentInput,
    actor: UserSummary
  ): Promise<Comment> {
    if (this.mode === 'real') {
      const res = await fetch(`${this.baseUrl}/incidents/${id}/comments`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(input),
      })
      if (!res.ok) await this.handleFetchError(res)
      return await res.json()
    }

    return mockN7StaffRoleApi.addComment(id, input, actor)
  }

  /**
   * 11. LẤY TRAO ĐỔI & GHI CHÚ NỘI BỘ
   */
  async getComments(id: string, actor: UserSummary): Promise<Comment[]> {
    if (this.mode === 'real') {
      try {
        const res = await fetch(`${this.baseUrl}/incidents/${id}/comments`, {
          method: 'GET',
          headers: this.authHeaders(),
        })
        if (res.ok) {
          const data = await res.json()
          return Array.isArray(data) ? data : data.items || []
        }
      } catch (err) {
        throw err
      }
    }

    return mockN7StaffRoleApi.getIncidentComments(id, actor)
  }

  /**
   * 12. LẤY LỊCH SỬ / TIMELINE
   */
  async getHistory(id: string, actor: UserSummary): Promise<HistoryItem[]> {
    if (this.mode === 'real') {
      try {
        const res = await fetch(`${this.baseUrl}/incidents/${id}/history`, {
          method: 'GET',
          headers: this.authHeaders(),
        })
        if (res.ok) {
          const data = await res.json()
          return data.items || []
        }
      } catch (err) {
        throw err
      }
    }

    return mockN7StaffRoleApi.getIncidentHistory(id, actor)
  }

  /**
   * 13. LẤY TỆP ĐÍNH KÈM
   */
  async getAttachments(id: string, actor: UserSummary): Promise<AttachmentSummary[]> {
    if (this.mode === 'real') {
      try {
        const res = await fetch(`${this.baseUrl}/incidents/${id}/attachments`, {
          method: 'GET',
          headers: this.authHeaders(),
        })
        if (res.ok) {
          const data = await res.json()
          return data.items || []
        }
      } catch (err) {
        throw err
      }
    }

    return mockN7StaffRoleApi.getIncidentAttachments(id, actor)
  }

  /**
   * Tính toán ma trận quyền
   */
  getPermissionMatrix(incident: IncidentResponse, actor: UserSummary): PermissionStatus {
    return mockN7StaffRoleApi.getPermissionMatrix(incident, actor)
  }

  /**
   * Đặt lại dữ liệu mẫu
   */
  resetData(): void {
    mockN7StaffRoleApi.resetData()
  }
}

export const staffApiAdapter = new StaffApiAdapter()
