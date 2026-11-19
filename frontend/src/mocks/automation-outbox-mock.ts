/**
 * Mock Service cho Outbox Events và Automation Health (N5 / N7 tích hợp)
 * Tuân thủ schema N5 trong docs/n5-event-contract.md và backend/app/automation/models.py
 */

import type { UserSummary } from '../types/auth.ts'

export type OutboxEventStatus = 'pending' | 'processing' | 'done' | 'failed'

export interface OutboxEventMock {
  id: string
  event_type: 'incident.reported' | 'incident.assigned' | 'incident.priority_changed' | 'incident.escalated' | 'incident.status_changed'
  incident_id: string
  incident_title: string
  department_id: string
  department_name: string
  request_id: string
  occurred_at: string
  schema_version: number
  status: OutboxEventStatus
  payload: Record<string, unknown> | null
  attempt_count: number
  max_attempts: number
  lease_token: string | null
  lease_expires_at: string | null
  last_attempt_at: string | null
  next_attempt_at: string | null
  error_message: string | null
}

export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'uncertain'

export interface NotificationMock {
  id: string
  event_id: string
  kind: 'email' | 'in_app'
  recipient_user_id: string
  recipient_name: string
  recipient_email: string
  department_id: string
  status: NotificationStatus
  attempt_count: number
  error_message: string | null
  created_at: string
}

export const INITIAL_OUTBOX_EVENTS: OutboxEventMock[] = [
  // 1. Sự kiện đã hoàn tất (done) - CSVC
  {
    id: 'outbox-ev-001',
    event_type: 'incident.reported',
    incident_id: '2ee24992-34d3-4955-9e5c-f7446fd42393',
    incident_title: 'Rò nước nghiêm trọng ở trần gần tủ điện phòng thí nghiệm',
    department_id: 'dept-csvc',
    department_name: 'Cơ sở vật chất',
    request_id: 'req-001-abc',
    occurred_at: '2026-10-15T08:05:00Z',
    schema_version: 1,
    status: 'done',
    payload: { category: 'water_leak', severity: 'high' },
    attempt_count: 1,
    max_attempts: 5,
    lease_token: null,
    lease_expires_at: null,
    last_attempt_at: '2026-10-15T08:05:02Z',
    next_attempt_at: null,
    error_message: null,
  },
  // 2. Sự kiện SLA Escalation đã chuyển tiếp (done) - CSVC
  {
    id: 'outbox-ev-002',
    event_type: 'incident.escalated',
    incident_id: '2ee24992-34d3-4955-9e5c-f7446fd42393',
    incident_title: 'Rò nước nghiêm trọng ở trần gần tủ điện phòng thí nghiệm',
    department_id: 'dept-csvc',
    department_name: 'Cơ sở vật chất',
    request_id: 'req-002-esc',
    occurred_at: '2026-10-15T08:21:00Z',
    schema_version: 1,
    status: 'done',
    payload: { escalation_level: 1, overdue_minutes: 15 },
    attempt_count: 1,
    max_attempts: 5,
    lease_token: null,
    lease_expires_at: null,
    last_attempt_at: '2026-10-15T08:21:03Z',
    next_attempt_at: null,
    error_message: null,
  },
  // 3. Sự kiện đang xử lý (processing) - Điện
  {
    id: 'outbox-ev-003',
    event_type: 'incident.assigned',
    incident_id: '4ab12100-34d3-4955-9e5c-f7446fd42394',
    incident_title: 'Ổ cắm điện phát ra tiếng lách tách và có khói khét',
    department_id: 'dept-dien',
    department_name: 'Điện và an toàn',
    request_id: 'req-003-assign',
    occurred_at: '2026-10-15T08:37:00Z',
    schema_version: 1,
    status: 'processing',
    payload: { handler_id: '33a01234-76fd-4638-a97f-96919031e002' },
    attempt_count: 1,
    max_attempts: 5,
    lease_token: 'lease-worker-01',
    lease_expires_at: '2026-10-15T08:38:00Z',
    last_attempt_at: '2026-10-15T08:37:05Z',
    next_attempt_at: null,
    error_message: null,
  },
  // 4. Sự kiện LỖI (failed / Dead-letter queue) - IT / Security (n8n webhook timeout)
  {
    id: 'outbox-ev-004-fail',
    event_type: 'incident.reported',
    incident_id: '8de56322-34d3-4955-9e5c-f7446fd42396',
    incident_title: 'Email mạo danh phòng Đào tạo yêu cầu đổi mật khẩu tài khoản trường',
    department_id: 'dept-it',
    department_name: 'IT / Security',
    request_id: 'req-004-phish',
    occurred_at: '2026-10-15T07:20:00Z',
    schema_version: 1,
    status: 'failed',
    payload: { category: 'phishing', severity: 'high', priority: 'p1' },
    attempt_count: 5,
    max_attempts: 5,
    lease_token: null,
    lease_expires_at: null,
    last_attempt_at: '2026-10-15T07:35:00Z',
    next_attempt_at: null,
    error_message: 'Webhook dispatch failed: HTTP 504 Gateway Timeout kết nối n8n http://localhost:5678/webhook/events. Quá 5 lần thử lại (Dead-letter).',
  },
  // 5. Sự kiện LỖI (failed) - CSVC (HMAC Signature Mismatch sau xoay key)
  {
    id: 'outbox-ev-005-fail',
    event_type: 'incident.status_changed',
    incident_id: '1fa78433-34d3-4955-9e5c-f7446fd42397',
    incident_title: 'Vòi nước rửa tay nhà vệ sinh nam bị rỉ giọt',
    department_id: 'dept-csvc',
    department_name: 'Cơ sở vật chất',
    request_id: 'req-005-status',
    occurred_at: '2026-10-14T16:30:00Z',
    schema_version: 1,
    status: 'failed',
    payload: { old_status: 'in_progress', new_status: 'resolved' },
    attempt_count: 5,
    max_attempts: 5,
    lease_token: null,
    lease_expires_at: null,
    last_attempt_at: '2026-10-14T16:45:00Z',
    next_attempt_at: null,
    error_message: 'HTTP 401 Unauthorized: HMAC signature verification failed sau xoay token service. Worker dừng dispatch.',
  },
  // 6. Sự kiện chờ xử lý (pending) - Triage
  {
    id: 'outbox-ev-006-pending',
    event_type: 'incident.reported',
    incident_id: '6bc34211-34d3-4955-9e5c-f7446fd42395',
    incident_title: 'Có vũng nước đọng ở sảnh không rõ nguyên nhân',
    department_id: 'dept-triage',
    department_name: 'Hàng đợi phân loại thủ công',
    request_id: 'req-006-triage',
    occurred_at: '2026-10-15T09:05:00Z',
    schema_version: 1,
    status: 'pending',
    payload: { triage_required: true },
    attempt_count: 0,
    max_attempts: 5,
    lease_token: null,
    lease_expires_at: null,
    last_attempt_at: null,
    next_attempt_at: '2026-10-15T09:06:00Z',
    error_message: null,
  },
]

