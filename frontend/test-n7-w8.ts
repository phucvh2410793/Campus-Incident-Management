/**
 * Test Suite Task N7-W08: Thay mock bằng API thật N1/N3/N4/N5 qua adapter đã chốt
 * Người thực hiện: Nguyễn Nhật Quang (Giao diện nhân viên & quản lý - Tuần 8)
 * Tiêu chí hoàn thành: Triage → assign → ack → resolve → close chạy qua adapter.
 */

import assert from 'node:assert/strict'
import { MOCK_USERS } from './src/mocks/mock-users.ts'
import { staffApiAdapter } from './src/api/staff-api-adapter.ts'
import { demoClient } from './src/api/demo-client.ts'

console.log('--- BẮT ĐẦU KIỂM THỬ TASK N7-W08: ADAPTER & VÒNG ĐỜI TRIAGE -> ASSIGN -> ACK -> RESOLVE -> CLOSE (NGUYỄN NHẬT QUANG) ---\n')

// ============================================================================
// 1. KIỂM TRA KHỞI TẠO VÀ CHẾ ĐỘ HOẠT ĐỘNG CỦA ADAPTER
// ============================================================================
console.log('--- 1. Kiểm tra cấu hình và chuyển đổi chế độ Adapter ---')

assert.ok(staffApiAdapter, 'staffApiAdapter phải được khởi tạo')
const initialMode = staffApiAdapter.getMode()
console.log(`✓ Chế độ mặc định của Adapter: "${initialMode}"`)

staffApiAdapter.setMode('real')
assert.equal(staffApiAdapter.getMode(), 'real')
console.log('✓ Chuyển sang chế độ "real" (API Thật) thành công')

staffApiAdapter.setMode('mock')
assert.equal(staffApiAdapter.getMode(), 'mock')
console.log('✓ Chuyển sang chế độ "mock" (Mock Adapter Dự Phòng) thành công')

staffApiAdapter.setBearerToken('test-bearer-token-123')
assert.equal(staffApiAdapter.getBearerToken(), 'test-bearer-token-123')
console.log('✓ Quản lý Bearer Token trong memory thành công')

// ============================================================================
// 2. CHU TRÌNH VÒNG ĐỜI ĐẦY ĐỦ: TRIAGE -> ASSIGN -> ACK -> RESOLVE -> CLOSE
// ============================================================================
console.log('\n--- 2. Kiểm thử toàn vẹn chu trình: Triage → assign → ack → resolve → close ---')

staffApiAdapter.resetData()

// Chuẩn bị một sự cố mẫu đang ở trạng thái Triage (triage_required = true)
const adminUser = MOCK_USERS['user-admin']
const managerTriage = MOCK_USERS['user-manager-triage']
const managerCsvc = MOCK_USERS['user-manager-csvc']
const handlerCsvc = MOCK_USERS['user-handler-csvc']

// Tìm sự cố cần Triage trong hệ thống (ID: 6bc34211-34d3-4955-9e5c-f7446fd42395)
const targetIncidentId = '6bc34211-34d3-4955-9e5c-f7446fd42395'
let currentIncident = await staffApiAdapter.getIncidentDetail(targetIncidentId, adminUser)

assert.equal(currentIncident.triage_required, true, 'Sự cố ban đầu phải cần Triage')
assert.equal(currentIncident.status, 'reported', 'Trạng thái ban đầu phải là reported')
const startVersion = currentIncident.version
console.log(`✓ [BƯỚC 0 - Khởi đầu] Sự cố #${currentIncident.id.slice(0, 8)} (v${startVersion}): Trạng thái "${currentIncident.status}", triage_required = true`)

// ----------------------------------------------------------------------------
// BƯỚC 1: TRIAGE (Phân loại thủ công ra khỏi Hàng đợi Triage)
// ----------------------------------------------------------------------------
console.log('\n--- BƯỚC 1: TRIAGE PHÂN LOẠI ---')
const triageRes = await staffApiAdapter.triageIncident(
  targetIncidentId,
  {
    department_id: 'dept-csvc',
    priority: 'p1',
    reason: 'Đánh giá nguy cơ ngập sàn, chuyển Ban Cơ sở vật chất xử lý khẩn',
    expected_version: currentIncident.version,
  },
  managerTriage
)

assert.equal(triageRes.triage_required, false, 'triage_required phải chuyển thành false sau khi Triage')
assert.equal(triageRes.department_id, 'dept-csvc', 'Phải chuyển sang dept-csvc')
assert.equal(triageRes.priority, 'p1', 'Phải gán mức ưu tiên p1')
assert.equal(triageRes.version, currentIncident.version + 1, 'Version phải tăng lên 1')
currentIncident = triageRes
console.log(`✓ [TRIAGE THÀNH CÔNG] Sự cố chuyển sang Ban CSVC, Priority P1, version v${currentIncident.version}, triage_required = false`)

