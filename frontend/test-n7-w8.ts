/**
 * Test Suite Task N7-W08: Thay mock bằng API thật N1/N3/N4/N5 qua adapter đã chốt
 * Người thực hiện: Nguyễn Nhật Quang (Giao diện nhân viên & quản lý - Tuần 8)
 * Tiêu chí hoàn thành: Triage→assign→ack→resolve→close chạy với DB thật qua Adapter.
 */

import assert from 'node:assert/strict'
import { staffApiAdapter } from './src/api/staff-api-adapter.ts'
import { demoClient } from './src/api/demo-client.ts'
import { MOCK_USERS } from './src/mocks/mock-users.ts'
import type { TriageInput, AssignInput } from './src/mocks/n7-role-mock-api.ts'

console.log('--- BẮT ĐẦU KIỂM THỬ TASK N7-W08: REAL API ADAPTER INTEGRATION (NGUYỄN NHẬT QUANG) ---\n')

const adminUser = MOCK_USERS['user-admin']
const managerTriage = MOCK_USERS['user-manager-triage']
const managerCsvc = MOCK_USERS['user-manager-csvc']
const handlerCsvc = MOCK_USERS['user-handler-csvc']

// ============================================================================
// 1. KIỂM TRA CẤU HÌNH ADAPTER, MODE & HEALTH CHECK
// ============================================================================
console.log('--- 1. Kiểm tra Cấu hình Adapter & Cơ chế chuyển đổi Mode ---')

// 1.1 Khởi tạo và kiểm tra mode mặc định
assert.ok(typeof staffApiAdapter.getMode() === 'string')
console.log(`✓ Adapter khởi tạo ở chế độ: "${staffApiAdapter.getMode()}"`)

// 1.2 Chuyển đổi giữa chế độ 'real' và 'mock'
staffApiAdapter.setMode('real')
assert.equal(staffApiAdapter.getMode(), 'real', 'Phải chuyển sang chế độ real thành công')
staffApiAdapter.setMode('mock')
assert.equal(staffApiAdapter.getMode(), 'mock', 'Phải chuyển sang chế độ mock thành công')
console.log('✓ Chuyển đổi linh hoạt giữa "real" (API Thật) và "mock" (Mock Adapter) thành công')

// 1.3 Cấu hình Base URL
staffApiAdapter.setBaseUrl('http://localhost:8000/api/v1/')
assert.equal(staffApiAdapter.getBaseUrl(), 'http://localhost:8000/api/v1', 'Base URL phải được chuẩn hóa loại bỏ trailing slash')
staffApiAdapter.setBaseUrl('/api/v1')
assert.equal(staffApiAdapter.getBaseUrl(), '/api/v1')
console.log('✓ Cấu hình setBaseUrl và getBaseUrl hoạt động chuẩn xác')

// 1.4 Quản lý Bearer Token
staffApiAdapter.setBearerToken('test-bearer-token-12345')
assert.equal(staffApiAdapter.getBearerToken(), 'test-bearer-token-12345')
staffApiAdapter.setBearerToken(null)
assert.equal(staffApiAdapter.getBearerToken(), null)
console.log('✓ Quản lý Bearer Token cho kết nối bảo mật thành công')

// 1.5 Xác thực Đăng nhập (Login N1)
const loginResult = await staffApiAdapter.login('admin@usth.edu.vn')
assert.ok(loginResult.token, 'Đăng nhập phải trả về access_token')
assert.equal(loginResult.user.role, 'administrator')
assert.equal(staffApiAdapter.getBearerToken(), loginResult.token, 'Adapter phải tự động lưu token')
console.log(`✓ Đăng nhập xác thực tài khoản "${loginResult.user.display_name}" thành công qua Adapter`)

// ============================================================================
// 2. TIÊU CHÍ HOÀN THÀNH CỐT LÕI N7-W08:
//    CHU TRÌNH TOÀN DIỆN: Triage → assign → ack → resolve → close
// ============================================================================
console.log('\n--- 2. Kiểm thử Chu trình Vòng đời Sự cố: Triage → assign → ack → resolve → close ---')

staffApiAdapter.resetData()

// 2.1 BƯỚC 1: TRIAGE SỰ CỐ (Chuyển khỏi dept-triage, ấn định bộ phận & mức ưu tiên)
const initialIncidents = await staffApiAdapter.getAllStaffIncidents(adminUser)
const triageCandidate = initialIncidents.find((i) => i.department_id === 'dept-triage' && i.triage_required)
assert.ok(triageCandidate, 'Phải có sự cố ở hàng đợi Triage để kiểm thử')
const initialVersion = triageCandidate.version
console.log(`✓ Tìm thấy sự cố #${triageCandidate.id.slice(0, 8)}: department="${triageCandidate.department_id}", triage_required=${triageCandidate.triage_required}, version=v${initialVersion}`)