export const INITIAL_NOTIFICATIONS: NotificationMock[] = [
  {
    id: 'notif-001',
    event_id: 'outbox-ev-001',
    kind: 'email',
    recipient_user_id: '33a01234-76fd-4638-a97f-96919031e001',
    recipient_name: 'Phạm Văn Nam (KTV Cơ sở vật chất)',
    recipient_email: 'handler.csvc@usth.edu.vn',
    department_id: 'dept-csvc',
    status: 'sent',
    attempt_count: 1,
    error_message: null,
    created_at: '2026-10-15T08:08:10Z',
  },
  {
    id: 'notif-002',
    event_id: 'outbox-ev-002',
    kind: 'email',
    recipient_user_id: '44b01234-76fd-4638-a97f-96919031e003',
    recipient_name: 'Hoàng Đức (Trưởng ban Cơ sở vật chất)',
    recipient_email: 'manager.csvc@usth.edu.vn',
    department_id: 'dept-csvc',
    status: 'sent',
    attempt_count: 1,
    error_message: null,
    created_at: '2026-10-15T08:21:05Z',
  },
  {
    id: 'notif-003-fail',
    event_id: 'outbox-ev-004-fail',
    kind: 'email',
    recipient_user_id: '44b01234-76fd-4638-a97f-96919031e005',
    recipient_name: 'Vũ Văn An (Trưởng nhóm An ninh mạng)',
    recipient_email: 'manager.it@usth.edu.vn',
    department_id: 'dept-it',
    status: 'failed',
    attempt_count: 3,
    error_message: 'SMTP Connect timeout to mailhub.usth.edu.vn:25 sau 3 lần thử.',
    created_at: '2026-10-15T07:25:00Z',
  },
]

