/**
 * Logic tính toán chỉ số Dashboard theo phạm vi quyền (Task N7-W07)
 * Đảm bảo:
 * 1. Reporter bị từ chối 403 Forbidden.
 * 2. Handler chỉ thấy sự cố và automation liên quan đến việc được giao cho mình.
 * 3. Department Manager chỉ thấy sự cố và automation trong bộ phận của mình (hoặc Triage).
 * 4. Administrator thấy toàn bộ sự cố toàn trường và toàn bộ sự kiện Outbox/Automation.
 * 5. Xác định rõ trạng thái Empty và Overdue SLA.
 */

import type { UserSummary } from '../../types/auth.ts'
import type { IncidentResponse, Status } from '../../types/incident.ts'
import type { OutboxEventMock, NotificationMock } from '../../mocks/automation-outbox-mock.ts'
import { DEPARTMENTS } from '../../mocks/mock-users.ts'
import { mockN7StaffRoleApi } from '../../mocks/n7-role-mock-api.ts'

export interface OverdueIncidentDetail {
  incident: IncidentResponse
  overdueMinutes: number
  deadlineFormatted: string
  reportedAtFormatted: string
  handlerName: string
  departmentName: string
  isAcknowledgedLate: boolean
}

export interface DepartmentMetricItem {
  departmentId: string
  departmentName: string
  totalCount: number
  overdueCount: number
  p1Count: number
  inProgressCount: number
}

export interface RoleDashboardMetrics {
  actorRole: UserSummary['role']
  actorName: string
  departmentId: string | null
  departmentName: string
  scopeLabel: string
  totalIncidents: number
  statusCounts: {
    reported: number
    assigned: number
    in_progress: number
    resolved: number
    closed: number
  }
  priorityCounts: {
    p1: number
    p2: number
    p3: number
    unassigned: number
  }
  overdueCount: number
  warningCount: number
  safeCount: number
  triageRequiredCount: number
  overdueIncidents: OverdueIncidentDetail[]
  automationStats: {
    totalEvents: number
    doneEvents: number
    processingEvents: number
    pendingEvents: number
    failedEvents: number
    failedList: OutboxEventMock[]
    notificationsTotal: number
    notificationsFailed: number
    notificationsList: NotificationMock[]
  }
  departmentBreakdown: DepartmentMetricItem[]
  isEmpty: boolean
  isOverdueEmpty: boolean
  isAutomationClean: boolean
}

/**
 * Tính toán và tổng hợp dữ liệu Dashboard chuẩn phạm vi Role
 */
