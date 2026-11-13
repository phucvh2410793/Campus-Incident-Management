import assert from 'node:assert/strict'
import {
  validatePhishingForm,
  detectSecretLeak,
} from './src/features/reporter-w5/validate-phishing-form.ts'
import { mockApi } from './src/mocks/mock-api-service.ts'
import { MOCK_USERS } from './src/mocks/mock-users.ts'

console.log('--- BẮT ĐẦU KIỂM TRA TASK N6-W05: FORM PHISHING, KÊNH NHẬN/TƯƠNG TÁC, CHẶN SECRET (ĐỖ TUẤN KIỆT) ---')

// =========================================================================
// 1. KIỂM TRA VALIDATION CƠ BẢN
// =========================================================================
console.log('\n--- 1. Kiểm tra validation form cơ bản ---')

// 1.1 Form rỗng
const emptyErrors = validatePhishingForm({
  title: '',
  description: '',
  building: '',
  location_detail: '',
  observed_at: '',
  sender_text: '',
})
assert.deepEqual(Object.keys(emptyErrors).sort(), ['building', 'description', 'title'])
assert.equal(emptyErrors.title, 'Nhập tiêu đề từ 5 đến 120 ký tự.')
assert.equal(emptyErrors.description, 'Nhập mô tả từ 20 đến 2000 ký tự.')
assert.equal(emptyErrors.building, 'Nhập tòa nhà hoặc khu vực, tối đa 120 ký tự.')
console.log('✓ Bắt lỗi form rỗng chính xác (title, description, building)')

// 1.2 Độ dài quá giới hạn
const lengthErrors = validatePhishingForm({
  title: 'abc', // < 5
  description: 'quá ngắn', // < 20
  building: 'A'.repeat(121), // > 120
  location_detail: 'B'.repeat(201), // > 200
  sender_text: 'C'.repeat(255), // > 254
  observed_at: '',
})
assert.equal(lengthErrors.title, 'Nhập tiêu đề từ 5 đến 120 ký tự.')
assert.equal(lengthErrors.description, 'Nhập mô tả từ 20 đến 2000 ký tự.')
assert.equal(lengthErrors.building, 'Nhập tòa nhà hoặc khu vực, tối đa 120 ký tự.')
assert.equal(lengthErrors.location_detail, 'Vị trí chi tiết tối đa 200 ký tự.')
assert.equal(lengthErrors.sender_text, 'Địa chỉ người gửi hoặc tên miền tối đa 254 ký tự.')
console.log('✓ Bắt lỗi giới hạn độ dài ký tự min/max chính xác')

// 1.3 Thời điểm quan sát ở tương lai
const futureErrors = validatePhishingForm({
  title: 'Email mạo danh thông báo điểm',
  description: 'Nội dung email yêu cầu sinh viên click vào link để tra cứu điểm thi.',
  building: 'Tòa B',
  location_detail: 'Phòng học 201',
  sender_text: 'diemthi-usth@gmail.com',
  observed_at: '2099-12-31T23:59',
})
assert.equal(futureErrors.observed_at, 'Thời điểm quan sát phải hợp lệ và không ở tương lai.')
console.log('✓ Chặn thời điểm quan sát ở tương lai')

// =========================================================================
// 2. TIÊU CHÍ HOÀN THÀNH: KHÔNG GỬI / LƯU SECRET (PASSWORD / OTP)
// =========================================================================
console.log('\n--- 2. Tiêu chí hoàn thành: Chặn nhập và Không gửi/lưu Secret (Password / OTP) ---')

// 2.1 Phát hiện mật khẩu
const passCheck1 = detectSecretLeak('Tôi đã nhập password: MySecretPass123 vào trang web')
assert.equal(passCheck1.hasSecret, true)
console.log('✓ Phát hiện mật khẩu dạng "password: ...":', passCheck1.reason)

const passCheck2 = detectSecretLeak('Trang yêu cầu mật khẩu: SinhVien2026@')
assert.equal(passCheck2.hasSecret, true)
console.log('✓ Phát hiện mật khẩu tiếng Việt dạng "mật khẩu: ...":', passCheck2.reason)

