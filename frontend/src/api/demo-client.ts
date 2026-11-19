import { mockApi } from '../mocks/mock-api-service.ts'
import {
  type AddCommentInput,
  type TriageInput,
  type AssignInput,
  type PriorityInput,
} from '../mocks/n7-role-mock-api.ts'
import { staffApiAdapter, type AdapterMode } from './staff-api-adapter.ts'
import type { UserSummary } from '../types/auth.ts'
import type {
  AttachmentSummary,
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
  checkBackendHealth: () => staffApiAdapter.checkBackendHealth(),

  async login(email: string): Promise<DemoSession> {
    const result = await mockApi.login({ email })
    session = { user: result.user, accessToken: result.access_token }
    staffApiAdapter.setBearerToken(result.access_token)
    return session
  },

  logout(): void {
    session = null
    staffApiAdapter.setBearerToken(null)
  },

  async reporterIncidents(): Promise<IncidentSummary[]> {
    if (!session || !['reporter', 'administrator'].includes(session.user.role)) {
      throw new Error('Bạn cần đăng nhập bằng tài khoản người báo cáo.')
    }
    return (await mockApi.listIncidents(session.user)).items
  },

  async staffIncidents(
    filters: { status?: Status; priority?: Priority; department_id?: string; search?: string } = {}
  ): Promise<IncidentResponse[]> {
    if (!session || session.user.role === 'reporter') {
      throw new Error('Tài khoản không có quyền xem hàng đợi xử lý.')
    }
    return staffApiAdapter.getAllStaffIncidents(session.user, filters)
  },

  // N7-W04: Chi tiết, Timeline, File, Comments & Quyền
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
}