export function calculateRoleDashboard(
  actor: UserSummary,
  allIncidents: IncidentResponse[],
  allOutboxEvents: OutboxEventMock[],
  allNotifications: NotificationMock[],
  forceEmpty = false
): RoleDashboardMetrics {
  // 1. Role Guard: Reporter không có quyền truy cập
  if (actor.role === 'reporter') {
    throw {
      error: {
        code: 'forbidden',
        message: 'Quyền truy cập bị từ chối: Tài khoản Người báo cáo (Reporter) không có quyền xem Dashboard Quản lý & Nhân viên.',
      },
    }
  }

  if (forceEmpty) {
    return {
      actorRole: actor.role,
      actorName: actor.display_name,
      departmentId: actor.department_id,
      departmentName: 'Dữ liệu mô phỏng trống',
      scopeLabel: 'Chế độ mô phỏng trạng thái Rỗng (Empty Demo)',
      totalIncidents: 0,
      statusCounts: { reported: 0, assigned: 0, in_progress: 0, resolved: 0, closed: 0 },
      priorityCounts: { p1: 0, p2: 0, p3: 0, unassigned: 0 },
      overdueCount: 0,
      warningCount: 0,
      safeCount: 0,
      triageRequiredCount: 0,
      overdueIncidents: [],
      automationStats: {
        totalEvents: 0,
        doneEvents: 0,
        processingEvents: 0,
        pendingEvents: 0,
        failedEvents: 0,
        failedList: [],
        notificationsTotal: 0,
        notificationsFailed: 0,
        notificationsList: [],
      },
      departmentBreakdown: [],
      isEmpty: true,
      isOverdueEmpty: true,
      isAutomationClean: true,
    }
  }

  // 2. Lọc danh sách Incident theo phạm vi Role
  let scopedIncidents: IncidentResponse[] = []
  let scopeLabel = ''

  if (actor.role === 'handler') {
    // Handler chỉ thấy việc được giao cho cá nhân mình
    scopedIncidents = allIncidents.filter(
      (i) => i.assigned_handler_id === actor.id && i.department_id === actor.department_id
    )
    scopeLabel = `Cá nhân Kỹ thuật viên (${actor.display_name})`
  } else if (actor.role === 'department_manager') {
    if (actor.department_id === 'dept-triage') {
      scopedIncidents = allIncidents.filter((i) => i.department_id === 'dept-triage')
      scopeLabel = 'Hàng đợi Phân loại & Triage ban đầu'
    } else {
      scopedIncidents = allIncidents.filter((i) => i.department_id === actor.department_id)
      const deptName = actor.department_id ? DEPARTMENTS[actor.department_id]?.name || actor.department_id : ''
      scopeLabel = `Bộ phận: ${deptName}`
    }
  } else if (actor.role === 'administrator') {
    // Administrator xem toàn bộ
    scopedIncidents = [...allIncidents]
    scopeLabel = 'Toàn trường (Tất cả bộ phận)'
  }

  // 3. Lọc sự kiện Outbox theo phạm vi Role
  let scopedOutbox: OutboxEventMock[] = []
  if (actor.role === 'handler') {
    // Chỉ đếm sự kiện của những sự cố handler được phép xem.
    scopedOutbox = allOutboxEvents.filter(
      (e) => scopedIncidents.some((i) => i.id === e.incident_id)
    )
  } else if (actor.role === 'department_manager') {
    scopedOutbox = allOutboxEvents.filter((e) => e.department_id === actor.department_id)
  } else if (actor.role === 'administrator') {
    scopedOutbox = [...allOutboxEvents]
  }

  // 4. Lọc thông báo Notification theo phạm vi Role
  let scopedNotifs: NotificationMock[] = []
  if (actor.role === 'handler') {
    scopedNotifs = allNotifications.filter((n) => n.recipient_user_id === actor.id)
  } else if (actor.role === 'department_manager') {
    scopedNotifs = allNotifications.filter((n) => n.department_id === actor.department_id)
  } else if (actor.role === 'administrator') {
    scopedNotifs = [...allNotifications]
  }

  // 5. Tính toán các chỉ số thống kê
  const statusCounts: Record<Status, number> = {
    reported: 0,
    assigned: 0,
    in_progress: 0,
    resolved: 0,
    closed: 0,
  }

  const priorityCounts: { p1: number; p2: number; p3: number; unassigned: number } = {
    p1: 0,
    p2: 0,
    p3: 0,
    unassigned: 0,
  }

  let overdueCount = 0
  let warningCount = 0
  let safeCount = 0
  let triageRequiredCount = 0
  const overdueList: OverdueIncidentDetail[] = []

  for (const inc of scopedIncidents) {
    // Đếm status
    if (statusCounts[inc.status] !== undefined) {
      statusCounts[inc.status]++
    }

    // Đếm priority
    if (inc.priority === 'p1') priorityCounts.p1++
    else if (inc.priority === 'p2') priorityCounts.p2++
    else if (inc.priority === 'p3') priorityCounts.p3++
    else priorityCounts.unassigned++

    // Đếm Triage
    if (inc.triage_required) triageRequiredCount++

    // Đánh giá SLA
    const sla = mockN7StaffRoleApi.getSlaStatus(inc)
    if (sla.state === 'overdue') {
      overdueCount++
      let overdueMinutes = Math.abs(sla.remainingMinutes)
      if (overdueMinutes === 0 && inc.acknowledgment_deadline_at) {
        const deadlineMs = new Date(inc.acknowledgment_deadline_at).getTime()
        const checkTimeMs = inc.acknowledged_at ? new Date(inc.acknowledged_at).getTime() : Date.now()
        overdueMinutes = Math.max(1, Math.round((checkTimeMs - deadlineMs) / (60 * 1000)))
      }

      overdueList.push({
        incident: inc,
        overdueMinutes,
        deadlineFormatted: inc.acknowledgment_deadline_at
          ? new Date(inc.acknowledgment_deadline_at).toLocaleString('vi-VN')
          : 'Không có hạn',
        reportedAtFormatted: new Date(inc.reported_at).toLocaleString('vi-VN'),
        handlerName: inc.assigned_handler_name || 'Chưa phân công',
        departmentName: inc.department_name || (inc.department_id ? DEPARTMENTS[inc.department_id]?.name || inc.department_id : 'Chưa gán'),
        isAcknowledgedLate: Boolean(inc.acknowledged_at),
      })
    } else if (sla.state === 'warning') {
      warningCount++
    } else {
      safeCount++
    }
  }

  // Sắp xếp danh sách quá hạn theo thời gian trễ giảm dần (trễ nhiều nhất lên trước)
  overdueList.sort((a, b) => b.overdueMinutes - a.overdueMinutes)

  // 6. Tính toán chỉ số tự động hóa (Outbox & Webhook)
  const failedEvents = scopedOutbox.filter((e) => e.status === 'failed')
  const doneEvents = scopedOutbox.filter((e) => e.status === 'done').length
  const processingEvents = scopedOutbox.filter((e) => e.status === 'processing').length
  const pendingEvents = scopedOutbox.filter((e) => e.status === 'pending').length
  const failedNotifications = scopedNotifs.filter((n) => n.status === 'failed').length

  // 7. Phân bổ theo bộ phận (Dành cho Administrator)
  const deptBreakdown: DepartmentMetricItem[] = []
  if (actor.role === 'administrator') {
    const deptKeys = Object.keys(DEPARTMENTS)
    for (const dKey of deptKeys) {
      const deptIncidents = allIncidents.filter((i) => i.department_id === dKey)
      const deptOverdue = deptIncidents.filter((i) => mockN7StaffRoleApi.getSlaStatus(i).state === 'overdue').length
      const deptP1 = deptIncidents.filter((i) => i.priority === 'p1').length
      const deptInProgress = deptIncidents.filter((i) => i.status === 'in_progress').length
      deptBreakdown.push({
        departmentId: dKey,
        departmentName: DEPARTMENTS[dKey].name,
        totalCount: deptIncidents.length,
        overdueCount: deptOverdue,
        p1Count: deptP1,
        inProgressCount: deptInProgress,
      })
    }
  }

  const deptDisplayName = actor.department_id
    ? DEPARTMENTS[actor.department_id]?.name || actor.department_id
    : actor.role === 'administrator'
    ? 'Toàn trường'
    : 'Chưa xác định'

  return {
    actorRole: actor.role,
    actorName: actor.display_name,
    departmentId: actor.department_id,
    departmentName: deptDisplayName,
    scopeLabel,
    totalIncidents: scopedIncidents.length,
    statusCounts,
    priorityCounts,
    overdueCount,
    warningCount,
    safeCount,
    triageRequiredCount,
    overdueIncidents: overdueList,
    automationStats: {
      totalEvents: scopedOutbox.length,
      doneEvents,
      processingEvents,
      pendingEvents,
      failedEvents: failedEvents.length,
      failedList: failedEvents,
      notificationsTotal: scopedNotifs.length,
      notificationsFailed: failedNotifications,
      notificationsList: scopedNotifs,
    },
    departmentBreakdown: deptBreakdown,
    isEmpty: scopedIncidents.length === 0,
    isOverdueEmpty: overdueCount === 0,
    isAutomationClean: failedEvents.length === 0,
  }
}