// 2.2 Phát hiện mã OTP
const otpCheck1 = detectSecretLeak('Mã OTP là 839201 gửi về điện thoại')
assert.equal(otpCheck1.hasSecret, true)
console.log('✓ Phát hiện mã OTP dạng "Mã OTP là 839201":', otpCheck1.reason)

const otpCheck2 = detectSecretLeak('Trang web đòi nhập otp: 456789 để xác minh')
assert.equal(otpCheck2.hasSecret, true)
console.log('✓ Phát hiện mã OTP dạng "otp: 456789":', otpCheck2.reason)

// 2.3 Form validation chặn khi phát hiện Secret trong trường mô tả hoặc tiêu đề
const secretErrors = validatePhishingForm({
  title: 'Bị lừa lấy password: 123456Aa@',
  description: 'Trang web mạo danh đã yêu cầu mã OTP: 778899 và tôi đã nhập vào đó.',
  building: 'Tòa A',
  location_detail: '',
  sender_text: '',
  observed_at: '',
})
assert.ok(secretErrors.title.includes('mật khẩu') || secretErrors.title.includes('bí mật'))
assert.ok(secretErrors.description.includes('OTP') || secretErrors.description.includes('bí mật'))
console.log('✓ Form validation chặn submit và báo lỗi đỏ khi người dùng nhập secret')

// 2.4 Nội dung an toàn không bị chặn nhầm
const safeCheck = detectSecretLeak('Kẻ tấn công gửi link giả mạo cổng đào tạo USTH và yêu cầu đổi tài khoản')
assert.equal(safeCheck.hasSecret, false)
console.log('✓ Nội dung mô tả an toàn không bị chặn nhầm')

// =========================================================================
// 3. TIÊU CHÍ HOÀN THÀNH: BA TRẠNG THÁI TƯƠNG TÁC PHÂN BIỆT RÕ
// =========================================================================
console.log('\n--- 3. Tiêu chí hoàn thành: Ba trạng thái tương tác phân biệt rõ ---')

const user = MOCK_USERS['user-reporter']

// 3.1 Trạng thái 1: Chưa tương tác ('none') -> Rủi ro thấp, Ưu tiên P3
const idemKey1 = crypto.randomUUID()
const incidentNone = await mockApi.createIncident(
  user,
  {
    category: 'phishing',
    title: 'Email mạo danh phòng CTSV thông báo học bổng',
    description: 'Nhận được email từ địa chỉ lạ ctsv-usth@outlook.com nhưng chưa bấm vào link hay tương tác gì.',
    building: 'Tòa B',
    location_detail: 'Hành lang tầng 3',
    observed_at: new Date().toISOString(),
    answers: {
      channel: 'email',
      interaction: 'none',
      sender_text: 'ctsv-usth@outlook.com',
    },
  },
  idemKey1
)

assert.equal(incidentNone.category, 'phishing')
assert.equal(incidentNone.status, 'reported')
assert.equal(incidentNone.severity, 'low')
assert.equal(incidentNone.priority, 'p3')
assert.equal(incidentNone.department_id, 'dept-it')
assert.equal(incidentNone.triage_required, false)
assert.equal(incidentNone.answers.interaction, 'none')
console.log('✓ Trạng thái 1 [Chưa tương tác (none)]: Phân loại chính xác Low / P3 / IT Security')

// 3.2 Trạng thái 2: Đã bấm vào liên kết ('clicked_link') -> Rủi ro vừa, Ưu tiên P2
const idemKey2 = crypto.randomUUID()
const incidentClicked = await mockApi.createIncident(
  user,
  {
    category: 'phishing',
    title: 'Tin nhắn SMS thông báo nợ học phí có link lạ',
    description: 'Đã vô tình bấm vào đường link trong tin nhắn nhưng chưa nhập tài khoản hay thông tin gì.',
    building: 'Ký túc xá',
    location_detail: 'Phòng 402',
    observed_at: null,
    answers: {
      channel: 'message',
      interaction: 'clicked_link',
      sender_text: 'http://hocphi-usth.xyz/pay',
    },
  },
  idemKey2
)

