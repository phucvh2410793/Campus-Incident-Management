import { mockApi } from '../mocks/mock-api-service.ts'
import { mockN7StaffRoleApi } from '../mocks/n7-role-mock-api.ts'
import type { UserSummary } from '../types/auth.ts'
import type { IncidentResponse, IncidentSummary, Priority, Status } from '../types/incident.ts'

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
}
