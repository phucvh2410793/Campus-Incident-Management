import { mockApi } from '../mocks/mock-api-service.ts'
import {
  mockN7StaffRoleApi,
  type AddCommentInput,
  type TriageInput,
  type AssignInput,
  type PriorityInput,
} from '../mocks/n7-role-mock-api.ts'
import type { UserSummary } from '../types/auth.ts'
import type { AttachmentSummary, Comment, HistoryItem, IncidentResponse, IncidentSummary, Priority, Status } from '../types/incident.ts'

export interface DemoSession {
  user: UserSummary
  accessToken: string
}

let session: DemoSession | null = null

export const demoClient = {
  currentSession: () => session,
  async login(email: string): Promise<DemoSession> {
    const result = await mockApi.login({ email })
    session = { user: result.user, accessToken: result.access_token }
    return session
  },
  logout(): void {
    session = null
  },
  async reporterIncidents(): Promise<IncidentSummary[]> {
    if (!session || !['reporter', 'administrator'].includes(session.user.role)) throw new Error('Bạn cần đăng nhập bằng tài khoản người báo cáo.')
    return (await mockApi.listIncidents(session.user)).items
  },
  async staffIncidents(filters: { status?: Status; priority?: Priority; department_id?: string; search?: string } = {}): Promise<IncidentResponse[]> {
    if (!session || session.user.role === 'reporter') throw new Error('Tài khoản không có quyền xem hàng đợi xử lý.')
    return mockN7StaffRoleApi.getStaffQueue(session.user, filters)
  },
  // N7-W04: Chi tiết, Timeline, File, Comments & Quyền
  async getIncidentDetail(id: string): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi xem chi tiết.')
    return mockN7StaffRoleApi.getIncidentDetail(id, session.user)
  },
  async getIncidentHistory(id: string): Promise<HistoryItem[]> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi xem lịch sử.')
    return mockN7StaffRoleApi.getIncidentHistory(id, session.user)
  },
  async getIncidentComments(id: string): Promise<Comment[]> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi xem trao đổi.')
    return mockN7StaffRoleApi.getIncidentComments(id, session.user)
  },
  async addComment(id: string, input: AddCommentInput): Promise<Comment> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi gửi trao đổi.')
    return mockN7StaffRoleApi.addComment(id, input, session.user)
  },
  async getIncidentAttachments(id: string): Promise<AttachmentSummary[]> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi xem tệp đính kèm.')
    return mockN7StaffRoleApi.getIncidentAttachments(id, session.user)
  },
  // N7-W05: Triage, Phân công/chuyển bộ phận, Đổi priority kèm reason
  async triageIncident(id: string, input: TriageInput): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi phân loại Triage.')
    return mockN7StaffRoleApi.triageIncident(id, input, session.user)
  },
  async assignIncident(id: string, input: AssignInput): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi phân công sự cố.')
    return mockN7StaffRoleApi.assignIncident(id, input, session.user)
  },
  async adjustPriority(id: string, input: PriorityInput): Promise<IncidentResponse> {
    if (!session) throw new Error('Yêu cầu đăng nhập trước khi điều chỉnh độ ưu tiên.')
    return mockN7StaffRoleApi.adjustPriority(id, input, session.user)
  },
}