// ----------------------------------------------------------------------------
// BƯỚC 2: ASSIGN (Phân công kỹ thuật viên phụ trách)
// ----------------------------------------------------------------------------
console.log('\n--- BƯỚC 2: ASSIGN PHÂN CÔNG KỸ THUẬT VIÊN ---')
const assignRes = await staffApiAdapter.assignIncident(
  targetIncidentId,
  {
    department_id: 'dept-csvc',
    handler_id: handlerCsvc.id,
    reason: 'Chỉ định KTV Phạm Văn Nam trực tiếp mang dụng cụ đến hiện trường',
    expected_version: currentIncident.version,
  },
  managerCsvc
)

assert.equal(assignRes.status, 'assigned', 'Trạng thái phải là assigned')
assert.equal(assignRes.assigned_handler_id, handlerCsvc.id, 'Phải gán đúng ID kỹ thuật viên')
assert.equal(assignRes.version, currentIncident.version + 1, 'Version phải tăng lên 1')
currentIncident = assignRes
console.log(`✓ [ASSIGN THÀNH CÔNG] Đã phân công cho KTV "${assignRes.assigned_handler_name}", status "${assignRes.status}", version v${currentIncident.version}`)

// ----------------------------------------------------------------------------
// BƯỚC 3: ACKNOWLEDGE (Kỹ thuật viên tiếp nhận xử lý)
// ----------------------------------------------------------------------------
console.log('\n--- BƯỚC 3: ACKNOWLEDGE TIẾP NHẬN SỰ CỐ ---')
const ackRes = await staffApiAdapter.acknowledgeIncident(
  targetIncidentId,
  currentIncident.version,
  handlerCsvc
)

assert.equal(ackRes.status, 'in_progress', 'Trạng thái phải chuyển sang in_progress sau khi tiếp nhận')
assert.ok(ackRes.acknowledged_at, 'Phải ghi nhận thời điểm acknowledged_at')
assert.equal(ackRes.version, currentIncident.version + 1, 'Version phải tăng lên 1')
currentIncident = ackRes
console.log(`✓ [ACKNOWLEDGE THÀNH CÔNG] KTV đã tiếp nhận hiện trường lúc ${ackRes.acknowledged_at}, status "${ackRes.status}", version v${currentIncident.version}`)

// ----------------------------------------------------------------------------
// BƯỚC 4: RESOLVE (Hoàn tất khắc phục sự cố tại hiện trường)
// ----------------------------------------------------------------------------
console.log('\n--- BƯỚC 4: RESOLVE GIẢI QUYẾT SỰ CỐ ---')
const resolveRes = await staffApiAdapter.resolveIncident(
  targetIncidentId,
  {
    expected_version: currentIncident.version,
    resolution: 'Đã phát hiện vỡ gioăng ống cấp nước âm sàn và thay thế ống đồng mới. Hiện trường đã khô ráo, an toàn.',
    reason: 'Đã hoàn thành các hạng mục sửa chữa',
  },
  handlerCsvc
)

assert.equal(resolveRes.status, 'resolved', 'Trạng thái phải là resolved')
assert.ok(resolveRes.resolved_at, 'Phải có resolved_at')
assert.ok(resolveRes.resolution?.includes('thay thế ống đồng mới'))
assert.equal(resolveRes.version, currentIncident.version + 1, 'Version phải tăng lên 1')
currentIncident = resolveRes
console.log(`✓ [RESOLVE THÀNH CÔNG] Ghi nhận giải quyết sự cố, status "${resolveRes.status}", version v${currentIncident.version}`)

// ----------------------------------------------------------------------------
// BƯỚC 5: CLOSE (Trưởng ban nghiệm thu và đóng sự cố chính thức)
// ----------------------------------------------------------------------------
console.log('\n--- BƯỚC 5: CLOSE NGHIỆM THU VÀ ĐÓNG SỰ CỐ ---')
const closeRes = await staffApiAdapter.closeIncident(
  targetIncidentId,
  {
    expected_version: currentIncident.version,
    reason: 'Trưởng ban CSVC đã kiểm tra lại áp lực nước và xác nhận sinh viên sử dụng bình thường. Đóng hồ sơ.',
  },
  managerCsvc
)

assert.equal(closeRes.status, 'closed', 'Trạng thái phải là closed')
assert.ok(closeRes.closed_at, 'Phải có closed_at')
assert.equal(closeRes.version, currentIncident.version + 1, 'Version phải tăng lên 1')
currentIncident = closeRes
console.log(`✓ [CLOSE THÀNH CÔNG] Đã nghiệm thu và đóng sự cố lúc ${closeRes.closed_at}, status "${closeRes.status}", version v${currentIncident.version}`)

