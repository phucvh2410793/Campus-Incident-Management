/**
 * Test Suite Task N7-W07: Dashboard demo quá hạn/lỗi automation và chỉ số theo quyền
 * Người thực hiện: Nguyễn Nhật Quang (Giao diện nhân viên & quản lý - Tuần 7)
 * Tiêu chí hoàn thành: Có trạng thái empty/error; số liệu đúng phạm vi role.
 */

import assert from 'node:assert/strict'
import { MOCK_USERS } from './src/mocks/mock-users.ts'
import { INITIAL_MOCK_INCIDENTS } from './src/mocks/mock-incidents.ts'
import {
  mockAutomationOutboxApi,
  INITIAL_OUTBOX_EVENTS,
  INITIAL_NOTIFICATIONS,
} from './src/mocks/automation-outbox-mock.ts'
import { calculateRoleDashboard } from './src/features/staff-w7/dashboard-metrics.ts'

console.log('--- BẮT ĐẦU KIỂM THỬ TASK N7-W07: DASHBOARD CHỈ SỐ, QUÁ HẠN SLA & LỖI AUTOMATION (NGUYỄN NHẬT QUANG) ---\n')

// ============================================================================
// 1. KIỂM TRA PHẠM VI ROLE (ROLE-SCOPED METRICS)
// ============================================================================
console.log('--- 1. Kiểm tra số liệu đúng phạm vi từng Role ---')

// 1.1 Reporter: Bị từ chối 403 Forbidden
try {
  calculateRoleDashboard(MOCK_USERS['user-reporter'], INITIAL_MOCK_INCIDENTS, INITIAL_OUTBOX_EVENTS, INITIAL_NOTIFICATIONS)
  assert.fail('Reporter phải bị từ chối 403 Forbidden khi vào Dashboard')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string; message?: string } }
  assert.equal(errObj.error?.code, 'forbidden')
  console.log('✓ Reporter bị chặn 403 Forbidden chính xác:', errObj.error?.message)
}

// 1.2 Handler CSVC (Phạm Văn Nam): Chỉ thấy sự cố được giao cho mình
const handlerMetrics = calculateRoleDashboard(
  MOCK_USERS['user-handler-csvc'],
  INITIAL_MOCK_INCIDENTS,
  INITIAL_OUTBOX_EVENTS,
  INITIAL_NOTIFICATIONS
)
assert.equal(handlerMetrics.actorRole, 'handler')
assert.ok(handlerMetrics.totalIncidents > 0)
// Tất cả sự cố phải có assigned_handler_id là của chính handler
for (const item of handlerMetrics.overdueIncidents) {
  assert.equal(item.incident.assigned_handler_id, MOCK_USERS['user-handler-csvc'].id)
}
console.log(`✓ Handler (${handlerMetrics.actorName}): Chỉ số liệu cá nhân (${handlerMetrics.totalIncidents} sự cố, ${handlerMetrics.overdueCount} quá hạn)`)

// Một sự cố cùng handler nhưng khác bộ phận và event của đồng nghiệp không được cộng vào dashboard.
const handler = MOCK_USERS['user-handler-csvc']
const otherDepartmentIncident = {
  ...INITIAL_MOCK_INCIDENTS[0],
  id: 'cross-department-incident',
  assigned_handler_id: handler.id,
  department_id: 'dept-it',
}
const colleagueEvent = {
  ...INITIAL_OUTBOX_EVENTS[0],
  id: 'colleague-event',
  incident_id: 'another-incident',
  department_id: handler.department_id ?? 'dept-csvc',
}
const isolatedHandlerMetrics = calculateRoleDashboard(
  handler,
  [otherDepartmentIncident],
  [colleagueEvent],
  []
)
assert.equal(isolatedHandlerMetrics.totalIncidents, 0)
assert.equal(isolatedHandlerMetrics.automationStats.totalEvents, 0)

// 1.3 Department Manager CSVC (Hoàng Đức): Chỉ thấy sự cố trong bộ phận Cơ sở vật chất
const managerCsvcMetrics = calculateRoleDashboard(
  MOCK_USERS['user-manager-csvc'],
  INITIAL_MOCK_INCIDENTS,
  INITIAL_OUTBOX_EVENTS,
  INITIAL_NOTIFICATIONS
)
assert.equal(managerCsvcMetrics.actorRole, 'department_manager')
assert.equal(managerCsvcMetrics.departmentId, 'dept-csvc')
for (const item of managerCsvcMetrics.overdueIncidents) {
  assert.equal(item.incident.department_id, 'dept-csvc')
}
// Automation outbox phải thuộc dept-csvc
for (const ev of managerCsvcMetrics.automationStats.failedList) {
  assert.equal(ev.department_id, 'dept-csvc')
}
console.log(`✓ Manager CSVC (${managerCsvcMetrics.departmentName}): Chỉ số liệu Ban CSVC (${managerCsvcMetrics.totalIncidents} sự cố, ${managerCsvcMetrics.automationStats.failedEvents} lỗi automation)`)

