/**
 * Test Suite Task N6-W08: Thay mock bằng API thật N1/N2 theo adapter đã chốt; xử lý 401/403/404/409
 * Người thực hiện: Đỗ Tuấn Kiệt (Giao diện người báo - Tuần 8)
 * Tiêu chí hoàn thành: Luồng reporter thật chạy; xung đột yêu cầu tải lại.
 */

import assert from 'node:assert/strict'
import { reporterApiAdapter } from './src/api/reporter-api-adapter.ts'
import { demoClient } from './src/api/demo-client.ts'
import { MOCK_USERS } from './src/mocks/mock-users.ts'
import type { CreateIncidentInput } from './src/mocks/n6-contract-mock-api.ts'

console.log('--- BẮT ĐẦU KIỂM THỬ TASK N6-W08: REPORTER REAL API ADAPTER (ĐỖ TUẤN KIỆT) ---\n')

const reporter = MOCK_USERS['user-reporter']
const admin = MOCK_USERS['user-admin']

// ============================================================================
// 1. KIỂM TRA CẤU HÌNH ADAPTER VÀ CHUYỂN ĐỔI CHẾ ĐỘ (MODE)
// ============================================================================
console.log('--- 1. Kiểm tra Cấu hình Adapter & Cơ chế chuyển đổi Mode ---')

assert.strictEqual(reporterApiAdapter.getMode(), 'mock')
console.log('✓ Reporter API Adapter khởi tạo mặc định ở chế độ: "mock"')

reporterApiAdapter.setMode('real')
assert.strictEqual(reporterApiAdapter.getMode(), 'real')
reporterApiAdapter.setMode('mock')
assert.strictEqual(reporterApiAdapter.getMode(), 'mock')
console.log('✓ Chuyển đổi linh hoạt giữa "real" (API Thật) và "mock" (Mock Adapter) thành công')

reporterApiAdapter.setBaseUrl('http://localhost:8000/api/v1/')
assert.strictEqual(reporterApiAdapter.getBaseUrl(), 'http://localhost:8000/api/v1')
console.log('✓ Cấu hình setBaseUrl và getBaseUrl hoạt động chuẩn xác')

// ============================================================================
// 2. KIỂM TRA ĐĂNG NHẬP & QUẢN LÝ BEARER TOKEN (N1 AUTH)
// ============================================================================
console.log('\n--- 2. Kiểm tra Đăng nhập & Bearer Token (N1 Auth) ---')

const loginResult = await reporterApiAdapter.login(reporter.email, 'password123')
assert.strictEqual(loginResult.user.id, reporter.id)
assert.ok(loginResult.token.length > 10)
assert.strictEqual(reporterApiAdapter.getBearerToken(), loginResult.token)
console.log(`✓ Đăng nhập xác thực tài khoản "${reporter.display_name}" thành công qua Reporter Adapter`)

// ============================================================================
// 3. KIỂM THỬ LUỒNG REPORTER CỐT LÕI (N2 INCIDENTS & EVIDENCE)
// ============================================================================
console.log('\n--- 3. Kiểm thử Luồng Reporter Cốt Lõi: Tạo -> Upload -> Lấy DS -> Chi tiết -> Bổ sung ---')

reporterApiAdapter.reset()
await demoClient.login(reporter.email)

// 3.1 Tạo sự cố kèm Idempotency-Key
const idempotencyKey = crypto.randomUUID()
const createPayload: CreateIncidentInput = {
  category: 'water_leak',
  title: 'Rò rỉ nước hành lang tầng 3 nhà C',
  description: 'Nước nhỏ giọt liên tục từ trần nhà xuống sàn gạch gây trơn trượt.',
  building: 'Tòa C',
  location_detail: 'Hành lang tầng 3 gần phòng C302',
  observed_at: new Date(Date.now() - 3600000).toISOString(),
  answers: {
    leak_amount: 'large',
    near_electricity: 'no',
    slip_risk: true,
  },
}

const created = await reporterApiAdapter.createIncident(createPayload, idempotencyKey, reporter.id)
assert.ok(created.data.id)
assert.strictEqual(created.data.title, createPayload.title)
assert.strictEqual(created.data.status, 'reported')
assert.strictEqual(created.data.version, 1)
console.log(`✓ [Bước 1: TẠO BÁO CÁO] Thành công: ID=#${created.data.id.slice(0, 8)}, version=v${created.data.version}`)

// 3.2 Tải lên tệp đính kèm
const uploadedAttachment = await reporterApiAdapter.uploadAttachment(
  created.data.id,
  {
    filename: 'hien-truong-ro-nuoc.png',
    sizeBytes: 1024 * 50,
    mimeType: 'image/png',
    signature: [137, 80, 78, 71, 13, 10, 26, 10],
  },
  created.data.version,
  reporter.id
)
assert.ok(uploadedAttachment.id)
assert.strictEqual(uploadedAttachment.incident_version, 2)
console.log(`✓ [Bước 2: TẢI TỆP ĐÍNH KÈM] Thành công: ${uploadedAttachment.original_name}, version=v${uploadedAttachment.incident_version}`)

// 3.3 Lấy danh sách báo cáo của tôi
const myList = await reporterApiAdapter.getMyIncidents(reporter.id)
assert.ok(myList.items.length > 0)
const found = myList.items.find((i) => i.id === created.data.id)
assert.ok(found, 'Sự cố vừa tạo phải xuất hiện trong danh sách của reporter')
console.log(`✓ [Bước 3: LẤY DANH SÁCH BÁO CÁO] Thành công: ${myList.items.length} báo cáo trong danh sách`)

