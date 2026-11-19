import assert from 'node:assert/strict'
import { validateWaterLeakForm } from './src/features/reporter-w3/validate-water-leak-form.ts'
import { mockApi } from './src/mocks/mock-api-service.ts'
import { MOCK_USERS } from './src/mocks/mock-users.ts'

const emptyErrors = validateWaterLeakForm({ title: '', description: '', building: '', location_detail: '', observed_at: '' })
assert.deepEqual(Object.keys(emptyErrors).sort(), ['building', 'description', 'title'])

const futureErrors = validateWaterLeakForm({
  title: 'Rò nước hành lang',
  description: 'Nước đang chảy trên sàn gần phòng học.',
  building: 'Tòa A',
  location_detail: '',
  observed_at: '2099-01-01T09:00',
})
assert.equal(futureErrors.observed_at, 'Thời điểm quan sát phải hợp lệ và không ở tương lai.')

const incident = await mockApi.createIncident(MOCK_USERS['user-reporter'], {
  category: 'water_leak',
  title: 'Rò nước hành lang',
  description: 'Nước đang chảy trên sàn gần phòng học.',
  building: 'Tòa A',
  location_detail: null,
  observed_at: null,
  answers: { leak_amount: 'unknown', near_electricity: 'unknown', slip_risk: null },
}, crypto.randomUUID())
assert.equal(incident.category, 'water_leak')
assert.deepEqual(incident.answers, { leak_amount: 'unknown', near_electricity: 'unknown', slip_risk: null })
console.log('Đạt kiểm tra N6-W3: lỗi field validation, thời gian tương lai và unknown theo contract.')