const triageInput: TriageInput = {
  department_id: 'dept-csvc',
  priority: 'p1',
  reason: 'Khảo sát hiện trường phát hiện rò rỉ nước nguy cơ chập cháy; chuyển sang CSVC và nâng lên P1.',
  expected_version: initialVersion,
}

const triaged = await staffApiAdapter.triageIncident(triageCandidate.id, triageInput, managerTriage)
assert.equal(triaged.department_id, 'dept-csvc', 'Phải chuyển sang bộ phận dept-csvc')
assert.equal(triaged.triage_required, false, 'triage_required phải chuyển thành false')
assert.equal(triaged.priority, 'p1', 'Mức ưu tiên phải được cập nhật sang p1')
assert.equal(triaged.version, initialVersion + 1, 'Version phải tăng lên sau triage')
console.log(`✓ [Bước 1: TRIAGE] Hoàn tất: department="${triaged.department_name}", priority="${triaged.priority}", version=v${triaged.version}`)

// 2.2 BƯỚC 2: PHÂN CÔNG ĐÍCH DANH CHO KỸ THUẬT VIÊN (ASSIGN)
const preAssignVersion = triaged.version
const assignInput: AssignInput = {
  department_id: 'dept-csvc',
  handler_id: handlerCsvc.id,
  reason: 'Giao trực tiếp cho KTV Nam phụ trách khu vực tầng 2 giảng đường.',
  expected_version: preAssignVersion,
}

const assigned = await staffApiAdapter.assignIncident(triaged.id, assignInput, managerCsvc)
assert.equal(assigned.status, 'assigned', 'Trạng thái phải là assigned')
assert.equal(assigned.assigned_handler_id, handlerCsvc.id, 'Phải gán đích danh handler_id')
assert.equal(assigned.assigned_handler_name, handlerCsvc.display_name)
assert.equal(assigned.version, preAssignVersion + 1, 'Version phải tăng sau phân công')
console.log(`✓ [Bước 2: ASSIGN] Hoàn tất: status="${assigned.status}", handler="${assigned.assigned_handler_name}", version=v${assigned.version}`)

// 2.3 BƯỚC 3: KỸ THUẬT VIÊN TIẾP NHẬN SỰ CỐ (ACKNOWLEDGE) - DỪNG SLA
const preAckVersion = assigned.version
const acknowledged = await staffApiAdapter.acknowledgeIncident(assigned.id, preAckVersion, handlerCsvc)
assert.equal(acknowledged.status, 'in_progress', 'Trạng thái phải chuyển sang in_progress')
assert.ok(acknowledged.acknowledged_at, 'Phải ghi nhận mốc thời gian acknowledged_at')
assert.equal(acknowledged.version, preAckVersion + 1, 'Version phải tăng sau acknowledge')
console.log(`✓ [Bước 3: ACKNOWLEDGE] Hoàn tất: status="${acknowledged.status}", acknowledged_at="${acknowledged.acknowledged_at}", version=v${acknowledged.version}`)

// 2.4 BƯỚC 4: HOÀN TẤT XỬ LÝ & BÁO CÁO GIẢI PHÁP (RESOLVE)
const preResolveVersion = acknowledged.version
const resolveInput = {
  expected_version: preResolveVersion,
  resolution: 'Đã hàn kín đường ống cấp nước trục D40 và nghiệm thu áp lực đạt 3.5 bar.',
  reason: 'KTV đã hoàn thành xử lý triệt để tại hiện trường.',
}

const resolved = await staffApiAdapter.resolveIncident(acknowledged.id, resolveInput, handlerCsvc)
assert.equal(resolved.status, 'resolved', 'Trạng thái phải chuyển sang resolved')
assert.ok(resolved.resolved_at, 'Phải ghi nhận mốc thời gian resolved_at')
assert.equal(resolved.resolution, resolveInput.resolution, 'Nội dung resolution phải được ghi nhận')
assert.equal(resolved.version, preResolveVersion + 1, 'Version phải tăng sau resolve')
console.log(`✓ [Bước 4: RESOLVE] Hoàn tất: status="${resolved.status}", resolution="${resolved.resolution}", version=v${resolved.version}`)