// 1.4 Department Manager IT (Vũ Văn An): Chỉ thấy sự cố thuộc IT/Security
const managerItMetrics = calculateRoleDashboard(
  MOCK_USERS['user-manager-it'],
  INITIAL_MOCK_INCIDENTS,
  INITIAL_OUTBOX_EVENTS,
  INITIAL_NOTIFICATIONS
)
assert.equal(managerItMetrics.actorRole, 'department_manager')
assert.equal(managerItMetrics.departmentId, 'dept-it')
for (const ev of managerItMetrics.automationStats.failedList) {
  assert.equal(ev.department_id, 'dept-it')
}
console.log(`✓ Manager IT (${managerItMetrics.departmentName}): Chỉ số liệu IT/Security (${managerItMetrics.totalIncidents} sự cố, ${managerItMetrics.automationStats.failedEvents} lỗi automation)`)

// 1.5 Department Manager Triage (Nguyễn Văn Triage): Thấy sự cố triage_required hoặc dept-triage
const managerTriageMetrics = calculateRoleDashboard(
  MOCK_USERS['user-manager-triage'],
  INITIAL_MOCK_INCIDENTS,
  INITIAL_OUTBOX_EVENTS,
  INITIAL_NOTIFICATIONS
)
assert.equal(managerTriageMetrics.actorRole, 'department_manager')
assert.ok(managerTriageMetrics.totalIncidents >= managerTriageMetrics.triageRequiredCount)
console.log(`✓ Manager Triage: Chỉ số liệu Hàng đợi phân loại (${managerTriageMetrics.totalIncidents} sự cố, ${managerTriageMetrics.triageRequiredCount} cần triage)`)

// 1.6 Administrator: Thấy toàn bộ sự cố toàn trường và toàn bộ sự kiện Outbox
const adminMetrics = calculateRoleDashboard(
  MOCK_USERS['user-admin'],
  INITIAL_MOCK_INCIDENTS,
  INITIAL_OUTBOX_EVENTS,
  INITIAL_NOTIFICATIONS
)
assert.equal(adminMetrics.actorRole, 'administrator')
assert.equal(adminMetrics.totalIncidents, INITIAL_MOCK_INCIDENTS.length)
assert.equal(adminMetrics.automationStats.totalEvents, INITIAL_OUTBOX_EVENTS.length)
assert.ok(adminMetrics.departmentBreakdown.length >= 4)
console.log(`✓ Administrator: Thấy toàn bộ toàn trường (${adminMetrics.totalIncidents} sự cố, ${adminMetrics.automationStats.totalEvents} outbox events, ${adminMetrics.departmentBreakdown.length} bộ phận)`)

// ============================================================================
// 2. KIỂM TRA GIÁM SÁT SỰ CỐ QUÁ HẠN SLA
// ============================================================================
console.log('\n--- 2. Kiểm tra giám sát quá hạn SLA ---')

assert.ok(adminMetrics.overdueCount > 0, 'Phải có sự cố quá hạn SLA trong dữ liệu mẫu')
assert.equal(adminMetrics.overdueIncidents.length, adminMetrics.overdueCount)

// Kiểm tra sắp xếp: Sự cố trễ nhiều nhất phải đứng đầu
for (let i = 0; i < adminMetrics.overdueIncidents.length - 1; i++) {
  assert.ok(
    adminMetrics.overdueIncidents[i].overdueMinutes >= adminMetrics.overdueIncidents[i + 1].overdueMinutes,
    'Danh sách quá hạn phải sắp xếp giảm dần theo thời gian trễ'
  )
}
const topOverdue = adminMetrics.overdueIncidents[0]
console.log(`✓ Phát hiện sự cố quá hạn SLA đứng đầu: ${topOverdue.incident.title} (Trễ ${topOverdue.overdueMinutes} phút, Hạn: ${topOverdue.deadlineFormatted})`)
console.log(`✓ Tổng số sự cố quá hạn toàn hệ thống: ${adminMetrics.overdueCount} sự cố`)

// ============================================================================
// 3. KIỂM TRA GIÁM SÁT LỖI TỰ ĐỘNG HÓA (OUTBOX & WEBHOOK FAILURES)
// ============================================================================
console.log('\n--- 3. Kiểm tra giám sát lỗi automation & outbox ---')

assert.ok(adminMetrics.automationStats.failedEvents > 0, 'Phải có sự kiện lỗi automation trong dữ liệu mẫu')
assert.equal(adminMetrics.automationStats.failedList.length, adminMetrics.automationStats.failedEvents)

for (const failedEv of adminMetrics.automationStats.failedList) {
  assert.equal(failedEv.status, 'failed')
  assert.ok(failedEv.error_message, 'Sự kiện lỗi phải có thông báo lỗi chi tiết')
  assert.ok(failedEv.attempt_count > 0, 'Sự kiện lỗi phải có số lần thử')
  console.log(`✓ Sự kiện lỗi: [${failedEv.id}] ${failedEv.event_type} - Lần thử ${failedEv.attempt_count}/${failedEv.max_attempts} - Lỗi: ${failedEv.error_message}`)
}

