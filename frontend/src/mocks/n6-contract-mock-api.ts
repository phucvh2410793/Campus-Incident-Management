/**
 * Task N6-W01: Mock API từ Contract cho Giao diện Người Báo Cáo (Reporter)
 * Mock các endpoint reporter cần cho W1 theo docs/api-contract.md.
 */

import type {
  Category,
  Status,
  FormAnswers,
  IncidentResponse,
  HistoryItem,
  AttachmentSummary,
} from '../types/incident.ts'
import type { UserSummary, LoginRequest, LoginResponse } from '../types/auth.ts'
import { INITIAL_MOCK_INCIDENTS, INITIAL_MOCK_HISTORY, INITIAL_MOCK_ATTACHMENTS } from './mock-incidents.ts'
import { MOCK_USERS } from './mock-users.ts'
import { ErrorPresets, createContractError } from './contract-errors.ts'

export interface CreateIncidentInput {
  category: Category
  title: string
  description: string
  building: string
  location_detail?: string | null
  observed_at?: string | null
  answers: FormAnswers
}

export interface SupplementIncidentInput {
  expected_version: number
  text: string
}

export interface MockAttachmentInput {
  filename: string
  sizeBytes: number
  mimeType: string
  signature?: number[]
}

export interface PaginatedResult<T> {
  items: T[]
  next_cursor: string | null
  total?: number
}

// Bộ nhớ in-memory giả lập database cho Mock API
class N6ContractMockApi {
  private incidents: IncidentResponse[] = JSON.parse(JSON.stringify(INITIAL_MOCK_INCIDENTS))
  private history: Record<string, HistoryItem[]> = JSON.parse(JSON.stringify(INITIAL_MOCK_HISTORY))
  private attachments: Record<string, AttachmentSummary[]> = JSON.parse(JSON.stringify(INITIAL_MOCK_ATTACHMENTS))
  private idempotencyStore: Map<string, { bodyHash: string; response: IncidentResponse; createdAt: number }> = new Map()
  private activeSessions: Map<string, { userId: string; expiresAt: number; revoked: boolean }> = new Map()

  // ==========================================
  // XÁC THỰC VÀ PHIÊN BẢO MẬT (TASK N6-W02)
  // Opaque Bearer Token - Lưu trong Memory
  // ==========================================

  /**
   * POST /api/v1/auth/login
   * Đăng nhập lấy Bearer token (theo contract: token lưu trong memory, không lưu vào storage)
   */
  async login(payload: LoginRequest): Promise<LoginResponse> {
    if (!payload.email || !payload.email.trim()) {
      throw ErrorPresets.invalidCredentials()
    }
    const user = Object.values(MOCK_USERS).find(
      (u) => u.email.toLowerCase() === payload.email.trim().toLowerCase()
    )
    if (!user || !user.is_active) {
      throw ErrorPresets.invalidCredentials()
    }

    // Token ngẫu nhiên, bí mật, chỉ trả bản gốc một lần
    const token = 'usth-bearer-' + (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).substring(2))
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString()
    this.activeSessions.set(token, {
      userId: user.id,
      expiresAt: Date.now() + 8 * 3600 * 1000,
      revoked: false,
    })