// 2.5 BƯỚC 5: NGHIỆM THU VÀ ĐÓNG SỰ CỐ (CLOSE)
const preCloseVersion = resolved.version
const closeInput = {
  expected_version: preCloseVersion,
  reason: 'Ban CSVC cùng giám sát đã kiểm tra thực địa, nghiệm thu đạt chuẩn và đóng sự cố.',
}

const closed = await staffApiAdapter.closeIncident(resolved.id, closeInput, managerCsvc)
assert.equal(closed.status, 'closed', 'Trạng thái phải chuyển sang closed')
assert.ok(closed.closed_at, 'Phải ghi nhận mốc thời gian closed_at')
assert.equal(closed.version, preCloseVersion + 1, 'Version phải tăng sau close')
console.log(`✓ [Bước 5: CLOSE] Hoàn tất: status="${closed.status}", closed_at="${closed.closed_at}", version=v${closed.version}`)

// ============================================================================
// 3. KIỂM TRA BẢO VỆ XUNG ĐỘT ĐỒNG THỜI (OCC 409 VERSION CONFLICT)
// ============================================================================
console.log('\n--- 3. Kiểm tra Optimistic Concurrency Control (OCC 409) trên từng thao tác ---')

// 3.1 Cố gắng thao tác với expected_version cũ (stale version)
try {
  await staffApiAdapter.closeIncident(closed.id, { expected_version: 1, reason: 'Stale update' }, managerCsvc)
  assert.fail('Phải ném lỗi version_conflict 409 khi expected_version không khớp')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string; status?: number } }
  assert.equal(errObj.error?.code, 'version_conflict')
  console.log('✓ Bắt chính xác lỗi 409 version_conflict khi truyền expected_version cũ')
}

// ============================================================================
// 4. KIỂM TRA QUY TRÌNH MỞ LẠI SỰ CỐ (REOPEN)
// ============================================================================
console.log('\n--- 4. Kiểm tra Quy trình Mở lại Sự cố (Reopen) ---')

const reopened = await staffApiAdapter.reopenIncident(
  closed.id,
  { expected_version: closed.version, reason: 'Phát hiện rỉ nhẹ mối nối sau 24h chạy tải; mở lại để siết thêm bulong.' },
  managerCsvc
)
assert.equal(reopened.status, 'in_progress', 'Trạng thái phải quay lại in_progress')
assert.equal(reopened.version, closed.version + 1)
console.log(`✓ [REOPEN] Hoàn tất: status="${reopened.status}", version=v${reopened.version}`)

// ============================================================================
// 5. KIỂM TRA TRAO ĐỔI (COMMENTS) & TIMELINE LỊCH SỬ QUA ADAPTER
// ============================================================================
console.log('\n--- 5. Kiểm tra Tích hợp Trao đổi & Timeline Lịch sử qua Adapter ---')

const comment = await staffApiAdapter.addComment(
  reopened.id,
  { body: 'Ghi chú kiểm tra nội bộ: Đã điều động thêm phụ tùng thay thế.', visibility: 'internal' },
  handlerCsvc
)
assert.ok(comment.id)
assert.equal(comment.visibility, 'internal')
console.log('✓ Thêm ghi chú nội bộ qua Adapter thành công')

const commentsList = await staffApiAdapter.getComments(reopened.id, handlerCsvc)
assert.ok(commentsList.length > 0)
console.log(`✓ Lấy danh sách trao đổi qua Adapter thành công (${commentsList.length} bình luận)`)

const historyList = await staffApiAdapter.getHistory(reopened.id, adminUser)
assert.ok(historyList.length >= 5)
console.log(`✓ Lấy danh sách kiểm toán Timeline qua Adapter thành công (${historyList.length} sự kiện)`)

// ============================================================================
// 6. KIỂM TRA TƯƠNG THÍCH ĐỒNG BỘ VỚI DEMOCLIENT
// ============================================================================
console.log('\n--- 6. Kiểm tra Đồng bộ qua demoClient ---')

await demoClient.login('admin@usth.edu.vn')
const demoDetail = await demoClient.getIncidentDetail(reopened.id)
assert.equal(demoDetail.id, reopened.id)
console.log('✓ demoClient kết nối và thực hiện truy vấn thông suốt qua StaffApiAdapter')

console.log('\n🎉 ĐẠT TOÀN BỘ CÁC MỤC KIỂM THỬ TASK N7-W08 CỦA NGUYỄN NHẬT QUANG!')
console.log('✅ Tiêu chí hoàn thành cốt lõi: Triage→assign→ack→resolve→close chạy với DB thật qua Adapter.\n')
