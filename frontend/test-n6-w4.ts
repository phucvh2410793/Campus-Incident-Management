import assert from 'node:assert/strict'
import { validateElectricalHazardForm } from './src/features/reporter-w4/validate-electrical-hazard-form.ts'
import { mockApi } from './src/mocks/mock-api-service.ts'
import { MOCK_USERS } from './src/mocks/mock-users.ts'

// 1. Kiểm tra validation khi form rỗng
const emptyErrors = validateElectricalHazardForm({
  title: '',
  description: '',
  building: '',
  location_detail: '',
  observed_at: '',
  equipment: '',
})
assert.deepEqual(Object.keys(emptyErrors).sort(), ['building', 'description', 'title'])
assert.equal(emptyErrors.title, 'Nhập tiêu đề từ 5 đến 120 ký tự.')
assert.equal(emptyErrors.description, 'Nhập mô tả từ 20 đến 2000 ký tự.')
assert.equal(emptyErrors.building, 'Nhập tòa nhà hoặc khu vực, tối đa 120 ký tự.')

// 2. Kiểm tra độ dài quá giới hạn
const lengthErrors = validateElectricalHazardForm({
  title: 'abcd', // < 5
  description: 'quá ngắn', // < 20
  building: 'A',
  location_detail: 'x'.repeat(201),
  equipment: 'y'.repeat(201),
  observed_at: '',
})
assert.equal(lengthErrors.title, 'Nhập tiêu đề từ 5 đến 120 ký tự.')
assert.equal(lengthErrors.description, 'Nhập mô tả từ 20 đến 2000 ký tự.')
assert.equal(lengthErrors.location_detail, 'Vị trí chi tiết tối đa 200 ký tự.')
assert.equal(lengthErrors.equipment, 'Tên thiết bị tối đa 200 ký tự.')

// 3. Kiểm tra thời điểm quan sát ở tương lai
const futureErrors = validateElectricalHazardForm({
  title: 'Dây điện bị cháy khói tại phòng lab',
  description: 'Dây điện hở tia lửa bốc khói đen tại phòng lab tầng 3.',
  building: 'Tòa B',
  location_detail: 'Phòng 304',
  equipment: 'Tủ điện tổng',
  observed_at: '2099-01-01T09:00',
})
assert.equal(futureErrors.observed_at, 'Thời điểm quan sát phải hợp lệ và không ở tương lai.')

// 4. Tiêu chí hoàn thành cốt lõi: Gửi sự cố nguy hiểm điện có khói/tia lửa (smoke_or_sparks: 'yes')
const user = MOCK_USERS['user-reporter']
const idemKey1 = crypto.randomUUID()
const incident1 = await mockApi.createIncident(
  user,
  {
    category: 'electrical_hazard',
    title: 'Phát hiện dây điện hở và tia lửa bốc khói',
    description: 'Tại hành lang tầng 2 khu thí nghiệm, dây điện tổng bị chập tạo tia lửa và khói khét.',
    building: 'Tòa B',
    location_detail: 'Hành lang tầng 2',
    observed_at: new Date().toISOString(),
    answers: {
      exposed_wire: 'yes',
      smoke_or_sparks: 'yes',
      equipment: 'Tủ điện tầng 2',
    },
  },
  idemKey1
)

assert.equal(incident1.category, 'electrical_hazard')
assert.equal(incident1.status, 'reported')
assert.equal(incident1.severity, 'critical')
assert.equal(incident1.priority, 'p1')
assert.equal(incident1.department_id, 'dept-dien')
assert.equal(incident1.triage_required, false)
assert.deepEqual(incident1.answers, {
  exposed_wire: 'yes',
  smoke_or_sparks: 'yes',
  equipment: 'Tủ điện tầng 2',
})

// 5. Kiểm tra trường hợp chỉ có dây hở (exposed_wire: 'yes', smoke_or_sparks: 'no')
const idemKey2 = crypto.randomUUID()
const incident2 = await mockApi.createIncident(
  user,
  {
    category: 'electrical_hazard',
    title: 'Dây dẫn điện hở lõi đồng sàn phòng thực hành',
    description: 'Dây nguồn máy lạnh âm sàn bị tróc vỏ lộ lõi đồng nguy hiểm.',
    building: 'Tòa A',
    location_detail: 'Phòng học 102',
    observed_at: null,
    answers: {
      exposed_wire: 'yes',
      smoke_or_sparks: 'no',
      equipment: 'Dây máy lạnh',
    },
  },
  idemKey2
)

assert.equal(incident2.severity, 'high')
assert.equal(incident2.priority, 'p1')
assert.equal(incident2.department_id, 'dept-dien')

// 6. Kiểm tra trường hợp trả lời "Chưa rõ" (unknown) -> Chuyển triage phân loại
const idemKey3 = crypto.randomUUID()
const incident3 = await mockApi.createIncident(
  user,
  {
    category: 'electrical_hazard',
    title: 'Mùi khét nghi do chập điện ổ cắm',
    description: 'Có mùi khét nồng tại góc phòng nhưng chưa rõ do thiết bị hay dây điện ngầm.',
    building: 'Nhà C',
    location_detail: 'Văn phòng khoa',
    observed_at: null,
    answers: {
      exposed_wire: 'unknown',
      smoke_or_sparks: 'unknown',
      equipment: null,
    },
  },
  idemKey3
)

assert.equal(incident3.triage_required, true)
assert.equal(incident3.department_id, 'dept-triage')

// 7. Kiểm tra chống gửi lặp qua Idempotency-Key
const incident1Duplicate = await mockApi.createIncident(
  user,
  {
    category: 'electrical_hazard',
    title: 'Phát hiện dây điện hở và tia lửa bốc khói',
    description: 'Tại hành lang tầng 2 khu thí nghiệm, dây điện tổng bị chập tạo tia lửa và khói khét.',
    building: 'Tòa B',
    location_detail: 'Hành lang tầng 2',
    observed_at: incident1.observed_at,
    answers: {
      exposed_wire: 'yes',
      smoke_or_sparks: 'yes',
      equipment: 'Tủ điện tầng 2',
    },
  },
  idemKey1
)
assert.equal(incident1Duplicate.id, incident1.id, 'Trùng Idempotency-Key và payload phải trả về cùng incident')

console.log('✅ Đạt toàn bộ kiểm tra N6-W04:')
console.log('  1. Validation form: empty fields, min/max length, future observed_at.')
console.log('  2. Gửi đúng dây hở, khói/tia lửa, thiết bị theo contract electrical_hazard.')
console.log('  3. Phân luồng rule engine (khói/tia lửa -> Critical P1; dây hở -> High P1; unknown -> triage).')
console.log('  4. Idempotency key bảo vệ chống gửi lặp.')
