import { mockApi } from '../mocks/mock-api-service.ts'
import {
  type AddCommentInput,
  type TriageInput,
  type AssignInput,
  type PriorityInput,
  type DispositionInput,
} from '../mocks/n7-role-mock-api.ts'
import { staffApiAdapter, type AdapterMode } from './staff-api-adapter.ts'
import { reporterApiAdapter, type ReporterAdapterMode } from './reporter-api-adapter.ts'
import {
  type CreateIncidentInput,
  type MockAttachmentInput,
  type PaginatedResult,
  type SupplementIncidentInput,
} from '../mocks/n6-contract-mock-api.ts'
import type { UserSummary } from '../types/auth.ts'
import type {
  AttachmentSummary,
  Category,
  Comment,
  HistoryItem,
  IncidentResponse,
  IncidentSummary,
  Priority,
  Status,
} from '../types/incident.ts'

export interface DemoSession {
  user: UserSummary
  accessToken: string
}

let session: DemoSession | null = null

export const demoClient = {
  currentSession: () => session,

  getAdapterMode: (): AdapterMode => staffApiAdapter.getMode(),
  setAdapterMode: (mode: AdapterMode) => staffApiAdapter.setMode(mode),
  getReporterAdapterMode: (): ReporterAdapterMode => reporterApiAdapter.getMode(),
  setReporterAdapterMode: (mode: ReporterAdapterMode) => reporterApiAdapter.setMode(mode),
  checkBackendHealth: () => staffApiAdapter.checkBackendHealth(),

  async login(email: string, password: string): Promise<DemoSession> {
    const result = reporterApiAdapter.getMode() === 'real'
      ? await reporterApiAdapter.login(email, password)
      : await mockApi.login({ email }).then(value => ({ user: value.user, token: value.access_token }))
    session = { user: result.user, accessToken: result.token }
    staffApiAdapter.setBearerToken(result.token)
    reporterApiAdapter.setBearerToken(result.token)
    return session
  },

  logout(): void {
    session = null
    staffApiAdapter.setBearerToken(null)
    reporterApiAdapter.setBearerToken(null)
  },

  async reporterIncidents(): Promise<IncidentSummary[]> {
    if (!session || !['reporter', 'administrator'].includes(session.user.role)) {
      throw new Error('Bạn cần đăng nhập bằng tài khoản người báo cáo.')
    }
    return (await reporterApiAdapter.getMyIncidents(session.user.id, { limit: 100 })).items
  },
  async staffIncidents(
    filters: { status?: Status; priority?: Priority; department_id?: string; search?: string } = {}
  ): Promise<IncidentResponse[]> {
    if (!session || session.user.role === 'reporter') {
      throw new Error('Tài khoản không có quyền xem hàng đợi xử lý.')
    }
    return staffApiAdapter.getAllStaffIncidents(session.user, filters)
  },

  // N6-W06 / N6-W08: Tạo sự cố kèm Idempotency-Key chống gửi lặp qua Reporter Adapter
  async createIncident(
    input: CreateIncidentInput,
    idempotencyKey: string
  ): Promise<{ status: 200 | 201; data: IncidentResponse }> {
    if (!session || !['reporter', 'administrator'].includes(session.user.role)) {
      throw new Error('Bạn cần đăng nhập bằng tài khoản người báo cáo.')
    }
    const res = await reporterApiAdapter.createIncident(input, idempotencyKey, session.user.id)
    return res
  },
  // N6-W06 / N6-W08: Tải lên từng tệp bằng chứng với expected_version qua Reporter Adapter
  async uploadAttachment(
    incidentId: string,
    file: MockAttachmentInput,
    expectedVersion: number
  ): Promise<AttachmentSummary> {
    if (!session || !['reporter', 'administrator'].includes(session.user.role)) {
      throw new Error('Bạn cần đăng nhập bằng tài khoản người báo cáo.')
    }
    const att = await reporterApiAdapter.uploadAttachment(incidentId, file, expectedVersion, session.user.id)
    return att
  },
  // N6-W07 / N6-W08: Danh sách sự cố người báo cáo với cursor, bộ lọc, overdue qua Reporter Adapter
  async getMyIncidents(
    params?: { category?: Category; status?: Status; limit?: number; cursor?: string }
  ): Promise<PaginatedResult<IncidentSummary>> {
    if (!session || !['reporter', 'administrator'].includes(session.user.role)) {
      throw new Error('Bạn cần đăng nhập bằng tài khoản người báo cáo.')
    }
    return reporterApiAdapter.getMyIncidents(session.user.id, params)
  },
  // N6-W07 / N6-W08: Chi tiết sự cố của người báo cáo (Scope isolation) qua Reporter Adapter
  async getReporterIncidentDetail(id: string): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi xem chi tiết.')
    return reporterApiAdapter.getIncidentDetail(id, session.user.id)
  },
  // N6-W07 / N6-W08: Timeline công khai qua Reporter Adapter
  async getPublicHistory(id: string): Promise<HistoryItem[]> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi xem lịch sử.')
    return reporterApiAdapter.getPublicHistory(id, session.user.id)
  },
  // N6-W07 / N6-W08: Bổ sung thông tin cho sự cố qua Reporter Adapter
  async supplementIncident(
    id: string,
    input: SupplementIncidentInput
  ): Promise<{ id: string; created_at: string; incident_version: number }> {
    if (!session || !['reporter', 'administrator'].includes(session.user.role)) {
      throw new Error('Bạn cần đăng nhập bằng tài khoản người báo cáo.')
    }
    return reporterApiAdapter.supplementIncident(id, input, session.user.id)
  },
  // N6-W07 / N6-W08: Lấy danh sách tệp đính kèm của sự cố qua Reporter Adapter
  async getReporterAttachments(id: string): Promise<AttachmentSummary[]> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi xem tệp đính kèm.')
    return reporterApiAdapter.getAttachments(id, session.user.id)
  },
  // N7-W04: Chi tiết, Timeline, File, Comments & Quyền (Staff)
  async getIncidentDetail(id: string): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi xem chi tiết.')
    return staffApiAdapter.getIncidentDetail(id, session.user)
  },

  async getIncidentHistory(id: string): Promise<HistoryItem[]> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi xem lịch sử.')
    return staffApiAdapter.getHistory(id, session.user)
  },

  async getIncidentComments(id: string): Promise<Comment[]> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi xem trao đổi.')
    return staffApiAdapter.getComments(id, session.user)
  },

  async addComment(id: string, input: AddCommentInput): Promise<Comment> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi gửi trao đổi.')
    return staffApiAdapter.addComment(id, input, session.user)
  },

  async getIncidentAttachments(id: string): Promise<AttachmentSummary[]> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi xem tệp đính kèm.')
    return staffApiAdapter.getAttachments(id, session.user)
  },

  // N7-W05 / N7-W08: Triage, Phân công/chuyển bộ phận, Đổi priority kèm reason
  async triageIncident(id: string, input: TriageInput): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi phân loại Triage.')
    return staffApiAdapter.triageIncident(id, input, session.user)
  },

  async assignIncident(id: string, input: AssignInput): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi phân công sự cố.')
    return staffApiAdapter.assignIncident(id, input, session.user)
  },

  async adjustPriority(id: string, input: PriorityInput): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi điều chỉnh độ ưu tiên.')
    return staffApiAdapter.adjustPriority(id, input, session.user)
  },

  // N7-W08: Chu trình hoàn chỉnh: Acknowledge -> Resolve -> Close -> Reopen
  async acknowledgeIncident(id: string, expectedVersion: number): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi tiếp nhận sự cố.')
    return staffApiAdapter.acknowledgeIncident(id, expectedVersion, session.user)
  },

  async resolveIncident(
    id: string,
    input: { expected_version: number; resolution: string; reason?: string }
  ): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi hoàn tất giải quyết sự cố.')
    return staffApiAdapter.resolveIncident(id, input, session.user)
  },

  async closeIncident(
    id: string,
    input: { expected_version: number; reason?: string }
  ): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi đóng sự cố.')
    return staffApiAdapter.closeIncident(id, input, session.user)
  },

  async reopenIncident(
    id: string,
    input: { expected_version: number; reason: string }
  ): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi mở lại sự cố.')
    return staffApiAdapter.reopenIncident(id, input, session.user)
  },

  async dispositionIncident(
    id: string,
    input: DispositionInput
  ): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi xử lý kết thúc hồ sơ (Disposition).')
    return staffApiAdapter.dispositionIncident(id, input, session.user)
  },
}
