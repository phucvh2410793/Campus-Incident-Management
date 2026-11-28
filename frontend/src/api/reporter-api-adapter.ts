/**
 * Task N6-W08: Reporter API Adapter kết nối Backend API thật (N1 / N2)
 * Người thực hiện: Đỗ Tuấn Kiệt (Giao diện người báo - Tuần 8)
 * 
 * Cung cấp cầu nối Adapter chuẩn cho Giao diện người báo cáo:
 * - Hỗ trợ cả 2 chế độ: API Thật (Real Backend qua DB) và Mock Adapter (Dự phòng / Demo).
 * - Hoàn thành luồng reporter cốt lõi: Gửi báo cáo -> Tải tệp bằng chứng -> Xem danh sách & chi tiết -> Bổ sung thông tin.
 * - Xử lý chuẩn xác các mã lỗi HTTP: 401 (Unauthenticated), 403 (Forbidden), 404 (Not Found), 409 (Conflict).
 * - Bắt xung đột phiên bản 409 và yêu cầu người dùng tải lại dữ liệu mới nhất.
 */

import type { UserSummary } from '../types/auth.ts'
import type {
  Category,
  Status,
  IncidentResponse,
  IncidentSummary,
  HistoryItem,
  AttachmentSummary,
} from '../types/incident.ts'
import {
  mockN6ReporterApi,
  type CreateIncidentInput,
  type SupplementIncidentInput,
  type MockAttachmentInput,
  type PaginatedResult,
} from '../mocks/n6-contract-mock-api.ts'
import { MOCK_USERS } from '../mocks/mock-users.ts'

export type ReporterAdapterMode = 'real' | 'mock'

export interface ReporterIncidentParams {
  category?: Category
  status?: Status
  limit?: number
  cursor?: string
}

export class ReporterApiAdapter {
  private mode: ReporterAdapterMode = 'real'
  private token: string | null = null
  private baseUrl = '/api/v1'

  constructor() {
    if (typeof window !== 'undefined') {
      const savedMode = window.localStorage?.getItem('cim_reporter_adapter_mode') as ReporterAdapterMode | null
      if (savedMode === 'real' || savedMode === 'mock') {
        this.mode = savedMode
      }
    }
  }

  getMode(): ReporterAdapterMode {
    return this.mode
  }

  setMode(mode: ReporterAdapterMode): void {
    this.mode = mode
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem('cim_reporter_adapter_mode', mode)
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

  private authHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }
    return headers
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
   * Xử lý lỗi HTTP phản hồi từ backend API thật
   */
  async handleFetchError(res: Response): Promise<never> {
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
        : res.status === 401
        ? 'unauthenticated'
        : res.status === 404
        ? 'not_found'
        : res.status === 422
        ? 'validation_error'
        : 'server_error')

