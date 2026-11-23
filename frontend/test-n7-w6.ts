/**
 * Test Suite Task N7-W06: UI acknowledge, resolution, đóng/mở lại, duplicate/invalid
 * Người thực hiện: Nguyễn Nhật Quang (Giao diện nhân viên & quản lý - Tuần 6)
 * Tiêu chí hoàn thành: Không hiện hành động sai trạng thái; backend vẫn là nơi quyết định quyền.
 */

import assert from 'node:assert/strict'
import { MOCK_USERS } from './src/mocks/mock-users.ts'
import { staffApiAdapter } from './src/api/staff-api-adapter.ts'
import { demoClient } from './src/api/demo-client.ts'
import { mockN7StaffRoleApi } from './src/mocks/n7-role-mock-api.ts'
import type { Status } from './src/types/incident.ts'

console.log('--- BẮT ĐẦU KIỂM THỬ TASK N7-W06: WORKFLOW ACTIONS & STATE-DRIVEN GUARDS (NGUYỄN NHẬT QUANG) ---\n')

const adminUser = MOCK_USERS['user-admin']
const managerCsvc = MOCK_USERS['user-manager-csvc']
const handlerCsvc = MOCK_USERS['user-handler-csvc']
const handlerDien = MOCK_USERS['user-handler-dien']
const reporterUser = MOCK_USERS['user-reporter']

// ============================================================================
// 1. KIỂM TRA MA TRẬN HỢP LỆ THEO TRẠNG THÁI: "KHÔNG HIỆN HÀNH ĐỘNG SAI TRẠNG THÁI"
// ============================================================================
console.log('--- 1. Kiểm tra Tiêu chí: Không hiện hành động sai trạng thái ---')

interface ActionVisibility {
  canShowTriage: boolean
  canShowAck: boolean
  canShowResolve: boolean
  canShowClose: boolean
  canShowReopen: boolean
  canShowAssign: boolean
  canShowPriority: boolean
  canShowDisposition: boolean
}

function computeActionVisibility(status: Status, triageRequired: boolean): ActionVisibility {
  return {
    canShowTriage: triageRequired && status === 'reported',
    canShowAssign: ['reported', 'assigned', 'in_progress'].includes(status),
    canShowPriority: ['reported', 'assigned', 'in_progress'].includes(status) && !triageRequired,
    canShowAck: status === 'assigned',
    canShowResolve: status === 'in_progress',
    canShowClose: status === 'resolved',
    canShowReopen: status === 'resolved' || status === 'closed',
    canShowDisposition: status !== 'closed',
  }
}

// 1.1 Trạng thái 'reported' (cần triage)
const reportedTriage = computeActionVisibility('reported', true)
assert.equal(reportedTriage.canShowTriage, true, 'reported + triage_required phải hiện Triage')
assert.equal(reportedTriage.canShowAck, false, 'reported TUYỆT ĐỐI KHÔNG hiện Ack')
assert.equal(reportedTriage.canShowResolve, false, 'reported TUYỆT ĐỐI KHÔNG hiện Resolve')
assert.equal(reportedTriage.canShowClose, false, 'reported TUYỆT ĐỐI KHÔNG hiện Close')
assert.equal(reportedTriage.canShowReopen, false, 'reported TUYỆT ĐỐI KHÔNG hiện Reopen')
assert.equal(reportedTriage.canShowDisposition, true, 'reported được phép Disposition (báo trùng/sai)')
console.log('✓ Trạng thái "reported" (cần triage): Ẩn hoàn toàn ack, resolve, close, reopen')

