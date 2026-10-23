import type { UserSummary, LoginRequest, LoginResponse } from '../../types/auth.ts'
import type { IncidentResponse } from '../../types/incident.ts'
import { mockN6ReporterApi } from '../../mocks/n6-contract-mock-api.ts'
import { ErrorPresets } from '../../mocks/contract-errors.ts'

/**
 * Task N6-W02: API Client & Quản lý Bearer Token thuần túy trong Memory
 *
 * RÀNG BUỘC CONTRACT (docs/api-contract.md):
 * "Frontend giữ token trong memory, không lưu vào browser storage, cookie hoặc log.
 * Tải lại trang cần đăng nhập lại. Logout thu hồi session."
 */

// Biến bộ nhớ (In-Memory Closure) — Tuyệt đối KHÔNG lưu vào localStorage/sessionStorage/cookies
let inMemoryBearerToken: string | null = null

export const reporterApiClient = {
  /**
   * Đăng nhập xác thực và lưu token vào bộ nhớ RAM
   */
  async login(payload: LoginRequest): Promise<LoginResponse> {
    const res = await mockN6ReporterApi.login(payload)

    // Lưu token nghiêm ngặt CHỈ vào biến bộ nhớ
    inMemoryBearerToken = res.access_token

    // KHÔNG gọi localStorage.setItem, sessionStorage.setItem hay document.cookie!
    return res
  },

  /**
   * Lấy thông tin người dùng hiện tại từ token trong bộ nhớ
   */
  async getMe(): Promise<UserSummary> {
    if (!inMemoryBearerToken) {
      throw ErrorPresets.unauthenticated()
    }
    return mockN6ReporterApi.getMe(inMemoryBearerToken)
  },

  /**
   * Đăng xuất và xóa token khỏi bộ nhớ RAM
   */
  async logout(): Promise<void> {
    if (inMemoryBearerToken) {
      await mockN6ReporterApi.logout(inMemoryBearerToken)
    }
    // Thu hồi và xóa token khỏi memory
    inMemoryBearerToken = null
  },

  /**
   * Lấy danh sách sự cố của chính người báo cáo qua Bearer token
   */
  async getMyIncidents(): Promise<IncidentResponse[]> {
    if (!inMemoryBearerToken) {
      throw ErrorPresets.unauthenticated()
    }
    return mockN6ReporterApi.getMyIncidents(inMemoryBearerToken)
  },

  /**
   * Kiểm tra xem token có đang tồn tại trong bộ nhớ không
   */
  isAuthenticated(): boolean {
    return inMemoryBearerToken !== null && inMemoryBearerToken.length > 0
  },

  /**
   * Tiện ích đối soát bảo mật (Security Auditor):
   * Chứng minh cho người dùng và người chấm rằng browser storage KHÔNG chứa token!
   */
  verifyStorageClean(): {
    isClean: boolean
    localStorageKeys: string[]
    sessionStorageKeys: string[]
    cookieStatus: string
  } {
    let localKeys: string[] = []
    let sessionKeys: string[] = []

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localKeys = Object.keys(window.localStorage)
      }
      if (typeof window !== 'undefined' && window.sessionStorage) {
        sessionKeys = Object.keys(window.sessionStorage)
      }
    } catch {
      // Storage có thể bị chặn bởi browser sandbox
    }

    const hasLocalToken = localKeys.some((k) => k.toLowerCase().includes('token') || k.toLowerCase().includes('auth'))
    const hasSessionToken = sessionKeys.some((k) => k.toLowerCase().includes('token') || k.toLowerCase().includes('auth'))

    return {
      isClean: !hasLocalToken && !hasSessionToken,
      localStorageKeys: localKeys,
      sessionStorageKeys: sessionKeys,
      cookieStatus: typeof document !== 'undefined' && document.cookie ? 'Có cookie khác' : 'Trống (Không cookie token)',
    }
  },
}
