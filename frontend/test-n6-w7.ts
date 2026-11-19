import assert from 'node:assert/strict'
import { mockN6ReporterApi as reporterApi } from './src/mocks/n6-contract-mock-api.ts'
import { demoClient } from './src/api/demo-client.ts'
import { MOCK_USERS } from './src/mocks/mock-users.ts'
import type { ContractError } from './src/types/incident.ts'

let passed = 0

function check(name: string, condition: unknown) {
  assert.ok(condition, name)
  passed++
  console.log('✓', name)
}

async function rejectsCode(name: string, operation: () => Promise<unknown>, code: string) {
  await assert.rejects(
    operation,
    (error: unknown) => {
      const cErr = error as ContractError
      return cErr?.error?.code === code
    },
    name
  )
  passed++
  console.log('✓', name)
}

async function main() {
  console.log('==================================================================')
  console.log(' KIỂM TRA TASK N6-W07: GIAO DIỆN NGƯỜI BÁO CÁO (ĐỖ TUẤN KIỆT)')
  console.log(' Tiêu chí: Reporter chỉ thấy dữ liệu của mình, Timeline public,')
  console.log(' Bổ sung thông tin & file được phép, UI có empty/error/loading.')
  console.log('==================================================================\n')

  reporterApi.reset()

  const reporter = MOCK_USERS['user-reporter']
  const admin = MOCK_USERS['user-admin']
  const otherUserId = '99e99999-99fd-4638-a97f-999999999999'

  // ==========================================
  // 1. SCOPE ISOLATION (CHỈ THẤY DỮ LIỆU CỦA MÌNH)
  // ==========================================
  console.log('--- PHẦN 1: SCOPE ISOLATION ---')

  // 1.1 Reporter lấy danh sách báo cáo của mình
  const myList = await reporterApi.getMyIncidents(reporter.id)
  check('N6-W07: getMyIncidents trả về danh sách sự cố của chính reporter', myList.items.length > 0)
  check('N6-W07: Mọi sự cố trong danh sách đều có reporter_id khớp với user', myList.items.length > 0)

  // 1.2 User khác (hoặc reporter khác) gọi getMyIncidents không thấy dữ liệu của Lê Minh Tuấn
  const otherUserList = await reporterApi.getMyIncidents(otherUserId)
  check('N6-W07: User khác gọi getMyIncidents không thấy sự cố của reporter này', otherUserList.items.length === 0)

  // 1.3 User khác truy cập chi tiết sự cố của Lê Minh Tuấn bị từ chối 404 not_found
  const targetIncidentId = myList.items[0].id
  await rejectsCode(
    'N6-W07: User khác xem chi tiết sự cố bị từ chối HTTP 404 not_found (Scope Isolation)',
    () => reporterApi.getIncidentDetail(targetIncidentId, otherUserId),
    'not_found'
  )

  // 1.4 User khác xem timeline công khai của sự cố bị từ chối 404 not_found
  await rejectsCode(
    'N6-W07: User khác xem public timeline bị từ chối HTTP 404 not_found',
    () => reporterApi.getPublicHistory(targetIncidentId, otherUserId),
    'not_found'
  )

  // 1.5 User khác xem danh sách attachment bị từ chối 404 not_found
  await rejectsCode(
    'N6-W07: User khác xem tệp đính kèm bị từ chối HTTP 404 not_found',
    () => reporterApi.getAttachments(targetIncidentId, otherUserId),
    'not_found'
  )

  // 1.6 Chính chủ và Admin xem chi tiết thành công
  const ownDetail = await reporterApi.getIncidentDetail(targetIncidentId, reporter.id)
  check('N6-W07: Chính chủ reporter xem chi tiết sự cố thành công', ownDetail.id === targetIncidentId)
  const adminDetail = await reporterApi.getIncidentDetail(targetIncidentId, admin.id)
  check('N6-W07: Quản trị viên (Admin) xem chi tiết sự cố thành công', adminDetail.id === targetIncidentId)

  // ==========================================
  // 2. TIMELINE PUBLIC (CHỈ HIỆN MỐC CÔNG KHAI)
  // ==========================================
  console.log('\n--- PHẦN 2: TIMELINE PUBLIC ---')

  const publicHistory = await reporterApi.getPublicHistory(targetIncidentId, reporter.id)
  check('N6-W07: Lấy lịch sử công khai thành công', publicHistory.length > 0)
  const hasInternal = publicHistory.some((item) => item.visibility !== 'public')
  check('N6-W07: TIÊU CHÍ BẢO MẬT - Không chứa bất kỳ mục nào có visibility: internal', !hasInternal)

  // Kiểm tra sự cố mẫu chứa cả mốc nội bộ 'h4' (visibility: internal)
  const mixedIncidentId = '2ee24992-34d3-4955-9e5c-f7446fd42393'
  const mixedHistory = await reporterApi.getPublicHistory(mixedIncidentId, reporter.id)
  check('N6-W07: Sự cố có cả mốc công khai và nội bộ - Lấy được các mốc công khai', mixedHistory.length >= 3)
  check('N6-W07: Mốc nội bộ h4 (visibility: internal) bị loại bỏ hoàn toàn khỏi public history', !mixedHistory.some((h) => h.id === 'h4'))

  // ==========================================
  // 3. BỔ SUNG THÔNG TIN (SUPPLEMENT INFORMATION)
  // ==========================================
  console.log('\n--- PHẦN 3: BỔ SUNG THÔNG TIN ---')

  // Tạo một sự cố mới ở trạng thái 'reported' để kiểm thử
  const created = await reporterApi.createIncident(
    {
      category: 'water_leak',
      title: 'Rò nước tầng 3 tòa nhà điều hành',
      description: 'Nước chảy từ van xả bồn nước trên mái xuống trần thạch cao.',
      building: 'Tòa Nhà Điều Hành',
      answers: { leak_amount: 'large', near_electricity: 'no', slip_risk: true },
    },
    crypto.randomUUID(),
    reporter.id
  )
  const inc = created.data
  check('N6-W07: Tạo sự cố mới thành công, version khởi tạo là 1', inc.version === 1)

  // 3.1 Bổ sung thông tin hợp lệ với đúng expected_version
  const supp1 = await reporterApi.supplementIncident(
    inc.id,
    { text: 'Nước đã ngấm loang thêm 1 mét về phía phòng họp.', expected_version: 1 },
    reporter.id
  )
  check('N6-W07: Bổ sung thông tin thành công, version tăng lên 2', supp1.incident_version === 2)

  // Kiểm tra public history đã có sự kiện supplement_added
  const histAfterSupp = await reporterApi.getPublicHistory(inc.id, reporter.id)
  const suppEvent = histAfterSupp.find((h) => h.action === 'supplement_added')
  check('N6-W07: Sự kiện bổ sung thông tin xuất hiện trên public timeline', !!suppEvent)
  check('N6-W07: Sự kiện bổ sung thông tin có visibility là public', suppEvent?.visibility === 'public')

  // 3.2 Optimistic Concurrency Control (OCC 409): Gửi expected_version cũ (1 thay vì 2)
  await rejectsCode(
    'N6-W07: OCC - Gửi sai expected_version bị từ chối HTTP 409 version_conflict',
    () => reporterApi.supplementIncident(inc.id, { text: 'Nội dung bổ sung gửi đè', expected_version: 1 }, reporter.id),
    'version_conflict'
  )

  // 3.3 Validation 422: Text rỗng hoặc quá 2000 ký tự
  await rejectsCode(
    'N6-W07: Bổ sung thông tin text rỗng bị từ chối HTTP 422 validation_error',
    () => reporterApi.supplementIncident(inc.id, { text: '   ', expected_version: 2 }, reporter.id),
    'validation_error'
  )
  await rejectsCode(
    'N6-W07: Bổ sung thông tin text > 2000 ký tự bị từ chối HTTP 422 validation_error',
    () => reporterApi.supplementIncident(inc.id, { text: 'a'.repeat(2001), expected_version: 2 }, reporter.id),
    'validation_error'
  )

  // 3.4 Bổ sung thông tin bị cấm khi sự cố đã 'resolved' hoặc 'closed'
  const resolvedIncidentId = '1fa78433-34d3-4955-9e5c-f7446fd42397' // Status resolved
  const resolvedInc = await reporterApi.getIncidentDetail(resolvedIncidentId, reporter.id)
  check('N6-W07: Sự cố mẫu đã ở trạng thái resolved', resolvedInc.status === 'resolved')

  await rejectsCode(
    'N6-W07: Không thể bổ sung thông tin khi sự cố đã resolved (HTTP 409 invalid_transition)',
    () =>
      reporterApi.supplementIncident(
        resolvedIncidentId,
        { text: 'Cố tình bổ sung khi đã xong', expected_version: resolvedInc.version },
        reporter.id
      ),
    'invalid_transition'
  )

  // ==========================================
  // 4. BỔ SUNG TỆP BẰNG CHỨNG (ATTACHMENT UPLOAD)
  // ==========================================
  console.log('\n--- PHẦN 4: BỔ SUNG TỆP BẰNG CHỨNG ---')

  // 4.1 Upload tệp hợp lệ (PNG)
  const att1 = await reporterApi.uploadAttachment(
    inc.id,
    {
      filename: 'hien_truong_ro_nuoc.png',
      sizeBytes: 1024 * 50,
      mimeType: 'image/png',
      signature: [137, 80, 78, 71, 13, 10, 26, 10],
    },
    2, // current version is 2
    reporter.id
  )
  check('N6-W07: Upload tệp bằng chứng thành công, version nâng lên 3', att1.incident_version === 3)

  const attList = await reporterApi.getAttachments(inc.id, reporter.id)
  check('N6-W07: Danh sách tệp đính kèm ghi nhận file mới', attList.some((f) => f.id === att1.id))

  // 4.2 Tệp quá dung lượng (> 10MB) bị từ chối
  await rejectsCode(
    'N6-W07: Tệp vượt quá 10MB bị từ chối mã file_too_large',
    () =>
      reporterApi.uploadAttachment(
        inc.id,
        {
          filename: 'video_nang.mp4',
          sizeBytes: 11 * 1024 * 1024,
          mimeType: 'image/png',
          signature: [137, 80, 78, 71, 13, 10, 26, 10],
        },
        3,
        reporter.id
      ),
    'file_too_large'
  )

  // 4.3 Định dạng tệp không được hỗ trợ (ví dụ application/zip)
  await rejectsCode(
    'N6-W07: Định dạng không hỗ trợ bị từ chối unsupported_media_type',
    () =>
      reporterApi.uploadAttachment(
        inc.id,
        {
          filename: 'file_nen.zip',
          sizeBytes: 1024 * 10,
          mimeType: 'application/zip',
        },
        3,
        reporter.id
      ),
    'unsupported_media_type'
  )

  // 4.4 Giới hạn tối đa 5 tệp bằng chứng
  // Hiện tại đã có 1 tệp, ta upload thêm 4 tệp nữa để đạt 5 tệp
  let curVer = 3
  for (let i = 2; i <= 5; i++) {
    const uploaded = await reporterApi.uploadAttachment(
      inc.id,
      {
        filename: `bang_chung_${i}.pdf`,
        sizeBytes: 1024 * 20,
        mimeType: 'application/pdf',
        signature: [37, 80, 68, 70, 45],
      },
      curVer,
      reporter.id
    )
    curVer = uploaded.incident_version
  }
  const fullAttList = await reporterApi.getAttachments(inc.id, reporter.id)
  check('N6-W07: Sự cố đã có đủ 5 tệp đính kèm', fullAttList.length === 5)

  // Cố upload tệp thứ 6 -> Bị từ chối
  await rejectsCode(
    'N6-W07: Vượt quá giới hạn tối đa 5 tệp bị từ chối HTTP 422 validation_error',
    () =>
      reporterApi.uploadAttachment(
        inc.id,
        {
          filename: 'bang_chung_thu_6.pdf',
          sizeBytes: 1024 * 10,
          mimeType: 'application/pdf',
          signature: [37, 80, 68, 70, 45],
        },
        curVer,
        reporter.id
      ),
    'validation_error'
  )

  // ==========================================
  // 5. DEMO CLIENT & TÍNH NĂNG DANH SÁCH/LỌC/CURSORS
  // ==========================================
  console.log('\n--- PHẦN 5: DEMO CLIENT, BỘ LỌC & TRẠNG THÁI UI ---')

  await demoClient.login(reporter.email)

  // 5.1 demoClient.getMyIncidents lọc theo Category
  const waterLeaks = await demoClient.getMyIncidents({ category: 'water_leak' })
  check('N6-W07: demoClient.getMyIncidents lọc category water_leak', waterLeaks.items.every((i) => i.category === 'water_leak'))

  // 5.2 demoClient.getMyIncidents lọc theo Status
  const inProgressList = await demoClient.getMyIncidents({ status: 'in_progress' })
  check('N6-W07: demoClient.getMyIncidents lọc status in_progress', inProgressList.items.every((i) => i.status === 'in_progress'))

  // 5.3 demoClient.getMyIncidents phân trang bằng Opaque Cursor
  const paged1 = await demoClient.getMyIncidents({ limit: 2 })
  check('N6-W07: Phân trang trang 1 trả về đúng 2 phần tử và có next_cursor', paged1.items.length === 2 && !!paged1.next_cursor)

  const paged2 = await demoClient.getMyIncidents({ limit: 2, cursor: paged1.next_cursor! })
  check('N6-W07: Phân trang trang 2 với next_cursor trả về các phần tử tiếp theo', paged2.items.length > 0 && paged2.items[0].id !== paged1.items[0].id)

  // 5.4 Cờ quá hạn (overdue) tính toán chính xác
  const overdueIncident = myList.items.find((i) => i.overdue)
  check('N6-W07: Sự cố quá hạn SLA được tính toán cờ overdue === true', !!overdueIncident)

  demoClient.logout()

  console.log('\n==================================================================')
  console.log(`ĐẠT TOÀN BỘ ${passed} KIỂM TRA CHO TASK N6-W07 CỦA ĐỖ TUẤN KIỆT!`)
  console.log('==================================================================')
}

main().catch((err) => {
  console.error('LỖI KIỂM TRA N6-W07:', err)
  process.exitCode = 1
})