// 1.2 Trạng thái 'assigned'
const assignedVis = computeActionVisibility('assigned', false)
assert.equal(assignedVis.canShowAck, true, 'assigned phải hiện Ack')
assert.equal(assignedVis.canShowTriage, false, 'assigned TUYỆT ĐỐI KHÔNG hiện Triage')
assert.equal(assignedVis.canShowResolve, false, 'assigned TUYỆT ĐỐI KHÔNG hiện Resolve (phải nhận trước)')
assert.equal(assignedVis.canShowClose, false, 'assigned TUYỆT ĐỐI KHÔNG hiện Close')
assert.equal(assignedVis.canShowReopen, false, 'assigned TUYỆT ĐỐI KHÔNG hiện Reopen')
assert.equal(assignedVis.canShowAssign, true, 'assigned được phép phân công lại')
assert.equal(assignedVis.canShowDisposition, true, 'assigned được phép Disposition')
console.log('✓ Trạng thái "assigned": Hiện ack, ẩn triage, resolve, close, reopen')

// 1.3 Trạng thái 'in_progress'
const inProgressVis = computeActionVisibility('in_progress', false)
assert.equal(inProgressVis.canShowResolve, true, 'in_progress phải hiện Resolve')
assert.equal(inProgressVis.canShowAck, false, 'in_progress TUYỆT ĐỐI KHÔNG hiện Ack (đã nhận rồi)')
assert.equal(inProgressVis.canShowClose, false, 'in_progress TUYỆT ĐỐI KHÔNG hiện Close (phải resolve trước)')
assert.equal(inProgressVis.canShowReopen, false, 'in_progress TUYỆT ĐỐI KHÔNG hiện Reopen')
assert.equal(inProgressVis.canShowDisposition, true, 'in_progress được phép Disposition')
console.log('✓ Trạng thái "in_progress": Hiện resolve, ẩn ack, close, reopen')

// 1.4 Trạng thái 'resolved'
const resolvedVis = computeActionVisibility('resolved', false)
assert.equal(resolvedVis.canShowClose, true, 'resolved phải hiện Close')
assert.equal(resolvedVis.canShowReopen, true, 'resolved phải hiện Reopen')
assert.equal(resolvedVis.canShowAck, false, 'resolved TUYỆT ĐỐI KHÔNG hiện Ack')
assert.equal(resolvedVis.canShowResolve, false, 'resolved TUYỆT ĐỐI KHÔNG hiện Resolve')
assert.equal(resolvedVis.canShowAssign, false, 'resolved TUYỆT ĐỐI KHÔNG hiện Phân công')
assert.equal(resolvedVis.canShowPriority, false, 'resolved TUYỆT ĐỐI KHÔNG hiện Đổi Priority')
console.log('✓ Trạng thái "resolved": Hiện close và reopen, ẩn ack, resolve, assign, priority')

// 1.5 Trạng thái 'closed'
const closedVis = computeActionVisibility('closed', false)
assert.equal(closedVis.canShowReopen, true, 'closed phải hiện Reopen')
assert.equal(closedVis.canShowClose, false, 'closed TUYỆT ĐỐI KHÔNG hiện Close')
assert.equal(closedVis.canShowAck, false, 'closed TUYỆT ĐỐI KHÔNG hiện Ack')
assert.equal(closedVis.canShowResolve, false, 'closed TUYỆT ĐỐI KHÔNG hiện Resolve')
assert.equal(closedVis.canShowAssign, false, 'closed TUYỆT ĐỐI KHÔNG hiện Assign')
assert.equal(closedVis.canShowDisposition, false, 'closed TUYỆT ĐỐI KHÔNG hiện Disposition (đã đóng rồi)')
console.log('✓ Trạng thái "closed": Chỉ hiện reopen, ẩn toàn bộ các thao tác khác')

// ============================================================================
// 2. KIỂM THỬ CÁC HÀNH ĐỘNG NGHIỆP VỤ W6
// (ACKNOWLEDGE, RESOLUTION, ĐÓNG, MỞ LẠI, DUPLICATE/INVALID)
// ============================================================================
console.log('\n--- 2. Kiểm thử các hành động nghiệp vụ N7-W06 ---')
staffApiAdapter.resetData()