    return {
      access_token: token,
      token_type: 'bearer',
      expires_at: expiresAt,
      user,
    }
  }

  /**
   * GET /api/v1/auth/me
   * Lấy thông tin người dùng từ Bearer token
   */
  async getMe(token: string): Promise<UserSummary> {
    if (!token || !this.activeSessions.has(token)) {
      throw ErrorPresets.unauthenticated()
    }
    const session = this.activeSessions.get(token)!
    if (session.revoked || session.expiresAt < Date.now()) {
      throw ErrorPresets.unauthenticated()
    }
    const user = Object.values(MOCK_USERS).find((u) => u.id === session.userId)
    if (!user) throw ErrorPresets.unauthenticated()
    return user
  }

  /**
   * POST /api/v1/auth/logout
   * Thu hồi phiên làm việc của token hiện tại
   */
  async logout(token: string): Promise<void> {
    if (token && this.activeSessions.has(token)) {
      const session = this.activeSessions.get(token)!
      session.revoked = true
      this.activeSessions.delete(token)
    }
  }

  // ==========================================
  // ENDPOINTS DÀNH CHO REPORTER (TASK N6)
  // ==========================================

  /**
   * POST /api/v1/incidents
   * Tạo báo cáo sự cố mới kèm Idempotency-Key
   */
  async createIncident(
    input: CreateIncidentInput,
    idempotencyKey: string,
    reporterId = '22e09230-76fd-4638-a97f-96919031e40b'
  ): Promise<{ status: 200 | 201; data: IncidentResponse }> {
    // 1. Kiểm tra validation theo contract
    const validationErrors: Array<{ field: string; reason: string }> = []
    if (!input.title || input.title.trim().length < 5 || input.title.trim().length > 120) {
      validationErrors.push({ field: 'title', reason: 'Tiêu đề phải từ 5 đến 120 ký tự.' })
    }
    if (!input.description || input.description.trim().length < 20 || input.description.trim().length > 2000) {
      validationErrors.push({ field: 'description', reason: 'Mô tả phải từ 20 đến 2000 ký tự.' })
    }
    if (!input.building || input.building.trim().length < 1 || input.building.trim().length > 120) {
      validationErrors.push({ field: 'building', reason: 'Tòa nhà là trường bắt buộc (1 - 120 ký tự).' })
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey || '')) {
      validationErrors.push({ field: 'Idempotency-Key', reason: 'Bắt buộc dùng UUID hợp lệ.' })
    }
    if (input.location_detail != null && input.location_detail.length > 200) {
      validationErrors.push({ field: 'location_detail', reason: 'Tối đa 200 ký tự.' })
    }
    if (input.observed_at != null && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(input.observed_at) || !Number.isFinite(Date.parse(input.observed_at)) || Date.parse(input.observed_at) > Date.now())) {
      validationErrors.push({ field: 'observed_at', reason: 'Phải là thời gian UTC và không ở tương lai.' })
    }
    const answerOptions: Record<Category, Record<string, string[] | 'boolean' | 'string'>> = {
      water_leak: { leak_amount: ['small', 'large', 'unknown'], near_electricity: ['yes', 'no', 'unknown'], slip_risk: 'boolean' },
      electrical_hazard: { exposed_wire: ['yes', 'no', 'unknown'], smoke_or_sparks: ['yes', 'no', 'unknown'], equipment: 'string' },
      phishing: { interaction: ['none', 'clicked_link', 'entered_information', 'unknown'], channel: ['email', 'message', 'other'], sender_text: 'string' },
    }
    const schema = answerOptions[input.category]
    if (!schema || !input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)) {
      validationErrors.push({ field: 'answers', reason: 'Category hoặc answers không hợp lệ.' })
    } else {
      const answers = input.answers as unknown as Record<string, unknown>
      for (const [field, option] of Object.entries(schema)) {
        const value = answers[field]
        const optional = option === 'boolean' || option === 'string'
        if (value === undefined && optional) continue
        if (value === null && optional) continue
        const valid = Array.isArray(option) ? option.includes(value as string) : option === 'boolean' ? typeof value === 'boolean' : typeof value === 'string' && value.length <= (field === 'sender_text' ? 254 : 200)
        if (!valid) validationErrors.push({ field: `answers.${field}`, reason: 'Giá trị không hợp lệ.' })
      }
      for (const field of Object.keys(answers)) {
        if (!(field in schema)) validationErrors.push({ field: `answers.${field}`, reason: 'Trường không thuộc schema.' })
      }
    }

    if (validationErrors.length > 0) {
      throw ErrorPresets.validationError(validationErrors)
    }

    // 2. Xử lý Idempotency-Key
    const bodyHash = JSON.stringify(input)
    {
      const cached = this.idempotencyStore.get(`${reporterId}:${idempotencyKey}`)
      if (cached) {
        if (Date.now() - cached.createdAt >= 24 * 60 * 60 * 1000) {
          this.idempotencyStore.delete(`${reporterId}:${idempotencyKey}`)
        } else if (cached.bodyHash === bodyHash) {
          // Cùng key, cùng payload -> Trả về bản ghi cũ với status 200
          return { status: 200, data: cached.response }
        } else {
          // Cùng key nhưng khác payload -> Trả về HTTP 409 idempotency_conflict
          throw ErrorPresets.idempotencyConflict()
        }
      }
    }

    // Rule demo-v1 được xử lý sau bởi luồng bất đồng bộ, không nằm trong POST.
    const nowIso = new Date().toISOString()

    const newIncident: IncidentResponse = {
      id: crypto.randomUUID ? crypto.randomUUID() : 'inc-' + Date.now().toString(36),
      version: 1,
      category: input.category,
      title: input.title.trim(),
      description: input.description.trim(),
      building: input.building.trim(),
      location_detail: input.location_detail ? input.location_detail.trim() : null,
      observed_at: input.observed_at ?? null,
      answers: input.answers,
      reporter_id: reporterId,
      reporter_name: 'Lê Minh Tuấn (Sinh viên)',
      status: 'reported',
      triage_required: false,
      severity: null,
      priority: null,
      department_id: null,
      assigned_handler_id: null,
      rule_evaluation: null,
      reported_at: nowIso,
      assigned_at: null,
      acknowledged_at: null,
      resolved_at: null,
      closed_at: null,
      acknowledgment_deadline_at: null,
      escalation_level: 0,
    }

    this.incidents.unshift(newIncident)

    // Tạo lịch sử khởi tạo ban đầu
    this.history[newIncident.id] = [
      {
        id: 'hist-' + Date.now(),
        action: 'incident_created',
        actor_display_name: 'Lê Minh Tuấn (Reporter)',
        visibility: 'public',
        created_at: nowIso,
        details: {
          category: newIncident.category,
          title: newIncident.title,
        },
      },
    ]

    // Lưu idempotency
    this.idempotencyStore.set(`${reporterId}:${idempotencyKey}`, { bodyHash, response: newIncident, createdAt: Date.now() })

    return { status: 201, data: newIncident }
  }

  /**
   * GET /api/v1/incidents?my=true
   * Danh sách báo cáo của người dùng (theo token hoặc reporterId)
   */
  async getMyIncidents(
    reporterIdOrToken = '22e09230-76fd-4638-a97f-96919031e40b',
    params?: { category?: Category; status?: Status }
  ): Promise<IncidentResponse[]> {
    let resolvedReporterId = reporterIdOrToken
    if (this.activeSessions.has(reporterIdOrToken)) {
      const session = this.activeSessions.get(reporterIdOrToken)!
      if (session.revoked || session.expiresAt < Date.now()) {
        throw ErrorPresets.unauthenticated()
      }
      resolvedReporterId = session.userId
    }

    let filtered = this.incidents.filter((inc) => inc.reporter_id === resolvedReporterId)
    if (params?.category) filtered = filtered.filter((inc) => inc.category === params.category)
    if (params?.status) filtered = filtered.filter((inc) => inc.status === params.status)

    // Sort reported_at DESC, id DESC
    filtered.sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime())

    return filtered
  }

  /**
   * GET /api/v1/incidents/:id
   * Chi tiết sự cố cho Reporter (không lộ ghi chú nội bộ của nhân viên)
   */
  async getIncidentDetail(id: string, reporterId = '22e09230-76fd-4638-a97f-96919031e40b'): Promise<IncidentResponse> {
    const incident = this.incidents.find((inc) => inc.id === id)
    if (!incident) {
      throw ErrorPresets.notFound()
    }
    // Reporter chỉ được xem sự cố do mình tạo
    if (incident.reporter_id !== reporterId && reporterId !== MOCK_USERS['user-admin'].id) {
      throw ErrorPresets.notFound()
    }
    return incident
  }

  /**
   * GET /api/v1/incidents/:id/history
   * Timeline công khai của sự cố (chỉ visibility: 'public')
   */
  async getPublicHistory(id: string, reporterId = '22e09230-76fd-4638-a97f-96919031e40b'): Promise<HistoryItem[]> {
    await this.getIncidentDetail(id, reporterId) // Kiểm tra quyền truy cập sự cố
    const list = this.history[id] || []
    return list.filter((item) => item.visibility === 'public')
  }

  /**
   * POST /api/v1/incidents/:id/supplements
   * Người báo bổ sung thông tin (yêu cầu gửi expected_version, kiểm tra HTTP 409 conflict)
   */
  async supplementIncident(
    id: string,
    input: SupplementIncidentInput,
    reporterId = '22e09230-76fd-4638-a97f-96919031e40b'
  ): Promise<{ id: string; created_at: string; incident_version: number }> {
    const incident = await this.getIncidentDetail(id, reporterId)

    if (incident.status === 'resolved' || incident.status === 'closed') {
      throw ErrorPresets.invalidTransition(incident.status, 'supplement')
    }
    if (!input.text || input.text.trim().length < 1 || input.text.trim().length > 2000) {
      throw ErrorPresets.validationError([
        { field: 'text', reason: 'Nội dung bổ sung phải từ 1 đến 2000 ký tự.' },
      ])
    }

    // Optimistic Concurrency Control
    if (incident.version !== input.expected_version) {
      throw ErrorPresets.versionConflict(input.expected_version, incident.version)
    }

    const nowIso = new Date().toISOString()
    incident.version += 1
    const supplementId = crypto.randomUUID()

    if (!this.history[id]) this.history[id] = []
    this.history[id].push({
      id: supplementId,
      action: 'supplement_added',
      actor_display_name: 'Lê Minh Tuấn (Reporter)',
      visibility: 'public',
      created_at: nowIso,
      details: {
        text: input.text.trim(),
        new_version: incident.version,
      },
    })

    return { id: supplementId, created_at: nowIso, incident_version: incident.version }
  }

  /**
   * POST /api/v1/incidents/:id/attachments
   * Upload từng tệp bằng chứng sau khi tạo incident.
   */
  async uploadAttachment(
    incidentId: string,
    file: MockAttachmentInput,
    expectedVersion: number,
    reporterId = '22e09230-76fd-4638-a97f-96919031e40b'
  ): Promise<AttachmentSummary> {
    const incident = await this.getIncidentDetail(incidentId, reporterId)
    if (incident.status === 'closed') throw ErrorPresets.invalidTransition('closed', 'upload')
    if (incident.version !== expectedVersion) throw ErrorPresets.versionConflict(expectedVersion, incident.version)

    const MAX_SIZE = 10 * 1024 * 1024 // 10MB
    if (file.sizeBytes < 1 || file.sizeBytes > MAX_SIZE) {
      throw createContractError('file_too_large', 'Tệp vượt quá dung lượng tối đa cho phép (10MB).', [
        { field: 'file', reason: `Kích thước tệp là ${(file.sizeBytes / (1024 * 1024)).toFixed(1)}MB.` },
      ])
    }

    const allowedMime = ['image/png', 'image/jpeg', 'application/pdf']
    if (!allowedMime.includes(file.mimeType)) {
      throw createContractError('unsupported_media_type', 'Chỉ chấp nhận PDF, PNG hoặc JPEG.', [
        { field: 'file_type', reason: `Loại tệp '${file.mimeType}' không nằm trong danh sách an toàn.` },
      ])
    }
    const bytes = file.signature || []
    const signatureOk = file.mimeType === 'application/pdf'
      ? [37, 80, 68, 70, 45].every((value, i) => bytes[i] === value)
      : file.mimeType === 'image/png'
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    if (!signatureOk) throw ErrorPresets.unsupportedMediaType()
    if ((this.attachments[incidentId]?.length || 0) >= 5) {
      throw ErrorPresets.validationError([{ field: 'file', reason: 'Tối đa 5 tệp cho mỗi báo cáo.' }])
    }

    incident.version += 1
    const newAttachment: AttachmentSummary = {
      id: crypto.randomUUID(),
      original_name: file.filename,
      content_type: file.mimeType,
      size_bytes: file.sizeBytes,
      created_at: new Date().toISOString(),
      incident_version: incident.version,
    }

    if (!this.attachments[incidentId]) this.attachments[incidentId] = []
    this.attachments[incidentId].push(newAttachment)

    return newAttachment
  }

  /**
   * Lấy danh sách attachment của một sự cố
   */
  async getAttachments(incidentId: string, reporterId = '22e09230-76fd-4638-a97f-96919031e40b'): Promise<AttachmentSummary[]> {
    await this.getIncidentDetail(incidentId, reporterId)
    return this.attachments[incidentId] || []
  }
}

export const mockN6ReporterApi = new N6ContractMockApi()
