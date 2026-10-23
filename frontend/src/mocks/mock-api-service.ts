import type { UserSummary, LoginRequest, LoginResponse } from '../types/auth.ts'
import type {
  Category,
  Status,
  Priority,
  FormAnswers,
  IncidentResponse,
  IncidentSummary,
  HistoryItem,
  Comment,
  AttachmentSummary,
  RuleEvaluation,
} from '../types/incident.ts'
import { MOCK_USERS, DEPARTMENTS } from './mock-users.ts'
import {
  INITIAL_MOCK_INCIDENTS,
  INITIAL_MOCK_HISTORY,
  INITIAL_MOCK_COMMENTS,
  INITIAL_MOCK_ATTACHMENTS,
} from './mock-incidents.ts'
import { ErrorPresets, generateRequestId, createContractError } from './contract-errors.ts'

export interface MockSettings {
  latencyMs: number
  forceLoading: boolean
  forceEmpty: boolean
  force401: boolean
  force409: boolean
  force500: boolean
}

class MockApiService {
  private users = { ...MOCK_USERS }
  private incidents: IncidentResponse[] = JSON.parse(JSON.stringify(INITIAL_MOCK_INCIDENTS))
  private history: Record<string, HistoryItem[]> = JSON.parse(JSON.stringify(INITIAL_MOCK_HISTORY))
  private comments: Record<string, Comment[]> = JSON.parse(JSON.stringify(INITIAL_MOCK_COMMENTS))
  private attachments: Record<string, AttachmentSummary[]> = JSON.parse(JSON.stringify(INITIAL_MOCK_ATTACHMENTS))
  private idempotencyKeys: Map<string, { payloadHash: string; incident: IncidentResponse; timestamp: number }> = new Map()

  public settings: MockSettings = {
    latencyMs: 150,
    forceLoading: false,
    forceEmpty: false,
    force401: false,
    force409: false,
    force500: false,
  }

  public resetData() {
    this.incidents = JSON.parse(JSON.stringify(INITIAL_MOCK_INCIDENTS))
    this.history = JSON.parse(JSON.stringify(INITIAL_MOCK_HISTORY))
    this.comments = JSON.parse(JSON.stringify(INITIAL_MOCK_COMMENTS))
    this.attachments = JSON.parse(JSON.stringify(INITIAL_MOCK_ATTACHMENTS))
    this.idempotencyKeys.clear()
  }