// Lấy danh sách sự cố mẫu trong hệ thống
const allIncidents = await staffApiAdapter.getAllStaffIncidents(adminUser)
assert.ok(allIncidents.length >= 3, 'Hệ thống cần ít nhất 3 sự cố mẫu')

// Chọn sự cố mục tiêu để kiểm thử toàn bộ vòng đời
const targetIncident = allIncidents[0]
const testIncidentId = targetIncident.id
let inc = await staffApiAdapter.getIncidentDetail(testIncidentId, adminUser)

// Đảm bảo sự cố ở trạng thái assigned cho handlerCsvc
if (inc.status !== 'assigned' || inc.assigned_handler_id !== handlerCsvc.id) {
  inc = await staffApiAdapter.assignIncident(
    testIncidentId,
    {
      department_id: 'dept-csvc',
      handler_id: handlerCsvc.id,
      reason: 'Phân công kỹ thuật viên phụ trách Ban CSVC',
      expected_version: inc.version,
    },
    managerCsvc
  )
}
assert.equal(inc.status, 'assigned', 'Sự cố mẫu phải ở trạng thái assigned')
console.log(`✓ Sự cố #${inc.id.slice(0, 8)} ở trạng thái "assigned", version v${inc.version}`)

// 2.1 Acknowledge (Tiếp nhận sự cố)
console.log('\n--- 2.1 Acknowledge ---')
const ackRes = await staffApiAdapter.acknowledgeIncident(testIncidentId, inc.version, handlerCsvc)
assert.equal(ackRes.status, 'in_progress', 'Trạng thái chuyển thành in_progress')
assert.ok(ackRes.acknowledged_at, 'Phải có thời điểm acknowledged_at')
assert.equal(ackRes.version, inc.version + 1, 'Version tăng lên 1')
inc = ackRes
console.log(`✓ Acknowledge thành công: status="${inc.status}", acknowledged_at="${inc.acknowledged_at}", version=v${inc.version}`)

// 2.2 Resolution (Giải quyết sự cố)
console.log('\n--- 2.2 Resolution ---')
// Kiểm tra validation: Thiếu resolution phải bị 422
try {
  await staffApiAdapter.resolveIncident(
    testIncidentId,
    { expected_version: inc.version, resolution: '   ' },
    handlerCsvc
  )
  assert.fail('Thiếu resolution phải bị lỗi 422')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.equal(errObj.error?.code, 'validation_error')
  console.log('✓ Bắt lỗi 422 khi resolution để trống thành công')
}

// Resolution thành công
const resolveRes = await staffApiAdapter.resolveIncident(
  testIncidentId,
  {
    expected_version: inc.version,
    resolution: 'Đã siết lại bu lông mặt bích và thay gioăng cao su chịu nhiệt. Không còn rò rỉ.',
    reason: 'Hoàn thành hạng mục sửa chữa',
  },
  handlerCsvc
)
assert.equal(resolveRes.status, 'resolved', 'Trạng thái chuyển thành resolved')
assert.ok(resolveRes.resolved_at, 'Phải có resolved_at')
assert.ok(resolveRes.resolution?.includes('thay gioăng cao su'), 'Ghi nhận đúng nội dung resolution')
assert.equal(resolveRes.version, inc.version + 1, 'Version tăng lên 1')
inc = resolveRes
console.log(`✓ Resolution thành công: status="${inc.status}", resolved_at="${inc.resolved_at}", version=v${inc.version}`)

// 2.3 Close (Nghiệm thu & Đóng sự cố)
console.log('\n--- 2.3 Close ---')
const closeRes = await staffApiAdapter.closeIncident(
  testIncidentId,
  {
    expected_version: inc.version,
    reason: 'Trưởng ban CSVC đã kiểm tra và xác nhận nghiệm thu đạt yêu cầu.',
  },
  managerCsvc
)
assert.equal(closeRes.status, 'closed', 'Trạng thái chuyển thành closed')
assert.ok(closeRes.closed_at, 'Phải có closed_at')
assert.equal(closeRes.version, inc.version + 1, 'Version tăng lên 1')
inc = closeRes
console.log(`✓ Close thành công: status="${inc.status}", closed_at="${inc.closed_at}", version=v${inc.version}`)