class AutomationOutboxMockService {
  private events: OutboxEventMock[] = JSON.parse(JSON.stringify(INITIAL_OUTBOX_EVENTS))
  private notifications: NotificationMock[] = JSON.parse(JSON.stringify(INITIAL_NOTIFICATIONS))

  /**
   * Lấy danh sách Outbox Events theo phạm vi Role
   */
  async getOutboxEvents(actor: UserSummary): Promise<OutboxEventMock[]> {
    if (actor.role === 'reporter') {
      throw {
        error: {
          code: 'forbidden',
          message: 'Quyền truy cập bị từ chối: Reporter không có quyền xem sự kiện Automation Outbox.',
        },
      }
    }

    if (actor.role === 'administrator') {
      return [...this.events]
    }

    if (actor.role === 'department_manager') {
      if (actor.department_id === 'dept-triage') {
        return this.events.filter((e) => e.department_id === 'dept-triage')
      }
      return this.events.filter((e) => e.department_id === actor.department_id)
    }

    if (actor.role === 'handler') {
      // Handler chỉ xem các sự kiện liên quan đến bộ phận của mình
      return this.events.filter((e) => e.department_id === actor.department_id)
    }

    return []
  }

  /**
   * Lấy danh sách Notifications theo phạm vi Role
   */
  async getNotifications(actor: UserSummary): Promise<NotificationMock[]> {
    if (actor.role === 'reporter') {
      throw {
        error: {
          code: 'forbidden',
          message: 'Quyền truy cập bị từ chối: Reporter không có quyền xem Notifications hệ thống.',
        },
      }
    }

    if (actor.role === 'administrator') {
      return [...this.notifications]
    }

    if (actor.role === 'department_manager') {
      return this.notifications.filter((n) => n.department_id === actor.department_id)
    }

    if (actor.role === 'handler') {
      return this.notifications.filter((n) => n.recipient_user_id === actor.id)
    }

    return []
  }

  /**
   * Admin can thiệp: Thử lại sự kiện lỗi Outbox kèm lý do (Audit Reason)
   */
  async retryOutboxEvent(
    eventId: string,
    reason: string,
    actor: UserSummary
  ): Promise<OutboxEventMock> {
    if (actor.role !== 'administrator' && actor.role !== 'department_manager') {
      throw {
        error: {
          code: 'forbidden',
          message: 'Chỉ Quản trị viên (Admin) hoặc Trưởng bộ phận mới có quyền yêu cầu thử lại sự kiện lỗi.',
        },
      }
    }

    if (!reason || reason.trim().length < 5) {
      throw {
        error: {
          code: 'validation_error',
          message: 'Bắt buộc nhập lý do can thiệp thử lại sự kiện (tối thiểu 5 ký tự).',
        },
      }
    }

    const event = this.events.find((e) => e.id === eventId)
    if (!event) {
      throw {
        error: {
          code: 'not_found',
          message: `Không tìm thấy sự kiện Outbox có ID ${eventId}.`,
        },
      }
    }

    if (actor.role === 'department_manager' && event.department_id !== actor.department_id) {
      throw {
        error: {
          code: 'forbidden',
          message: 'Trưởng bộ phận chỉ được can thiệp các sự kiện thuộc bộ phận của mình.',
        },
      }
    }

    // Đặt lại trạng thái pending, reset attempt_count
    event.status = 'pending'
    event.attempt_count = 0
    event.error_message = `Được đặt lịch thử lại bởi ${actor.display_name}. Lý do: ${reason.trim()}`
    event.next_attempt_at = new Date().toISOString()
    event.last_attempt_at = new Date().toISOString()

    return { ...event }
  }

  /**
   * Đặt lại dữ liệu gốc ban đầu
   */
  resetData(): void {
    this.events = JSON.parse(JSON.stringify(INITIAL_OUTBOX_EVENTS))
    this.notifications = JSON.parse(JSON.stringify(INITIAL_NOTIFICATIONS))
  }
}

export const mockAutomationOutboxApi = new AutomationOutboxMockService()