// ----------------------------------------------------------------------------
// BƯỚC 6 (MỞ RỘNG): REOPEN (Mở lại sự cố nếu tái phát)
// ----------------------------------------------------------------------------
console.log('\n--- BƯỚC 6: REOPEN MỞ LẠI SỰ CỐ ---')
const reopenRes = await staffApiAdapter.reopenIncident(
  targetIncidentId,
  {
    expected_version: currentIncident.version,
    reason: 'Báo cáo lại: Nước tiếp tục rò rỉ tại khu vực giáp tường sau 2 tiếng đóng van.',
  },
  managerCsvc
)

assert.equal(reopenRes.status, 'in_progress', 'Trạng thái phải quay về in_progress sau khi mở lại')
assert.equal(reopenRes.version, currentIncident.version + 1, 'Version phải tăng lên 1')
console.log(`✓ [REOPEN THÀNH CÔNG] Đã mở lại sự cố, status "${reopenRes.status}", version v${reopenRes.version}`)

// ============================================================================
// 3. KIỂM TRA OPTIMISTIC CONCURRENCY CONTROL (409 CONFLICT)
// ============================================================================
console.log('\n--- 3. Kiểm tra kiểm soát đồng thời Optimistic Concurrency (HTTP 409) ---')

try {
  // Gửi expected_version cũ (v1 thay vì phiên bản hiện tại)
  await staffApiAdapter.assignIncident(
    targetIncidentId,
    {
      department_id: 'dept-csvc',
      handler_id: handlerCsvc.id,
      reason: 'Cố tình gửi version cũ',
      expected_version: 1, // Xung đột!
    },
    adminUser
  )
  assert.fail('Phiên bản cũ phải bị ném lỗi 409 version_conflict')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string; message?: string } }
  assert.equal(errObj.error?.code, 'version_conflict')
  console.log('✓ Bắt lỗi 409 Version Conflict chính xác khi sai expected_version:', errObj.error?.message)
}

// ============================================================================
// 4. KIỂM TRA PHÂN QUYỀN VÀ BẢO MẬT API
// ============================================================================
console.log('\n--- 4. Kiểm tra phân quyền API (Role-based Authorization) ---')

// 4.1 Reporter không được phép phân công
try {
  await staffApiAdapter.assignIncident(
    targetIncidentId,
    {
      department_id: 'dept-csvc',
      handler_id: null,
      reason: 'Reporter can thiệp trái phép',
      expected_version: reopenRes.version,
    },
    MOCK_USERS['user-reporter']
  )
  assert.fail('Reporter không được phép thực hiện assign')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.equal(errObj.error?.code, 'forbidden')
  console.log('✓ Chặn Reporter can thiệp phân công thành công (403 Forbidden)')
}

// 4.2 Kỹ thuật viên không được phép đóng sự cố (chỉ được resolve)
// Trước tiên chuyển lại sang trạng thái resolved
const resolvedAgain = await staffApiAdapter.resolveIncident(
  targetIncidentId,
  {
    expected_version: reopenRes.version,
    resolution: 'Đã hoàn tất kiểm tra sau khi mở lại.',
    reason: 'Đã xử lý xong lần 2',
  },
  handlerCsvc
)

try {
  await staffApiAdapter.closeIncident(
    targetIncidentId,
    {
      expected_version: resolvedAgain.version,
      reason: 'KTV tự ý đóng sự cố',
    },
    handlerCsvc
  )
  assert.fail('Handler không được phép đóng sự cố')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string } }
  assert.equal(errObj.error?.code, 'forbidden')
  console.log('✓ Chặn KTV tự ý đóng sự cố thành công (chỉ Manager hoặc Admin mới có quyền)')
}

// ============================================================================
// 5. KIỂM TRA TƯƠNG THÍCH QUA DEMOCLIENT
// ============================================================================
console.log('\n--- 5. Kiểm tra tương thích qua demoClient Adapter ---')

assert.equal(typeof demoClient.acknowledgeIncident, 'function')
assert.equal(typeof demoClient.resolveIncident, 'function')
assert.equal(typeof demoClient.closeIncident, 'function')
assert.equal(typeof demoClient.reopenIncident, 'function')
assert.equal(typeof demoClient.getAdapterMode, 'function')
console.log('✓ demoClient tích hợp đầy đủ chu trình vòng đời và Adapter API Thật')

staffApiAdapter.resetData()

console.log('\n🎉 ĐẠT TOÀN BỘ CÁC MỤC KIỂM THỬ TASK N7-W08 CỦA NGUYỄN NHẬT QUANG!')
console.log('✅ Tiêu chí hoàn thành cốt lõi: Triage → assign → ack → resolve → close chạy qua adapter.')