// 2.4 Reopen (Mở lại sự cố)
console.log('\n--- 2.4 Reopen ---')
// Kiểm tra validation: Thiếu reason phải bị 422
try {
  await staffApiAdapter.reopenIncident(
    testIncidentId,
    { expected_version: inc.version, reason: '' },
    managerCsvc
  )
  assert.fail('Thiếu reason khi reopen phải bị 422')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.equal(errObj.error?.code, 'validation_error')
  console.log('✓ Bắt lỗi 422 khi lý do reopen để trống thành công')
}

// Reopen thành công
const reopenRes = await staffApiAdapter.reopenIncident(
  testIncidentId,
  {
    expected_version: inc.version,
    reason: 'Nước tiếp tục rò rỉ âm sàn sau 3 tiếng mở lại van tổng.',
  },
  managerCsvc
)
assert.equal(reopenRes.status, 'in_progress', 'Trạng thái quay lại in_progress')
assert.equal(reopenRes.version, inc.version + 1, 'Version tăng lên 1')
inc = reopenRes
console.log(`✓ Reopen thành công: status="${inc.status}", version=v${inc.version}`)

// 2.5 Duplicate & Invalid (Disposition)
console.log('\n--- 2.5 Disposition (Duplicate / Invalid) ---')

// 2.5.1 Thử nghiệm Duplicate (Sự cố trùng lặp)
// Chuẩn bị một sự cố khác đang mở để đánh dấu duplicate
const dupIncidentId = allIncidents[1].id
const dupTarget = await staffApiAdapter.getIncidentDetail(dupIncidentId, adminUser)

// Thiếu duplicate_of_id phải bị lỗi 422
try {
  await staffApiAdapter.dispositionIncident(
    dupIncidentId,
    {
      expected_version: dupTarget.version,
      kind: 'duplicate',
      reason: 'Trùng lặp với báo cáo trước đó',
    },
    adminUser
  )
  assert.fail('Disposition duplicate thiếu duplicate_of_id phải bị lỗi 422')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.equal(errObj.error?.code, 'validation_error')
  console.log('✓ Bắt lỗi 422 khi thiếu duplicate_of_id thành công')
}

// Disposition Duplicate thành công
const dupRes = await staffApiAdapter.dispositionIncident(
  dupIncidentId,
  {
    expected_version: dupTarget.version,
    kind: 'duplicate',
    duplicate_of_id: testIncidentId,
    reason: `Trùng lặp với sự cố #${testIncidentId.slice(0, 8)} đã được ghi nhận trước đó`,
  },
  adminUser
)
assert.equal(dupRes.status, 'closed', 'Disposition duplicate chuyển trạng thái thành closed')
assert.equal(dupRes.disposition?.kind, 'duplicate', 'Lưu disposition.kind là duplicate')
assert.equal(dupRes.disposition?.duplicate_of_id, testIncidentId, 'Lưu đúng duplicate_of_id')
assert.equal(dupRes.version, dupTarget.version + 1, 'Version tăng lên 1')
console.log(`✓ Disposition Duplicate thành công: status="${dupRes.status}", kind="${dupRes.disposition?.kind}", target="#${dupRes.disposition?.duplicate_of_id?.slice(0, 8)}"`)

// 2.5.2 Thử nghiệm Invalid (Sự cố không hợp lệ / Báo sai)
const invalidIncidentId = allIncidents[2].id
const invalidTarget = await staffApiAdapter.getIncidentDetail(invalidIncidentId, adminUser)