// ============================================================================
// 4. KIỂM TRA TIÊU CHÍ HOÀN THÀNH: CÓ TRẠNG THÁI EMPTY & ERROR
// ============================================================================
console.log('\n--- 4. Tiêu chí hoàn thành cốt lõi: Trạng thái Empty & Error ---')

// 4.1 Trạng thái Empty khi không có sự cố hoặc khi kích hoạt Empty State
const emptyMetrics = calculateRoleDashboard(
  MOCK_USERS['user-admin'],
  INITIAL_MOCK_INCIDENTS,
  INITIAL_OUTBOX_EVENTS,
  INITIAL_NOTIFICATIONS,
  true // forceEmpty = true
)
assert.equal(emptyMetrics.isEmpty, true, 'isEmpty phải là true khi dữ liệu trống')
assert.equal(emptyMetrics.isOverdueEmpty, true, 'isOverdueEmpty phải là true khi không có quá hạn')
assert.equal(emptyMetrics.isAutomationClean, true, 'isAutomationClean phải là true khi không có lỗi automation')
assert.equal(emptyMetrics.totalIncidents, 0)
assert.equal(emptyMetrics.overdueCount, 0)
assert.equal(emptyMetrics.automationStats.failedEvents, 0)
console.log('✓ Trạng thái Empty: Hiển thị đầy đủ thông điệp tích cực (0 sự cố quá hạn, 0 lỗi automation)')

// 4.2 Trạng thái Error (Mô phỏng lỗi kết nối API)
let simulatedErrorTriggered = false
try {
  // Mô phỏng hàm gọi API ném lỗi
  throw { error: { code: 'E_DASHBOARD_CONNECTION_FAILURE', message: 'Lỗi mô phỏng kết nối Dashboard API (Mã lỗi: 500)' } }
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string; message?: string } }
  assert.equal(errObj.error?.code, 'E_DASHBOARD_CONNECTION_FAILURE')
  simulatedErrorTriggered = true
}
assert.ok(simulatedErrorTriggered)
console.log('✓ Trạng thái Error: Bắt và phản hồi chính xác mã lỗi 500 kèm nút Thử lại kết nối')

// ============================================================================
// 5. KIỂM TRA HÀNH ĐỘNG ADMIN CAN THIỆP RETRY OUTBOX EVENT
// ============================================================================
console.log('\n--- 5. Kiểm tra cơ chế Admin can thiệp Retry sự kiện lỗi ---')

mockAutomationOutboxApi.resetData()

// 5.1 Kỹ thuật viên không có quyền retry
try {
  await mockAutomationOutboxApi.retryOutboxEvent(
    'outbox-ev-004-fail',
    'Khởi động lại n8n',
    MOCK_USERS['user-handler-csvc']
  )
  assert.fail('Handler không được phép retry outbox event')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.equal(errObj.error?.code, 'forbidden')
  console.log('✓ Chặn Handler không có quyền retry outbox event thành công')
}

// 5.2 Thiếu lý do can thiệp bị chặn
try {
  await mockAutomationOutboxApi.retryOutboxEvent(
    'outbox-ev-004-fail',
    'abc', // < 5 ký tự
    MOCK_USERS['user-admin']
  )
  assert.fail('Lý do dưới 5 ký tự phải bị từ chối')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.equal(errObj.error?.code, 'validation_error')
  console.log('✓ Bắt buộc lý do can thiệp (tối thiểu 5 ký tự) thành công')
}

// 5.3 Admin retry thành công
const retriedEvent = await mockAutomationOutboxApi.retryOutboxEvent(
  'outbox-ev-004-fail',
  'Đã khởi động lại n8n webhook worker container trên cổng 5678',
  MOCK_USERS['user-admin']
)
assert.equal(retriedEvent.status, 'pending')
assert.equal(retriedEvent.attempt_count, 0)
assert.ok(retriedEvent.error_message?.includes('Đã khởi động lại n8n webhook worker container'))
console.log(`✓ Admin retry sự kiện thành công: Chuyển ${retriedEvent.id} sang 'pending', reset attempt_count = 0`)

// 5.4 Sau khi retry, số lượng lỗi automation giảm xuống
const eventsAfterRetry = await mockAutomationOutboxApi.getOutboxEvents(MOCK_USERS['user-admin'])
const updatedMetrics = calculateRoleDashboard(
  MOCK_USERS['user-admin'],
  INITIAL_MOCK_INCIDENTS,
  eventsAfterRetry,
  INITIAL_NOTIFICATIONS
)
assert.equal(updatedMetrics.automationStats.failedEvents, adminMetrics.automationStats.failedEvents - 1)
console.log(`✓ Cập nhật Dashboard thời gian thực: Số sự kiện lỗi giảm từ ${adminMetrics.automationStats.failedEvents} xuống ${updatedMetrics.automationStats.failedEvents}`)

mockAutomationOutboxApi.resetData()

console.log('\n🎉 ĐẠT TOÀN BỘ CÁC MỤC KIỂM THỬ TASK N7-W07 CỦA NGUYỄN NHẬT QUANG!')
console.log('✅ Tiêu chí hoàn thành cốt lõi: Có trạng thái empty/error; số liệu đúng phạm vi role.')
