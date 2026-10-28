import { mockApi } from '../mocks/mock-api-service.ts'
import { mockN7StaffRoleApi } from '../mocks/n7-role-mock-api.ts'
import { mockN6ReporterApi, type CreateIncidentInput, type MockAttachmentInput } from '../mocks/n6-contract-mock-api.ts'
import type { UserSummary } from '../types/auth.ts'
import type { AttachmentSummary, IncidentResponse, IncidentSummary, Priority, Status } from '../types/incident.ts'

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
  // N6-W06: Tạo sự cố kèm Idempotency-Key chống gửi lặp
  async createIncident(
    input: CreateIncidentInput,
    idempotencyKey: string
  ): Promise<{ status: 200 | 201; data: IncidentResponse }> {
    if (!session || !['reporter', 'administrator'].includes(session.user.role)) {
      throw new Error('Bạn cần đăng nhập bằng tài khoản người báo cáo.')
    }
    const res = await mockN6ReporterApi.createIncident(input, idempotencyKey, session.user.id)
    try {
      const mockIncident = await mockApi.createIncident(session.user, input, idempotencyKey)
      mockIncident.id = res.data.id
    } catch {
      // Best-effort sync
    }
    return res
  },
  // N6-W06: Tải lên từng tệp bằng chứng với expected_version
  async uploadAttachment(
    incidentId: string,
    file: MockAttachmentInput,
    expectedVersion: number
  ): Promise<AttachmentSummary> {
    if (!session || !['reporter', 'administrator'].includes(session.user.role)) {
      throw new Error('Bạn cần đăng nhập bằng tài khoản người báo cáo.')
    }
    const att = await mockN6ReporterApi.uploadAttachment(incidentId, file, expectedVersion, session.user.id)
    try {
      await mockApi.uploadAttachment(session.user, incidentId, {
        name: file.filename,
        size: file.sizeBytes,
        type: file.mimeType,
      }, expectedVersion)
    } catch {
      // Best-effort sync
    }
    return att
  },
}