  private async delay() {
    if (this.settings.forceLoading) {
      // Hang indefinitely or for 60s
      await new Promise((resolve) => setTimeout(resolve, 60000))
    }
    if (this.settings.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.settings.latencyMs))
    }
    if (this.settings.force401) {
      throw ErrorPresets.unauthenticated()
    }
    if (this.settings.force409) {
      throw ErrorPresets.versionConflict(1, 2)
    }
    if (this.settings.force500) {
      throw ErrorPresets.serviceUnavailable()
    }
  }

  // --- Auth endpoints ---

  async login(payload: LoginRequest): Promise<LoginResponse> {
    await this.delay()
    const user = Object.values(this.users).find((u) => u.email.toLowerCase() === payload.email.toLowerCase())
    if (!user) {
      throw ErrorPresets.invalidCredentials()
    }
    const token = 'mock-bearer-' + Math.random().toString(36).substring(2)
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString()
    return {
      access_token: token,
      token_type: 'bearer',
      expires_at: expiresAt,
      user,
    }
  }

  async getMe(userId: string): Promise<UserSummary> {
    await this.delay()
    const user = Object.values(this.users).find((u) => u.id === userId)
    if (!user) throw ErrorPresets.unauthenticated()
    return user
  }

  // --- SLA Helper ---

  private calculateDeadline(reportedAt: string, priority: Priority): string | null {
    if (!priority) return null
    const base = new Date(reportedAt).getTime()
    let offsetMs = 8 * 3600 * 1000 // P3: 8 hours
    if (priority === 'p1') offsetMs = 15 * 60 * 1000 // P1: 15 mins
    if (priority === 'p2') offsetMs = 2 * 3600 * 1000 // P2: 2 hours
    return new Date(base + offsetMs).toISOString()
  }

  private isOverdue(incident: IncidentResponse): boolean {
    if (incident.acknowledged_at) return false
    if (!incident.acknowledgment_deadline_at) return false
    return Date.now() >= new Date(incident.acknowledgment_deadline_at).getTime()
  }

  // --- Rule evaluation demo-v1 ---

  private evaluateRule(category: Category, answers: FormAnswers): {
    severity: IncidentResponse['severity']
    priority: Priority
    department_id: string
    triage_required: boolean
    evaluation: RuleEvaluation
  } {
    // 1. Electrical hazard + smoke or sparks -> Critical / P1 / Điện và an toàn
    if (category === 'electrical_hazard') {
      const a = answers as { exposed_wire: string; smoke_or_sparks: string }
      if (a.smoke_or_sparks === 'yes') {
        return {
          severity: 'critical',
          priority: 'p1',
          department_id: 'dept-dien',
          triage_required: false,
          evaluation: {
            rule_id: 'rule-01-elec-smoke-sparks',
            rule_version: 'demo-v1',
            reason: 'Nguy hiểm điện và có khói/tia lửa: Dấu hiệu nguy hiểm tức thời.',
          },
        }
      }
      if (a.exposed_wire === 'yes') {
        return {
          severity: 'high',
          priority: 'p1',
          department_id: 'dept-dien',
          triage_required: false,
          evaluation: {
            rule_id: 'rule-04-elec-exposed-wire',
            rule_version: 'demo-v1',
            reason: 'Nguy hiểm điện và có dây hở: Nguy cơ chạm điện nghiêm trọng.',
          },
        }
      }
      if (a.smoke_or_sparks === 'unknown' || a.exposed_wire === 'unknown') {
        return {
          severity: null,
          priority: null,
          department_id: 'dept-triage',
          triage_required: true,
          evaluation: {
            rule_id: 'fallback-unknown-review',
            rule_version: 'demo-v1',
            reason: 'Có câu trả lời không rõ (unknown): Đưa vào hàng đợi triage để phân loại thủ công.',
          },
        }
      }
      return {
        severity: 'medium',
        priority: 'p2',
        department_id: 'dept-dien',
        triage_required: false,
        evaluation: {
          rule_id: 'rule-09-elec-general',
          rule_version: 'demo-v1',
          reason: 'Nguy hiểm điện không có khói/tia lửa/dây hở: Cần kiểm tra tại chỗ.',
        },
      }
    }

    // 2. Phishing
    if (category === 'phishing') {
      const a = answers as { interaction: string; channel: string }
      if (a.interaction === 'entered_information') {
        return {
          severity: 'high',
          priority: 'p1',
          department_id: 'dept-it',
          triage_required: false,
          evaluation: {
            rule_id: 'rule-02-phishing-entered-info',
            rule_version: 'demo-v1',
            reason: 'Phishing và đã nhập thông tin: Nguy cơ rò rỉ tài khoản/thông tin trường.',
          },
        }
      }
      if (a.interaction === 'clicked_link') {
        return {
          severity: 'medium',
          priority: 'p2',
          department_id: 'dept-it',
          triage_required: false,
          evaluation: {
            rule_id: 'rule-05-phishing-clicked-link',
            rule_version: 'demo-v1',
            reason: 'Phishing và đã bấm liên kết, chưa nhập thông tin: Cần quét thiết bị.',
          },
        }
      }
      if (a.interaction === 'none') {
        return {
          severity: 'low',
          priority: 'p3',
          department_id: 'dept-it',
          triage_required: false,
          evaluation: {
            rule_id: 'rule-08-phishing-none',
            rule_version: 'demo-v1',
            reason: 'Phishing chưa tương tác: Mức độ rủi ro thấp.',
          },
        }
      }
      return {
        severity: null,
        priority: null,
        department_id: 'dept-triage',
        triage_required: true,
        evaluation: {
          rule_id: 'fallback-unknown-review',
          rule_version: 'demo-v1',
          reason: 'Mức độ tương tác không rõ: Cần phân loại thủ công.',
        },
      }
    }

    // 3. Water leak
    if (category === 'water_leak') {
      const a = answers as { leak_amount: string; near_electricity: string }
      if (a.near_electricity === 'yes') {
        return {
          severity: 'high',
          priority: 'p1',
          department_id: 'dept-csvc',
          triage_required: false,
          evaluation: {
            rule_id: 'rule-03-water-near-elec',
            rule_version: 'demo-v1',
            reason: 'Rò nước và gần nguồn điện: Cần ưu tiên cao P1, gắn cờ an toàn điện.',
          },
        }
      }
      if (a.leak_amount === 'large') {
        return {
          severity: 'medium',
          priority: 'p2',
          department_id: 'dept-csvc',
          triage_required: false,
          evaluation: {
            rule_id: 'rule-06-water-large',
            rule_version: 'demo-v1',
            reason: 'Rò nước nhiều, không gần điện: Nguy cơ lan rộng và trơn trượt.',
          },
        }
      }
      if (a.leak_amount === 'small' && a.near_electricity === 'no') {
        return {
          severity: 'low',
          priority: 'p3',
          department_id: 'dept-csvc',
          triage_required: false,
          evaluation: {
            rule_id: 'rule-07-water-small',
            rule_version: 'demo-v1',
            reason: 'Rò nước ít, không gần điện: Chưa có dấu hiệu tăng cấp.',
          },
        }
      }
      return {
        severity: null,
        priority: null,
        department_id: 'dept-triage',
        triage_required: true,
        evaluation: {
          rule_id: 'fallback-unknown-review',
          rule_version: 'demo-v1',
          reason: 'Câu trả lời rò nước không rõ: Đưa vào hàng đợi triage để kiểm tra.',
        },
      }
    }

    return {
      severity: null,
      priority: null,
      department_id: 'dept-triage',
      triage_required: true,
      evaluation: {
        rule_id: 'fallback-unknown-review',
        rule_version: 'demo-v1',
        reason: 'Không khớp quy tắc định sẵn.',
      },
    }
  }

  // --- Incidents endpoints ---

  async listIncidents(
    currentUser: UserSummary,
    filters?: {
      status?: Status
      category?: Category
      priority?: Priority
      department_id?: string
      triage_required?: boolean
      overdue?: boolean
      query?: string
    }
  ): Promise<{ items: IncidentSummary[]; next_cursor: string | null }> {
    await this.delay()

    if (this.settings.forceEmpty) {
      return { items: [], next_cursor: null }
    }

    let list = [...this.incidents]

    // Scope filtering
    if (currentUser.role === 'reporter') {
      list = list.filter((i) => i.reporter_id === currentUser.id)
    } else if (currentUser.role === 'handler') {
      list = list.filter((i) => i.assigned_handler_id === currentUser.id)
    } else if (currentUser.role === 'department_manager') {
      if (currentUser.department_id === 'dept-triage') {
        // Triage manager sees triage queue or items with triage_required
        list = list.filter((i) => i.department_id === 'dept-triage' || i.triage_required)
      } else {
        list = list.filter((i) => i.department_id === currentUser.department_id)
      }
    }

    // Explicit filters
    if (filters?.status) list = list.filter((i) => i.status === filters.status)
    if (filters?.category) list = list.filter((i) => i.category === filters.category)
    if (filters?.priority) list = list.filter((i) => i.priority === filters.priority)
    if (filters?.department_id) list = list.filter((i) => i.department_id === filters.department_id)
    if (filters?.triage_required !== undefined) list = list.filter((i) => i.triage_required === filters.triage_required)
    if (filters?.overdue) list = list.filter((i) => this.isOverdue(i))
    if (filters?.query) {
      const q = filters.query.toLowerCase()
      list = list.filter((i) => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
    }

    // Sort: reported_at DESC, id DESC
    list.sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime())

    const items: IncidentSummary[] = list.map((i) => ({
      id: i.id,
      version: i.version,
      category: i.category,
      title: i.title,
      status: i.status,
      priority: i.priority,
      triage_required: i.triage_required,
      department_id: currentUser.role === 'reporter' ? null : i.department_id,
      department_name: i.department_name,
      reported_at: i.reported_at,
      acknowledgment_deadline_at: i.acknowledgment_deadline_at,
      overdue: this.isOverdue(i),
    }))

    return { items, next_cursor: null }
  }

  async getIncident(currentUser: UserSummary, incidentId: string): Promise<IncidentResponse> {
    await this.delay()
    const found = this.incidents.find((i) => i.id === incidentId)
    if (!found) throw ErrorPresets.notFound()

    // Permission check
    if (currentUser.role === 'reporter' && found.reporter_id !== currentUser.id) {
      throw ErrorPresets.notFound()
    }
    if (currentUser.role === 'handler') {
      if (found.assigned_handler_id !== currentUser.id) {
        throw ErrorPresets.notFound()
      }
    }
    if (currentUser.role === 'department_manager') {
      if (currentUser.department_id !== 'dept-triage' && found.department_id !== currentUser.department_id) {
        throw ErrorPresets.notFound()
      }
    }

    return JSON.parse(JSON.stringify(found))
  }

  async createIncident(
    currentUser: UserSummary,
    payload: {
      category: Category
      title: string
      description: string
      building: string
      location_detail?: string | null
      observed_at?: string | null
      answers: FormAnswers
    },
    idempotencyKey?: string
  ): Promise<IncidentResponse> {
    await this.delay()

    // Idempotency check
    if (idempotencyKey) {
      const keyStr = currentUser.id + ':' + idempotencyKey
      const cached = this.idempotencyKeys.get(keyStr)
      if (cached) {
        const payloadHash = JSON.stringify(payload)
        if (cached.payloadHash === payloadHash) {
          return cached.incident
        } else {
          throw ErrorPresets.idempotencyConflict()
        }
      }
    }

    // Validation
    const errors: Array<{ field: string; reason: string }> = []
    if (!payload.title || payload.title.length < 5 || payload.title.length > 120) {
      errors.push({ field: 'title', reason: 'Tiêu đề phải từ 5 đến 120 ký tự.' })
    }
    if (!payload.description || payload.description.length < 20 || payload.description.length > 2000) {
      errors.push({ field: 'description', reason: 'Mô tả phải từ 20 đến 2000 ký tự.' })
    }
    if (!payload.building || payload.building.length < 1 || payload.building.length > 120) {
      errors.push({ field: 'building', reason: 'Tòa nhà/khu vực là bắt buộc.' })
    }
    if (payload.observed_at) {
      const obsTime = new Date(payload.observed_at).getTime()
      if (obsTime > Date.now()) {
        errors.push({ field: 'observed_at', reason: 'Thời điểm quan sát không được ở tương lai.' })
      }
    }
    if (errors.length > 0) {
      throw ErrorPresets.validationError(errors)
    }

    const now = new Date().toISOString()
    const ruleResult = this.evaluateRule(payload.category, payload.answers)
    const deadline = this.calculateDeadline(now, ruleResult.priority)

    const dept = DEPARTMENTS[ruleResult.department_id]

    const newIncident: IncidentResponse = {
      id: generateRequestId(),
      version: 1,
      category: payload.category,
      title: payload.title,
      description: payload.description,
      building: payload.building,
      location_detail: payload.location_detail ?? null,
      observed_at: payload.observed_at ?? null,
      answers: payload.answers,
      reporter_id: currentUser.id,
      reporter_name: currentUser.display_name,
      status: 'reported',
      triage_required: ruleResult.triage_required,
      severity: ruleResult.severity,
      priority: ruleResult.priority,
      department_id: ruleResult.department_id,
      department_name: dept ? dept.name : undefined,
      assigned_handler_id: null,
      rule_evaluation: ruleResult.evaluation,
      reported_at: now,
      assigned_at: null,
      acknowledged_at: null,
      resolved_at: null,
      closed_at: null,
      acknowledgment_deadline_at: deadline,
      escalation_level: 0,
    }

    this.incidents.unshift(newIncident)

    // Log initial history
    this.history[newIncident.id] = [
      {
        id: generateRequestId(),
        action: 'Báo cáo sự cố được tạo',
        actor_display_name: currentUser.display_name,
        created_at: now,
        visibility: 'public',
        details: { category: newIncident.category, building: newIncident.building },
      },
      {
        id: generateRequestId(),
        action: `Đánh giá quy tắc ${ruleResult.evaluation.rule_version}`,
        actor_display_name: 'Hệ thống tự động',
        created_at: now,
        visibility: 'public',
        details: {
          rule_id: ruleResult.evaluation.rule_id,
          reason: ruleResult.evaluation.reason,
          priority: ruleResult.priority,
          department: dept ? dept.name : ruleResult.department_id,
        },
      },
    ]

    if (idempotencyKey) {
      this.idempotencyKeys.set(currentUser.id + ':' + idempotencyKey, {
        payloadHash: JSON.stringify(payload),
        incident: newIncident,
        timestamp: Date.now(),
      })
    }

    return newIncident
  }

  // --- Supplements ---

  async addSupplement(
    currentUser: UserSummary,
    incidentId: string,
    payload: { text: string; expected_version: number }
  ): Promise<{ id: string; created_at: string; incident_version: number }> {
    await this.delay()
    const incident = this.incidents.find((i) => i.id === incidentId)
    if (!incident) throw ErrorPresets.notFound()
    if (incident.reporter_id !== currentUser.id && currentUser.role !== 'administrator') throw ErrorPresets.forbidden('chỉ người báo hoặc quản trị viên mới được bổ sung')
    if (incident.status === 'resolved' || incident.status === 'closed') {
      throw ErrorPresets.forbidden('sự cố đã giải quyết hoặc đóng')
    }
    if (payload.expected_version !== incident.version) {
      throw ErrorPresets.versionConflict(payload.expected_version, incident.version)
    }

    incident.version += 1
    const now = new Date().toISOString()
    const supplementItem: HistoryItem = {
      id: generateRequestId(),
      action: 'Người báo bổ sung thông tin',
      actor_display_name: currentUser.display_name,
      created_at: now,
      visibility: 'public',
      details: { supplement: payload.text },
    }
    if (!this.history[incidentId]) this.history[incidentId] = []
    this.history[incidentId].push(supplementItem)

    return { id: supplementItem.id, created_at: now, incident_version: incident.version }
  }

  // --- History & Comments ---

  async getHistory(currentUser: UserSummary, incidentId: string): Promise<HistoryItem[]> {
    await this.delay()
    const items = this.history[incidentId] ?? []
    if (currentUser.role === 'reporter') {
      return items.filter((h) => h.visibility === 'public')
    }
    return items
  }

  async getComments(currentUser: UserSummary, incidentId: string): Promise<Comment[]> {
    await this.delay()
    const items = this.comments[incidentId] ?? []
    if (currentUser.role === 'reporter') {
      return items.filter((c) => c.visibility === 'public')
    }
    return items
  }

  async addComment(
    currentUser: UserSummary,
    incidentId: string,
    payload: { body: string; visibility: 'public' | 'internal'; expected_version: number }
  ): Promise<Comment> {
    await this.delay()
    const incident = this.incidents.find((i) => i.id === incidentId)
    if (!incident) throw ErrorPresets.notFound()
    if (currentUser.role === 'reporter' && payload.visibility === 'internal') {
      throw ErrorPresets.forbidden('Người báo không được tạo ghi chú nội bộ')
    }
    if (payload.expected_version !== incident.version) {
      throw ErrorPresets.versionConflict(payload.expected_version, incident.version)
    }

    incident.version += 1
    const newComment: Comment = {
      id: generateRequestId(),
      body: payload.body,
      visibility: payload.visibility,
      author_id: currentUser.id,
      author_name: currentUser.display_name,
      created_at: new Date().toISOString(),
    }
    if (!this.comments[incidentId]) this.comments[incidentId] = []
    this.comments[incidentId].push(newComment)
    return newComment
  }

  // --- Attachments ---

  async getAttachments(_currentUser: UserSummary, incidentId: string): Promise<AttachmentSummary[]> {
    await this.delay()
    return this.attachments[incidentId] ?? []
  }

  async uploadAttachment(
    currentUser: UserSummary,
    incidentId: string,
    file: { name: string; size: number; type: string },
    expectedVersion: number
  ): Promise<AttachmentSummary> {
    await this.delay()
    const incident = this.incidents.find((i) => i.id === incidentId)
    if (!incident) throw ErrorPresets.notFound()
    if (expectedVersion !== incident.version) {
      throw ErrorPresets.versionConflict(expectedVersion, incident.version)
    }
    if (file.size > 10 * 1024 * 1024) {
      throw ErrorPresets.fileTooLarge(10)
    }
    const allowed = ['image/png', 'image/jpeg', 'application/pdf']
    if (!allowed.includes(file.type.toLowerCase())) {
      throw ErrorPresets.unsupportedMediaType('PDF, PNG, JPEG')
    }

    const currentList = this.attachments[incidentId] ?? []
    if (currentList.length >= 5) {
      throw createContractError('too_many_attachments', 'Tối đa 5 tệp đính kèm cho mỗi sự cố.')
    }

    incident.version += 1
    const att: AttachmentSummary = {
      id: generateRequestId(),
      original_name: file.name,
      content_type: file.type,
      size_bytes: file.size,
      created_at: new Date().toISOString(),
      incident_version: incident.version,
    }
    if (!this.attachments[incidentId]) this.attachments[incidentId] = []
    this.attachments[incidentId].push(att)

    // Log history
    if (!this.history[incidentId]) this.history[incidentId] = []
    this.history[incidentId].push({
      id: generateRequestId(),
      action: `Tải lên tệp bằng chứng: ${file.name}`,
      actor_display_name: currentUser.display_name,
      created_at: new Date().toISOString(),
      visibility: 'public',
      details: { file_name: file.name, size_bytes: file.size },
    })

    return att
  }

  // --- Staff Operations (Task N7) ---

  async assign(
    currentUser: UserSummary,
    incidentId: string,
    payload: {
      department_id: string
      handler_id?: string | null
      reason: string
      expected_version: number
    }
  ): Promise<IncidentResponse> {
    await this.delay()
    const incident = this.incidents.find((i) => i.id === incidentId)
    if (!incident) throw ErrorPresets.notFound()
    if (currentUser.role !== 'department_manager' && currentUser.role !== 'administrator') {
      throw ErrorPresets.forbidden('Chỉ Quản lý bộ phận mới được phân công')
    }
    if (payload.expected_version !== incident.version) {
      throw ErrorPresets.versionConflict(payload.expected_version, incident.version)
    }

    const now = new Date().toISOString()
    incident.version += 1
    incident.department_id = payload.department_id
    incident.department_name = DEPARTMENTS[payload.department_id]?.name

    if (payload.handler_id) {
      const handlerUser = Object.values(this.users).find((u) => u.id === payload.handler_id)
      incident.assigned_handler_id = payload.handler_id
      incident.assigned_handler_name = handlerUser?.display_name
    } else {
      incident.assigned_handler_id = null
      incident.assigned_handler_name = undefined
    }

    if (incident.status === 'reported') {
      incident.status = 'assigned'
      incident.assigned_at = now
    }
    if (incident.triage_required && payload.department_id !== 'dept-triage') {
      incident.triage_required = false
    }

    // Record history
    if (!this.history[incidentId]) this.history[incidentId] = []
    this.history[incidentId].push({
      id: generateRequestId(),
      action: `Phân công: ${incident.department_name}${incident.assigned_handler_name ? ` -> ${incident.assigned_handler_name}` : ''}`,
      actor_display_name: currentUser.display_name,
      created_at: now,
      visibility: 'public',
      details: { reason: payload.reason, handler: incident.assigned_handler_name },
    })

    return incident
  }

  async acknowledge(
    currentUser: UserSummary,
    incidentId: string,
    payload: { expected_version: number }
  ): Promise<IncidentResponse> {
    await this.delay()
    const incident = this.incidents.find((i) => i.id === incidentId)
    if (!incident) throw ErrorPresets.notFound()
    if (currentUser.role !== 'handler' && currentUser.role !== 'department_manager' && currentUser.role !== 'administrator') {
      throw ErrorPresets.forbidden()
    }
    if (incident.status !== 'assigned') {
      throw ErrorPresets.invalidTransition(incident.status, 'in_progress')
    }
    if (payload.expected_version !== incident.version) {
      throw ErrorPresets.versionConflict(payload.expected_version, incident.version)
    }

    const now = new Date().toISOString()
    incident.version += 1
    incident.status = 'in_progress'
    incident.acknowledged_at = now

    // If unassigned handler, assign to this handler
    if (!incident.assigned_handler_id && currentUser.role === 'handler') {
      incident.assigned_handler_id = currentUser.id
      incident.assigned_handler_name = currentUser.display_name
    }

    if (!this.history[incidentId]) this.history[incidentId] = []
    this.history[incidentId].push({
      id: generateRequestId(),
      action: 'Tiếp nhận sự cố (Acknowledge) - Chuyển sang Đang xử lý',
      actor_display_name: currentUser.display_name,
      created_at: now,
      visibility: 'public',
      details: { acknowledged_at: now },
    })

    return incident
  }

  async changePriority(
    currentUser: UserSummary,
    incidentId: string,
    payload: { priority: Priority; reason: string; expected_version: number }
  ): Promise<IncidentResponse> {
    await this.delay()
    const incident = this.incidents.find((i) => i.id === incidentId)
    if (!incident) throw ErrorPresets.notFound()
    if (currentUser.role !== 'department_manager' && currentUser.role !== 'administrator') {
      throw ErrorPresets.forbidden('Chỉ Quản lý mới được đổi độ ưu tiên')
    }
    if (payload.expected_version !== incident.version) {
      throw ErrorPresets.versionConflict(payload.expected_version, incident.version)
    }

    const oldP = incident.priority
    incident.version += 1
    incident.priority = payload.priority

    // If not yet acknowledged, recalculate deadline from reported_at
    if (!incident.acknowledged_at) {
      incident.acknowledgment_deadline_at = this.calculateDeadline(incident.reported_at, payload.priority)
    }

    const now = new Date().toISOString()
    if (!this.history[incidentId]) this.history[incidentId] = []
    this.history[incidentId].push({
      id: generateRequestId(),
      action: `Điều chỉnh độ ưu tiên từ ${oldP?.toUpperCase() ?? 'None'} -> ${payload.priority?.toUpperCase()}`,
      actor_display_name: currentUser.display_name,
      created_at: now,
      visibility: 'public',
      details: { reason: payload.reason, new_priority: payload.priority },
    })

    return incident
  }

  async transitionStatus(
    currentUser: UserSummary,
    incidentId: string,
    payload: {
      target_status: Status
      reason?: string
      resolution?: string
      expected_version: number
    }
  ): Promise<IncidentResponse> {
    await this.delay()
    const incident = this.incidents.find((i) => i.id === incidentId)
    if (!incident) throw ErrorPresets.notFound()
    if (payload.expected_version !== incident.version) {
      throw ErrorPresets.versionConflict(payload.expected_version, incident.version)
    }

    const currentStatus = incident.status
    const target = payload.target_status
    const now = new Date().toISOString()

    // Transition validation per contract
    if (currentStatus === 'in_progress' && target === 'resolved') {
      if (!payload.resolution || payload.resolution.trim().length === 0) {
        throw createContractError('missing_resolution', 'Nội dung giải quyết (resolution) là bắt buộc khi Resolved.')
      }
      incident.version += 1
      incident.status = 'resolved'
      incident.resolution = payload.resolution
      incident.resolved_at = now
    } else if (currentStatus === 'resolved' && target === 'closed') {
      if (currentUser.role !== 'department_manager' && currentUser.role !== 'administrator') {
        throw ErrorPresets.forbidden('Chỉ Quản lý bộ phận mới được đóng sự cố.')
      }
      incident.version += 1
      incident.status = 'closed'
      incident.closed_at = now
    } else if (currentStatus === 'resolved' && target === 'in_progress') {
      if (currentUser.role !== 'department_manager' && currentUser.role !== 'administrator') {
        throw ErrorPresets.forbidden('Chỉ Quản lý bộ phận mới được trả lại xử lý.')
      }
      if (!payload.reason) {
        throw createContractError('missing_reason', 'Bắt buộc cung cấp lý do khi trả lại xử lý.')
      }
      incident.version += 1
      incident.status = 'in_progress'
      incident.resolved_at = null
    } else if (currentStatus === 'closed' && target === 'in_progress') {
      if (currentUser.role !== 'department_manager' && currentUser.role !== 'administrator') {
        throw ErrorPresets.forbidden('Chỉ Quản lý bộ phận mới được mở lại sự cố.')
      }
      if (!payload.reason) {
        throw createContractError('missing_reason', 'Bắt buộc cung cấp lý do khi mở lại sự cố.')
      }
      incident.version += 1
      incident.status = 'in_progress'
      incident.closed_at = null
    } else {
      throw ErrorPresets.invalidTransition(currentStatus, target)
    }

    if (!this.history[incidentId]) this.history[incidentId] = []
    this.history[incidentId].push({
      id: generateRequestId(),
      action: `Chuyển trạng thái: ${currentStatus.toUpperCase()} -> ${target.toUpperCase()}`,
      actor_display_name: currentUser.display_name,
      created_at: now,
      visibility: 'public',
      details: {
        reason: payload.reason,
        resolution: payload.resolution,
      },
    })

    return incident
  }

  async markDisposition(
    currentUser: UserSummary,
    incidentId: string,
    payload: {
      kind: 'duplicate' | 'invalid'
      reason: string
      duplicate_of_id?: string | null
      expected_version: number
    }
  ): Promise<IncidentResponse> {
    await this.delay()
    const incident = this.incidents.find((i) => i.id === incidentId)
    if (!incident) throw ErrorPresets.notFound()
    if (currentUser.role !== 'department_manager' && currentUser.role !== 'administrator') {
      throw ErrorPresets.forbidden('Chỉ Quản lý bộ phận mới được xử lý disposition.')
    }
    if (payload.expected_version !== incident.version) {
      throw ErrorPresets.versionConflict(payload.expected_version, incident.version)
    }

    const now = new Date().toISOString()
    incident.version += 1
    incident.status = 'closed'
    incident.closed_at = now
    incident.disposition = {
      kind: payload.kind,
      reason: payload.reason,
      duplicate_of_id: payload.duplicate_of_id ?? null,
    }

    if (!this.history[incidentId]) this.history[incidentId] = []
    this.history[incidentId].push({
      id: generateRequestId(),
      action: `Đánh dấu ${payload.kind === 'duplicate' ? 'Trùng lặp (Duplicate)' : 'Không hợp lệ (Invalid)'} và Đóng sự cố`,
      actor_display_name: currentUser.display_name,
      created_at: now,
      visibility: 'public',
      details: {
        kind: payload.kind,
        reason: payload.reason,
        duplicate_of_id: payload.duplicate_of_id,
      },
    })

    return incident
  }
}

export const mockApi = new MockApiService()
