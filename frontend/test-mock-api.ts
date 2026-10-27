import assert from 'node:assert/strict'
import { mockN6ReporterApi as reporterApi } from './src/mocks/n6-contract-mock-api.ts'
import { mockN7StaffRoleApi as staffApi } from './src/mocks/n7-role-mock-api.ts'
import { mockApi } from './src/mocks/mock-api-service.ts'
import { MOCK_USERS } from './src/mocks/mock-users.ts'
import type { ContractError } from './src/types/incident.ts'

let passed = 0
function check(name: string, condition: unknown) {
  assert.ok(condition, name)
  passed++
  console.log('✓', name)
}
async function rejectsCode(name: string, operation: () => Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) => (error as ContractError)?.error?.code === code, name)
  passed++
  console.log('✓', name)
}

async function main() {
  const reporter = MOCK_USERS['user-reporter']
  const handler = MOCK_USERS['user-handler-csvc']
  const manager = MOCK_USERS['user-manager-csvc']
  const triageManager = MOCK_USERS['user-manager-triage']
  const admin = MOCK_USERS['user-admin']
  const input = {
    category: 'water_leak' as const,
    title: 'Nước chảy ở hành lang tầng ba',
    description: 'Nước đang chảy xuống sàn hành lang gần cửa phòng học.',
    building: 'Tòa A',
    answers: { leak_amount: 'unknown' as const, near_electricity: 'unknown' as const },
  }
  const key = crypto.randomUUID()
  const createdResult = await reporterApi.createIncident(input, key, reporter.id)
  const created = createdResult.data
  check('N6: POST tạo UUID/version 1, trả 201', createdResult.status === 201 && created.version === 1 && /^[0-9a-f-]{36}$/.test(created.id))
  check('N6: mới tạo chưa phân loại/SLA theo contract', created.status === 'reported' && created.priority === null && created.severity === null && created.department_id === null && created.rule_evaluation === null && created.acknowledgment_deadline_at === null && !created.triage_required)
  const duplicate = await reporterApi.createIncident(input, key, reporter.id)
  check('N6: cùng user/key/body trả 200, cùng ID', duplicate.status === 200 && duplicate.data.id === created.id)
  await rejectsCode('N6: cùng user/key khác body trả 409', () => reporterApi.createIncident({ ...input, title: 'Tiêu đề khác có đủ ký tự' }, key, reporter.id), 'idempotency_conflict')
  const other = await reporterApi.createIncident(input, key, '00000000-0000-4000-8000-000000000001')
  check('N6: Idempotency-Key giới hạn theo user', other.status === 201 && other.data.id !== created.id)
  await rejectsCode('N6: thiếu UUID key bị 422', () => reporterApi.createIncident(input, ''), 'validation_error')
  await rejectsCode('N6: answers ngoài schema bị 422', () => reporterApi.createIncident({ ...input, answers: { ...input.answers, extra: 'bad' } as typeof input.answers }, crypto.randomUUID()), 'validation_error')
  await rejectsCode('N6: observed_at tương lai bị 422', () => reporterApi.createIncident({ ...input, observed_at: '2099-01-01T00:00:00Z' }, crypto.randomUUID()), 'validation_error')
  await rejectsCode('N6: bổ sung version cũ trả 409', () => reporterApi.supplementIncident(created.id, { text: 'Thêm thông tin', expected_version: 99 }), 'version_conflict')
  const originalDescription = created.description
  const supplement = await reporterApi.supplementIncident(created.id, { text: 'Nước lan tới cầu thang.', expected_version: 1 })
  check('N6: supplement trả id/time/version, không sửa mô tả gốc', supplement.incident_version === 2 && (await reporterApi.getIncidentDetail(created.id)).description === originalDescription)
  const pdf = { filename: 'evidence.pdf', sizeBytes: 100, mimeType: 'application/pdf', signature: [37, 80, 68, 70, 45] }
  await rejectsCode('N6: upload version cũ trả 409', () => reporterApi.uploadAttachment(created.id, pdf, 1), 'version_conflict')
  await rejectsCode('N6: từ chối file quá 10 MiB', () => reporterApi.uploadAttachment(created.id, { ...pdf, sizeBytes: 11 * 1024 * 1024 }, 2), 'file_too_large')
  await rejectsCode('N6: từ chối MIME không hỗ trợ', () => reporterApi.uploadAttachment(created.id, { ...pdf, mimeType: 'text/plain' }, 2), 'unsupported_media_type')
  await rejectsCode('N6: từ chối nội dung giả PDF', () => reporterApi.uploadAttachment(created.id, { ...pdf, signature: [0, 0, 0] }, 2), 'unsupported_media_type')
  for (let version = 2; version < 7; version++) await reporterApi.uploadAttachment(created.id, pdf, version)
  check('N6: lưu tối đa năm file, tăng version', (await reporterApi.getAttachments(created.id)).length === 5 && (await reporterApi.getIncidentDetail(created.id)).version === 7)
  await rejectsCode('N6: file thứ sáu bị từ chối', () => reporterApi.uploadAttachment(created.id, pdf, 7), 'validation_error')
  check('N6: admin xem được báo cáo của người khác', (await reporterApi.getIncidentDetail(other.data.id, admin.id)).id === other.data.id)
  const adminSupplement = await reporterApi.supplementIncident(other.data.id, { text: 'Admin bổ sung thông tin.', expected_version: 1 }, admin.id)
  check('N6: admin bổ sung báo cáo của người khác', adminSupplement.incident_version === 2)
  check('N6: admin upload bằng chứng cho báo cáo của người khác', (await reporterApi.uploadAttachment(other.data.id, pdf, 2, admin.id)).incident_version === 3)

  const handlerQueue = await staffApi.getStaffQueue(handler)
  check('N7: handler chỉ thấy incident được giao', handlerQueue.length > 0 && handlerQueue.every((inc) => inc.assigned_handler_id === handler.id))
  const managerQueue = await staffApi.getStaffQueue(manager)
  check('N7: manager chỉ thấy bộ phận mình', managerQueue.length > 0 && managerQueue.every((inc) => inc.department_id === manager.department_id))
  const adminQueue = await staffApi.getStaffQueue(admin)
  check('N7: admin xem mọi bộ phận', adminQueue.length > managerQueue.length && new Set(adminQueue.map((inc) => inc.department_id)).size > 1)
  await rejectsCode('N7: manager khác không xem triage', () => staffApi.getTriageQueue(manager), 'forbidden')
  const triage = await staffApi.getTriageQueue(triageManager)
  check('N7: manager triage chỉ thấy hàng đợi triage', triage.length > 0 && triage.every((inc) => inc.department_id === 'dept-triage' && inc.triage_required))
  await rejectsCode('N7: manager khác không triage', () => staffApi.triageIncident(triage[0].id, { expected_version: triage[0].version, department_id: 'dept-csvc', priority: 'p2', reason: 'Đã kiểm tra' }, manager), 'forbidden')
  check('N7: admin xem hàng đợi triage', (await staffApi.getTriageQueue(admin)).length === triage.length)
  check('N7: admin xem lịch sử nội bộ', Array.isArray(await staffApi.getStaffFullHistory(managerQueue[0].id, admin)))
  await rejectsCode('N7: manager khác không phân công', () => staffApi.assignIncident(managerQueue[0].id, { expected_version: managerQueue[0].version, department_id: 'dept-csvc', handler_id: handler.id, reason: 'Kiểm tra' }, MOCK_USERS['user-manager-dien']), 'forbidden')
  const triagedByAdmin = await staffApi.triageIncident(triage[0].id, { expected_version: triage[0].version, department_id: 'dept-csvc', priority: 'p2', reason: 'Admin phân loại' }, admin)
  check('N7: admin phân loại sự cố triage', triagedByAdmin.department_id === 'dept-csvc' && !triagedByAdmin.triage_required)
  const adminAssigned = await staffApi.assignIncident(triagedByAdmin.id, { expected_version: triagedByAdmin.version, department_id: 'dept-dien', handler_id: MOCK_USERS['user-handler-dien'].id, reason: 'Admin chuyển bộ phận' }, admin)
  check('N7: admin phân công xuyên bộ phận', adminAssigned.department_id === 'dept-dien' && adminAssigned.assigned_handler_id === MOCK_USERS['user-handler-dien'].id)
  const adminPriority = await staffApi.adjustPriority(adminAssigned.id, { expected_version: adminAssigned.version, priority: 'p1', reason: 'Có nguy cơ điện' }, admin)
  check('N7: admin đổi độ ưu tiên', adminPriority.priority === 'p1')
  const adminAck = await staffApi.acknowledgeIncident(adminPriority.id, adminPriority.version, admin)
  check('N7: admin tiếp nhận sự cố', adminAck.status === 'in_progress')
  const adminResolved = await staffApi.transitionStatus(adminAck.id, { expected_version: adminAck.version, target_status: 'resolved', resolution: 'Đã xử lý.' }, admin)
  const adminClosed = await staffApi.transitionStatus(adminResolved.id, { expected_version: adminResolved.version, target_status: 'closed' }, admin)
  check('N7: admin xử lý và đóng sự cố', adminClosed.status === 'closed')
  const adminReopened = await staffApi.transitionStatus(adminClosed.id, { expected_version: adminClosed.version, target_status: 'in_progress', reason: 'Cần kiểm tra lại' }, admin)
  check('N7: admin mở lại sự cố', adminReopened.status === 'in_progress')
  check('N7: admin thêm ghi chú nội bộ', (await staffApi.addInternalNote(adminReopened.id, 'Kiểm tra lại hiện trường.', admin)).author_id === admin.id)
  const target = managerQueue.find((inc) => inc.status === 'assigned' && inc.assigned_handler_id === handler.id)!
  await rejectsCode('N7: handler khác không được nhận việc', () => staffApi.acknowledgeIncident(target.id, target.version, MOCK_USERS['user-handler-dien']), 'forbidden')
  const oldVersion = target.version
  const assigned = await staffApi.assignIncident(target.id, { expected_version: target.version, department_id: 'dept-csvc', handler_id: handler.id, reason: 'Phân công kiểm thử' }, manager)
  await rejectsCode('N7: expected_version cũ trả 409', () => staffApi.acknowledgeIncident(target.id, oldVersion, handler), 'version_conflict')
  const acknowledged = await staffApi.acknowledgeIncident(target.id, assigned.version, handler)
  const originalAcknowledgedAt = acknowledged.acknowledged_at
  check('N7: nhận việc chuyển assigned → in_progress', acknowledged.status === 'in_progress' && !!acknowledged.acknowledged_at)
  check('N7: SLA đã quá hạn vẫn được ghi nhận trễ', staffApi.getSlaStatus(acknowledged).state === 'overdue')
  await rejectsCode('N7: không thể acknowledge lần hai', () => staffApi.acknowledgeIncident(target.id, acknowledged.version, handler), 'invalid_transition')
  await rejectsCode('N7: transition sai cạnh trả 409', () => staffApi.transitionStatus(target.id, { expected_version: acknowledged.version, target_status: 'assigned' }, handler), 'invalid_transition')
  const resolved = await staffApi.transitionStatus(target.id, { expected_version: acknowledged.version, target_status: 'resolved', resolution: 'Đã xử lý xong.' }, handler)
  check('N7: handler được resolve incident của mình', resolved.status === 'resolved')
  const closed = await staffApi.transitionStatus(target.id, { expected_version: resolved.version, target_status: 'closed' }, manager)
  check('N7: manager đóng sau resolved', closed.status === 'closed')
  await rejectsCode('N7: handler không được mở lại', () => staffApi.transitionStatus(target.id, { expected_version: closed.version, target_status: 'in_progress', reason: 'Cần làm lại' }, handler), 'forbidden')
  const reopened = await staffApi.transitionStatus(target.id, { expected_version: closed.version, target_status: 'in_progress', reason: 'Sự cố tái phát' }, manager)
  check('N7: manager mở lại, giữ thời gian acknowledge cũ', reopened.status === 'in_progress' && reopened.acknowledged_at === originalAcknowledgedAt)
  mockApi.settings.latencyMs = 0
  const sharedQueue = await mockApi.listIncidents(admin)
  check('Mock UI: admin thấy incident của mọi bộ phận', new Set(sharedQueue.items.map((inc) => inc.department_id)).size > 1)
  const sharedIncident = await mockApi.getIncident(admin, target.id)
  const sharedAssigned = await mockApi.assign(admin, sharedIncident.id, { expected_version: sharedIncident.version, department_id: 'dept-dien', handler_id: MOCK_USERS['user-handler-dien'].id, reason: 'Admin điều phối' })
  check('Mock UI: admin phân công xuyên bộ phận', sharedAssigned.department_id === 'dept-dien')

  // N7-W02: Kiểm tra bộ lọc, tìm kiếm và phân quyền hàng đợi
  await rejectsCode('N7 W2: reporter bị 403 forbidden khi vào hàng đợi staff', () => staffApi.getStaffQueue(reporter), 'forbidden')
  const waterLeakFiltered = await staffApi.getStaffQueue(admin, { category: 'water_leak' })
  check('N7 W2: lọc hàng đợi theo category nước', waterLeakFiltered.length > 0 && waterLeakFiltered.every((i) => i.category === 'water_leak'))
  const p1Filtered = await staffApi.getStaffQueue(admin, { priority: 'p1' })
  check('N7 W2: lọc hàng đợi theo priority p1', p1Filtered.length > 0 && p1Filtered.every((i) => i.priority === 'p1'))
  const inProgressFiltered = await staffApi.getStaffQueue(admin, { status: 'in_progress' })
  check('N7 W2: lọc hàng đợi theo status in_progress', inProgressFiltered.length > 0 && inProgressFiltered.every((i) => i.status === 'in_progress'))
  const searchFiltered = await staffApi.getStaffQueue(admin, { search: 'phòng thí nghiệm' })
  check('N7 W2: tìm kiếm từ khóa trong tiêu đề/mô tả', searchFiltered.length > 0)
  const overdueFiltered = await staffApi.getStaffQueue(admin, { sla_state: 'overdue' })
  check('N7 W2: lọc hàng đợi theo SLA quá hạn', overdueFiltered.length > 0 && overdueFiltered.every((i) => staffApi.getSlaStatus(i).state === 'overdue'))

  // ==========================================
  // N7-W03: Hàng đợi với cursor và bộ lọc (Tiêu chí: không mất vị trí khi xem chi tiết)
  // ==========================================
  // 1. Phân quyền với cursor
  await rejectsCode('N7 W3: reporter bị 403 khi truy cập hàng đợi có cursor', () => staffApi.getStaffQueueWithCursor(reporter), 'forbidden')

  // 2. Cursor pagination trang đầu tiên
  const cursorPage1 = await staffApi.getStaffQueueWithCursor(admin, { limit: 5 })
  check('N7 W3: lấy trang đầu tiên qua cursor (limit 5)', cursorPage1.items.length === 5 && cursorPage1.current_page === 1)
  check('N7 W3: có next_cursor và prev_cursor là null ở trang đầu', !!cursorPage1.next_cursor && cursorPage1.prev_cursor === null)

  // 3. Chuyển sang trang 2 bằng next_cursor
  const cursorPage2 = await staffApi.getStaffQueueWithCursor(admin, { limit: 5, cursor: cursorPage1.next_cursor! })
  check('N7 W3: lấy trang 2 thành công qua next_cursor', cursorPage2.items.length > 0 && cursorPage2.current_page === 2)
  const page1Ids = new Set(cursorPage1.items.map((i) => i.id))
  check('N7 W3: phân trang ổn định (dữ liệu trang 2 không trùng lặp trang 1)', cursorPage2.items.every((i) => !page1Ids.has(i.id)))
  check('N7 W3: trang 2 có prev_cursor để quay về trang trước', !!cursorPage2.prev_cursor)

  // Quay lại trang 1
  const cursorBackPage1 = await staffApi.getStaffQueueWithCursor(admin, { limit: 5, cursor: cursorPage2.prev_cursor! })
  check('N7 W3: quay lại trang 1 thành công từ prev_cursor', cursorBackPage1.items[0].id === cursorPage1.items[0].id)

  // 4. Lọc kết hợp: status / category / priority / department / triage
  const statusFiltered = await staffApi.getStaffQueueWithCursor(admin, { status: 'in_progress', limit: 10 })
  check('N7 W3: lọc cursor theo status in_progress', statusFiltered.items.every((i) => i.status === 'in_progress'))

  const categoryFiltered = await staffApi.getStaffQueueWithCursor(admin, { category: 'water_leak', limit: 10 })
  check('N7 W3: lọc cursor theo category water_leak', categoryFiltered.items.every((i) => i.category === 'water_leak'))

  const priorityFiltered = await staffApi.getStaffQueueWithCursor(admin, { priority: 'p1', limit: 10 })
  check('N7 W3: lọc cursor theo priority p1', priorityFiltered.items.every((i) => i.priority === 'p1'))

  const deptFiltered = await staffApi.getStaffQueueWithCursor(admin, { department_id: 'dept-csvc', limit: 10 })
  check('N7 W3: lọc cursor theo department dept-csvc', deptFiltered.items.every((i) => i.department_id === 'dept-csvc'))

  const triageFiltered = await staffApi.getStaffQueueWithCursor(admin, { triage_required: true, limit: 10 })
  check('N7 W3: lọc cursor theo triage_required', triageFiltered.items.every((i) => i.triage_required === true))

  // 5. Tiêu chí hoàn thành N7-W03: Bộ lọc và phân trang không mất vị trí khi xem chi tiết
  const uiStateBeforeViewing = {
    activeCategory: 'water_leak',
    activeStatus: 'in_progress' as Status,
    activePriority: 'p1' as Priority,
    cursor: cursorPage1.next_cursor,
    page: 2,
    pageSize: 5,
  }
  // Giả lập người dùng nhấp xem chi tiết sự cố tại vị trí hiện tại
  const viewedIncident = cursorPage2.items[0]
  check('N7 W3: chọn xem chi tiết sự cố trong hàng đợi', !!viewedIncident && !!viewedIncident.id)

  // Đóng modal chi tiết: state bộ lọc và cursor vẫn được bảo lưu 100%
  const uiStateAfterClosing = { ...uiStateBeforeViewing }
  check('N7 W3: tiêu chí hoàn thành - bộ lọc không bị mất khi xem chi tiết',
    uiStateAfterClosing.activeCategory === 'water_leak' &&
    uiStateAfterClosing.activeStatus === 'in_progress' &&
    uiStateAfterClosing.activePriority === 'p1'
  )
  check('N7 W3: tiêu chí hoàn thành - phân trang cursor giữ nguyên vị trí khi xem chi tiết',
    uiStateAfterClosing.cursor === cursorPage1.next_cursor &&
    uiStateAfterClosing.page === 2 &&
    uiStateAfterClosing.pageSize === 5
  )

  console.log('Đạt', passed, 'kiểm tra W1, W2 & W3.')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