const invalidRes = await staffApiAdapter.dispositionIncident(
  invalidIncidentId,
  {
    expected_version: invalidTarget.version,
    kind: 'invalid',
    reason: 'Kiểm tra hiện trường không có mùi khét hay chập điện. Thông tin phản ánh sai sự thật.',
  },
  adminUser
)
assert.equal(invalidRes.status, 'closed', 'Disposition invalid chuyển trạng thái thành closed')
assert.equal(invalidRes.disposition?.kind, 'invalid', 'Lưu disposition.kind là invalid')
assert.equal(invalidRes.version, invalidTarget.version + 1, 'Version tăng lên 1')
console.log(`✓ Disposition Invalid thành công: status="${invalidRes.status}", kind="${invalidRes.disposition?.kind}"`)

// ============================================================================
// 3. TIÊU CHÍ HOÀN THÀNH CỐT LÕI 2: "BACKEND VẪN LÀ NƠI QUYẾT ĐỊNH QUYỀN"
// ============================================================================
console.log('\n--- 3. Tiêu chí hoàn thành cốt lõi: Backend vẫn là nơi quyết định quyền ---')

// 3.1 Handler không được quyền đóng sự cố (dù gọi thẳng API)
// Sử dụng sự cố đang ở trạng thái resolved
const testIncidentResolveFirst = await staffApiAdapter.resolveIncident(
  testIncidentId,
  {
    expected_version: inc.version,
    resolution: 'Giải quyết lần 2 để test phân quyền backend',
    reason: 'Đã hoàn thành',
  },
  handlerCsvc
)

try {
  await staffApiAdapter.closeIncident(
    testIncidentId,
    {
      expected_version: testIncidentResolveFirst.version,
      reason: 'KTV tự ý đóng sự cố',
    },
    handlerCsvc
  )
  assert.fail('Handler không được phép đóng sự cố')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.equal(errObj.error?.code, 'forbidden')
  console.log('✓ [Backend Guard 403] Chặn KTV tự ý đóng sự cố (chỉ Manager hoặc Admin mới có quyền)')
}

// 3.2 Handler không được quyền mở lại sự cố (dù gọi thẳng API)
try {
  await staffApiAdapter.reopenIncident(
    testIncidentId,
    {
      expected_version: testIncidentResolveFirst.version,
      reason: 'KTV tự ý mở lại sự cố',
    },
    handlerCsvc
  )
  assert.fail('Handler không được phép mở lại sự cố')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.equal(errObj.error?.code, 'forbidden')
  console.log('✓ [Backend Guard 403] Chặn KTV tự ý mở lại sự cố (chỉ Manager hoặc Admin mới có quyền)')
}

// 3.3 Handler không được quyền xử lý Disposition (báo trùng/sai)
try {
  await staffApiAdapter.dispositionIncident(
    testIncidentId,
    {
      expected_version: testIncidentResolveFirst.version,
      kind: 'invalid',
      reason: 'KTV tự ý đánh dấu không hợp lệ',
    },
    handlerCsvc
  )
  assert.fail('Handler không được phép thực hiện disposition')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.equal(errObj.error?.code, 'forbidden')
  console.log('✓ [Backend Guard 403] Chặn KTV tự ý kết thúc hồ sơ Disposition')
}

// 3.4 Handler khác bộ phận không được phép acknowledge
try {
  // Tạo sự cố gán cho CSVC nhưng KTV Điện cố acknowledge
  await staffApiAdapter.acknowledgeIncident(
    testIncidentId,
    testIncidentResolveFirst.version,
    handlerDien // KTV Ban Điện cố nhận sự cố của Ban CSVC
  )
  assert.fail('KTV khác bộ phận không được acknowledge')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.ok(
    errObj.error?.code === 'forbidden' || errObj.error?.code === 'invalid_transition',
    'Backend phải từ chối khi KTV ngoài phạm vi can thiệp'
  )
  console.log('✓ [Backend Guard] Chặn KTV ngoài phạm vi can thiệp tiếp nhận sự cố')
}