assert.equal(incidentClicked.severity, 'medium')
assert.equal(incidentClicked.priority, 'p2')
assert.equal(incidentClicked.department_id, 'dept-it')
assert.equal(incidentClicked.triage_required, false)
assert.equal(incidentClicked.answers.interaction, 'clicked_link')
console.log('✓ Trạng thái 2 [Đã bấm liên kết (clicked_link)]: Phân loại chính xác Medium / P2 / IT Security')

// 3.3 Trạng thái 3: Đã nhập thông tin ('entered_information') -> Nguy cấp, Ưu tiên P1
const idemKey3 = crypto.randomUUID()
const incidentEntered = await mockApi.createIncident(
  user,
  {
    category: 'phishing',
    title: 'Cảnh báo lừa đảo trang khảo sát nghiên cứu sinh',
    description: 'Đã điền thông tin tài khoản trường vào form giả mạo trên Google Docs, cần hỗ trợ khóa phiên.',
    building: 'Thư viện',
    location_detail: 'Tầng 1 bàn tự học',
    observed_at: null,
    answers: {
      channel: 'other',
      interaction: 'entered_information',
      sender_text: 'https://docs.google.com/forms/d/e/fake-survey',
    },
  },
  idemKey3
)

assert.equal(incidentEntered.severity, 'high')
assert.equal(incidentEntered.priority, 'p1')
assert.equal(incidentEntered.department_id, 'dept-it')
assert.equal(incidentEntered.triage_required, false)
assert.equal(incidentEntered.answers.interaction, 'entered_information')
console.log('✓ Trạng thái 3 [Đã nhập thông tin (entered_information)]: Phân loại chính xác High / P1 / IT Security')

// 3.4 Trường hợp chưa rõ ('unknown') -> Chuyển hàng đợi Triage
const idemKey4 = crypto.randomUUID()
const incidentUnknown = await mockApi.createIncident(
  user,
  {
    category: 'phishing',
    title: 'Nghi vấn email giả mạo từ ban giám hiệu',
    description: 'Email lạ gửi kèm file nén zip, không chắc chắn người trong phòng đã mở ra hay chưa.',
    building: 'Tòa A',
    location_detail: 'Văn phòng bộ môn',
    observed_at: null,
    answers: {
      channel: 'email',
      interaction: 'unknown',
      sender_text: 'president-usth@fake-domain.com',
    },
  },
  idemKey4
)

assert.equal(incidentUnknown.triage_required, true)
assert.equal(incidentUnknown.department_id, 'dept-triage')
assert.equal(incidentUnknown.answers.interaction, 'unknown')
console.log('✓ Trạng thái [Chưa rõ (unknown)]: Chuyển hàng đợi Triage phân loại thủ công')

// =========================================================================
// 4. KIỂM TRA CHỐNG GỬI LẶP QUA IDEMPOTENCY-KEY
// =========================================================================
console.log('\n--- 4. Kiểm tra chống gửi lặp qua Idempotency-Key ---')

const duplicateResult = await mockApi.createIncident(
  user,
  {
    category: 'phishing',
    title: 'Email mạo danh phòng CTSV thông báo học bổng',
    description: 'Nhận được email từ địa chỉ lạ ctsv-usth@outlook.com nhưng chưa bấm vào link hay tương tác gì.',
    building: 'Tòa B',
    location_detail: 'Hành lang tầng 3',
    observed_at: incidentNone.observed_at,
    answers: {
      channel: 'email',
      interaction: 'none',
      sender_text: 'ctsv-usth@outlook.com',
    },
  },
  idemKey1
)
assert.equal(duplicateResult.id, incidentNone.id, 'Trùng Idempotency-Key trả về cùng incident ID')
console.log('✓ Cơ chế chống gửi lặp qua Idempotency-Key hoạt động hoàn hảo')

console.log('\n🎉 ĐẠT TOÀN BỘ CÁC MỤC KIỂM THỬ TASK N6-W05 CỦA ĐỖ TUẤN KIỆT!')
console.log('✅ Tiêu chí hoàn thành cốt lõi: Không gửi/lưu secret; ba trạng thái tương tác phân biệt rõ.')