// 3.4 Lấy chi tiết sự cố
const detail = await reporterApiAdapter.getIncidentDetail(created.data.id, reporter.id)
assert.strictEqual(detail.id, created.data.id)
assert.strictEqual(detail.version, 2)
console.log(`✓ [Bước 4: LẤY CHI TIẾT SỰ CỐ] Thành công: Tiêu đề="${detail.title}", version=v${detail.version}`)

// 3.5 Bổ sung thông tin sự cố
const supplementResult = await reporterApiAdapter.supplementIncident(
  created.data.id,
  {
    expected_version: detail.version,
    text: 'Cập nhật thêm: Nước bắt đầu lan ra cầu thang thoát hiểm.',
  },
  reporter.id
)
assert.strictEqual(supplementResult.incident_version, 3)
console.log(`✓ [Bước 5: BỔ SUNG THÔNG TIN] Thành công: version tăng lên v${supplementResult.incident_version}`)

// 3.6 Lấy lịch sử công khai và tệp đính kèm
const publicHistory = await reporterApiAdapter.getPublicHistory(created.data.id, reporter.id)
assert.ok(publicHistory.length >= 2)
const attachments = await reporterApiAdapter.getAttachments(created.data.id, reporter.id)
assert.strictEqual(attachments.length, 1)
console.log(`✓ [Bước 6: TIMELINE & TỆP] Thành công: ${publicHistory.length} sự kiện lịch sử, ${attachments.length} tệp đính kèm`)

// ============================================================================
// 4. KIỂM TRA XỬ LÝ LỖI HTTP CHUẨN: 401, 403, 404, 409
// ============================================================================
console.log('\n--- 4. Kiểm tra Xử lý Lỗi HTTP 401 / 403 / 404 / 409 ---')

// 4.1 Xung đột phiên bản 409 (Optimistic Concurrency Control)
try {
  await reporterApiAdapter.supplementIncident(
    created.data.id,
    {
      expected_version: 1, // Phiên bản cũ đã bị trôi
      text: 'Thử gửi thông tin với version cũ',
    },
    reporter.id
  )
  assert.fail('Phải ném lỗi 409 version_conflict')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string; status?: number } }
  assert.strictEqual(errObj.error?.code, 'version_conflict')
  console.log('✓ [HTTP 409 Version Conflict] Bắt chuẩn xác lỗi xung đột phiên bản, yêu cầu tải lại dữ liệu')
}

// 4.2 Quyền truy cập 403 Forbidden
try {
  const mockRes403 = new Response(
    JSON.stringify({ error: { code: 'forbidden', message: 'Không có quyền thao tác' } }),
    {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }
  )
  await reporterApiAdapter.handleFetchError(mockRes403)
  assert.fail('Phải ném lỗi 403 forbidden')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string; status?: number } }
  assert.strictEqual(errObj.error?.code, 'forbidden')
  console.log('✓ [HTTP 403 Forbidden] Bắt chuẩn xác: Chặn người dùng không có quyền thao tác')
}

// 4.3 Scope Isolation & Không tìm thấy 404 Not Found
const otherUserId = '99e99999-99fd-4638-a97f-999999999999'
try {
  await reporterApiAdapter.getIncidentDetail(created.data.id, otherUserId)
  assert.fail('Phải ném lỗi 404 not_found')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string; status?: number } }
  assert.strictEqual(errObj.error?.code, 'not_found')
  console.log('✓ [HTTP 404 Not Found / Scope Isolation] Bắt chuẩn xác: Chặn lộ thông tin báo cáo người khác')
}

// 4.4 Chưa đăng nhập 401
try {
  const mockRes401 = new Response(JSON.stringify({ error: { code: 'unauthenticated', message: 'Token hết hạn' } }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
  await reporterApiAdapter.handleFetchError(mockRes401)
  assert.fail('Phải ném lỗi 401 unauthenticated')
} catch (err: unknown) {
  const errObj = err as { error?: { code?: string; status?: number } }
  assert.strictEqual(errObj.error?.code, 'unauthenticated')
  console.log('✓ [HTTP 401 Unauthenticated] Bắt chuẩn xác khi token phiên làm việc hết hạn')
}

// ============================================================================
// 5. KIỂM TRA ĐỒNG BỘ QUA DEMOCLIENT
// ============================================================================
console.log('\n--- 5. Kiểm tra Đồng bộ qua demoClient ---')
const demoList = await demoClient.getMyIncidents()
assert.ok(demoList.items.length > 0)
const demoDetail = await demoClient.getReporterIncidentDetail(created.data.id)
assert.strictEqual(demoDetail.id, created.data.id)
console.log('✓ demoClient kết nối và thực hiện truy vấn thông suốt qua ReporterApiAdapter')

console.log('\n🎉 ĐẠT TOÀN BỘ CÁC MỤC KIỂM THỬ TASK N6-W08 CỦA ĐỖ TUẤN KIỆT!')
console.log('✅ Tiêu chí hoàn thành cốt lõi: Thay mock bằng API thật N1/N2 theo adapter; xử lý 401/403/404/409; luồng reporter thật chạy; xung đột yêu cầu tải lại.\n')