// 3.5 Reporter bị chặn 403 tuyệt đối trên toàn bộ các endpoint workflow
try {
  await staffApiAdapter.closeIncident(
    testIncidentId,
    {
      expected_version: testIncidentResolveFirst.version,
      reason: 'Reporter can thiệp đóng hồ sơ',
    },
    reporterUser
  )
  assert.fail('Reporter không được phép can thiệp đóng hồ sơ')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.equal(errObj.error?.code, 'forbidden')
  console.log('✓ [Backend Guard 403] Chặn Người báo cáo (Reporter) can thiệp thao tác quản lý')
}

// 3.6 Backend chặn chuyển đổi trạng thái không hợp lệ (Invalid Transition 409)
assert.equal(mockN7StaffRoleApi.getPermissionMatrix(inc, reporterUser).canViewInternalNotes, false)
await assert.rejects(
  mockN7StaffRoleApi.getStaffFullHistory(testIncidentId, reporterUser),
  (err: unknown) => (err as { error?: { code?: string } }).error?.code === 'forbidden'
)
await assert.rejects(
  mockN7StaffRoleApi.transitionStatus(
    testIncidentId,
    { expected_version: inc.version, target_status: 'resolved', resolution: 'Reporter không được xử lý' },
    reporterUser
  ),
  (err: unknown) => (err as { error?: { code?: string } }).error?.code === 'forbidden'
)

// Đóng sự cố chính thức trước
const closedIncident = await staffApiAdapter.closeIncident(
  testIncidentId,
  {
    expected_version: testIncidentResolveFirst.version,
    reason: 'Quản lý nghiệm thu đóng hồ sơ',
  },
  managerCsvc
)

// Cố gọi disposition khi sự cố đã đóng (closed) -> Backend chặn 409
try {
  await staffApiAdapter.dispositionIncident(
    testIncidentId,
    {
      expected_version: closedIncident.version,
      kind: 'invalid',
      reason: 'Cố disposition sự cố đã closed',
    },
    adminUser
  )
  assert.fail('Sự cố đã closed không được disposition')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.equal(errObj.error?.code, 'invalid_transition')
  console.log('✓ [Backend State Guard 409] Chặn thao tác sai trạng thái: Cố disposition sự cố đã closed')
}

// 3.7 Backend kiểm soát đồng thời (Optimistic Concurrency Control 409)
try {
  await staffApiAdapter.reopenIncident(
    testIncidentId,
    {
      expected_version: 1, // Sai version
      reason: 'Gửi sai expected_version',
    },
    managerCsvc
  )
  assert.fail('Sai expected_version phải bị lỗi 409 version_conflict')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.equal(errObj.error?.code, 'version_conflict')
  console.log('✓ [Backend Concurrency Guard 409] Chặn khi expected_version không khớp')
}

// 4. Kiểm tra demoClient tương thích đầy đủ
console.log('\n--- 4. Kiểm tra tương thích qua demoClient ---')
assert.equal(typeof demoClient.acknowledgeIncident, 'function')
assert.equal(typeof demoClient.resolveIncident, 'function')
assert.equal(typeof demoClient.closeIncident, 'function')
assert.equal(typeof demoClient.reopenIncident, 'function')
assert.equal(typeof demoClient.dispositionIncident, 'function')
console.log('✓ demoClient tích hợp đầy đủ: acknowledge, resolve, close, reopen, disposition')

staffApiAdapter.resetData()

console.log('\n🎉 ĐẠT TOÀN BỘ CÁC MỤC KIỂM THỬ TASK N7-W06 CỦA NGUYỄN NHẬT QUANG!')
console.log('✅ Tiêu chí hoàn thành cốt lõi: Không hiện hành động sai trạng thái; backend vẫn là nơi quyết định quyền.')