    const message =
      errorData.error?.message ||
      (typeof errorData.detail === 'string' ? errorData.detail : undefined) ||
      (res.status === 409
        ? 'Xung đột phiên bản: Báo cáo đã được cập nhật bởi một người khác. Vui lòng tải lại trang (reload).'
        : res.status === 403
        ? 'Quyền truy cập bị từ chối: Bạn không có quyền thao tác trên báo cáo này.'
        : res.status === 401
        ? 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.'
        : res.status === 404
        ? 'Không tìm thấy sự cố được yêu cầu.'
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

  /**
   * 1. TẠO BÁO CÁO SỰ CỐ MỚI (POST /api/v1/incidents)
   * Kèm Idempotency-Key chống gửi lặp
   */
  async createIncident(
    input: CreateIncidentInput,
    idempotencyKey: string,
    reporterId?: string
  ): Promise<{ status: 200 | 201; data: IncidentResponse }> {
    if (this.mode === 'real') {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      }
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`
      }

      const res = await fetch(`${this.baseUrl}/incidents`, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      })

      if (!res.ok) await this.handleFetchError(res)
      const data = await res.json()
      return {
        status: res.status as 200 | 201,
        data: data.data || data,
      }
    }

    return mockN6ReporterApi.createIncident(input, idempotencyKey, reporterId)
  }

  /**
   * 2. TẢI LÊN TỆP ĐÍNH KÈM (POST /api/v1/incidents/:id/attachments)
   */
  async uploadAttachment(
    incidentId: string,
    file: MockAttachmentInput,
    expectedVersion: number,
    reporterId?: string
  ): Promise<AttachmentSummary> {
    if (this.mode === 'real') {
      if (!file.file) throw new Error('Cần chọn tệp thật trước khi tải lên.')
      const form = new FormData()
      form.append('file', file.file, file.filename)
      form.append('expected_version', String(expectedVersion))
      const res = await fetch(`${this.baseUrl}/incidents/${incidentId}/attachments`, {
        method: 'POST',
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
        body: form,
      })

      if (!res.ok) await this.handleFetchError(res)
      return await res.json()
    }

    return mockN6ReporterApi.uploadAttachment(incidentId, file, expectedVersion, reporterId)
  }

  /**
   * 3. LẤY DANH SÁCH BÁO CÁO CỦA TÔI (GET /api/v1/incidents)
   */
  async getMyIncidents(
    reporterId: string,
    params: ReporterIncidentParams = {}
  ): Promise<PaginatedResult<IncidentSummary>> {
    if (this.mode === 'real') {
      try {
        const query = new URLSearchParams()
        if (params.limit) query.set('limit', String(params.limit))
        if (params.cursor) query.set('cursor', params.cursor)
        if (params.status) query.set('status', params.status)
        if (params.category) query.set('category', params.category)
        query.set('reporter_id', reporterId)

        const res = await fetch(`${this.baseUrl}/incidents?${query.toString()}`, {
          method: 'GET',
          headers: this.authHeaders(),
        })

        if (!res.ok) await this.handleFetchError(res)
        const data = await res.json()
        return {
          items: data.items || [],
          next_cursor: data.next_cursor || null,
          total: data.items?.length || 0,
        }
      } catch (err) {
        throw err
      }
    }

    return mockN6ReporterApi.getMyIncidents(reporterId, params)
  }

  /**
   * 4. LẤY CHI TIẾT BÁO CÁO (GET /api/v1/incidents/:id)
   * Kiểm soát phạm vi: chỉ xem được báo cáo của chính mình (Scope isolation)
   */
  async getIncidentDetail(id: string, reporterId: string): Promise<IncidentResponse> {
    if (this.mode === 'real') {
      const res = await fetch(`${this.baseUrl}/incidents/${id}`, {
        method: 'GET',
        headers: this.authHeaders(),
      })

      if (!res.ok) await this.handleFetchError(res)
      return await res.json()
    }

    return mockN6ReporterApi.getIncidentDetail(id, reporterId)
  }

  /**
   * 5. LẤY TIMELINE CÔNG KHAI (GET /api/v1/incidents/:id/history)
   */
  async getPublicHistory(id: string, reporterId: string): Promise<HistoryItem[]> {
    if (this.mode === 'real') {
      try {
        const res = await fetch(`${this.baseUrl}/incidents/${id}/history`, {
          method: 'GET',
          headers: this.authHeaders(),
        })

        if (!res.ok) await this.handleFetchError(res)
        const data = await res.json()
        return Array.isArray(data) ? data : data.items || []
      } catch (err) {
        throw err
      }
    }

    return mockN6ReporterApi.getPublicHistory(id, reporterId)
  }

  /**
   * 6. BỔ SUNG THÔNG TIN (POST /api/v1/incidents/:id/supplements)
   */
  async supplementIncident(
    id: string,
    input: SupplementIncidentInput,
    reporterId: string
  ): Promise<{ id: string; created_at: string; incident_version: number }> {
    if (this.mode === 'real') {
      const res = await fetch(`${this.baseUrl}/incidents/${id}/supplements`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({
          expected_version: input.expected_version,
          text: input.text,
        }),
      })

      if (!res.ok) await this.handleFetchError(res)
      return await res.json()
    }

    return mockN6ReporterApi.supplementIncident(id, input, reporterId)
  }

  /**
   * 7. LẤY DANH SÁCH TỆP ĐÍNH KÈM (GET /api/v1/incidents/:id/attachments)
   */
  async getAttachments(id: string, reporterId: string): Promise<AttachmentSummary[]> {
    if (this.mode === 'real') {
      try {
        const res = await fetch(`${this.baseUrl}/incidents/${id}/attachments`, {
          method: 'GET',
          headers: this.authHeaders(),
        })

        if (!res.ok) await this.handleFetchError(res)
        const data = await res.json()
        return Array.isArray(data) ? data : data.items || []
      } catch (err) {
        throw err
      }
    }

    return mockN6ReporterApi.getAttachments(id, reporterId)
  }

  reset(): void {
    mockN6ReporterApi.reset()
  }
}

export const reporterApiAdapter = new ReporterApiAdapter()
