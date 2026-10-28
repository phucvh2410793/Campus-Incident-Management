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
    (error: unknown) => (error as ContractError)?.error?.code === code,
    name
  )
  passed++
  console.log('✓', name)
}

async function main() {
  console.log('--- KIỂM TRA TASK N6-W06: GIAO DIỆN NGƯỜI BÁO (ĐỖ TUẤN KIỆT) ---')

  const reporter = MOCK_USERS['user-reporter']
  const _admin = MOCK_USERS['user-admin']

  // ==========================================
  // 1. CHỐNG GỬI LẶP (IDEMPOTENCY-KEY)
  // ==========================================
  const validWaterInput = {
    category: 'water_leak' as const,
    title: 'Rò rỉ nước hành lang tầng 2 Tòa A',
    description: 'Nước đang nhỏ giọt thành dòng từ trần nhà xuống sàn đi lại.',
    building: 'Tòa A',
    location_detail: 'Tầng 2, trước phòng 204',
    observed_at: new Date(Date.now() - 3600000).toISOString(),
    answers: {
      leak_amount: 'large' as const,
      near_electricity: 'no' as const,
      slip_risk: true,
    },
  }

  const idempotencyKey1 = crypto.randomUUID()

  // 1.1 Gửi lần đầu: Trả về HTTP 201 Created, version = 1
  const createRes1 = await reporterApi.createIncident(validWaterInput, idempotencyKey1, reporter.id)
  check('N6-W06: Lần đầu gửi tạo incident trả 201, version = 1', createRes1.status === 201 && createRes1.data.version === 1)
  const incident1 = createRes1.data

  // 1.2 Gửi lại cùng user, cùng idempotency key, cùng payload: Trả về HTTP 200, cùng incident ID
  const replayRes = await reporterApi.createIncident(validWaterInput, idempotencyKey1, reporter.id)
  check('N6-W06: Chống gửi lặp - Cùng key và body trả HTTP 200 bản ghi cũ', replayRes.status === 200 && replayRes.data.id === incident1.id)

  // 1.3 Gửi lại cùng key nhưng khác payload: Bị từ chối với HTTP 409 idempotency_conflict
  await rejectsCode(
    'N6-W06: Chống gửi lặp - Cùng key khác body bị từ chối HTTP 409 idempotency_conflict',
    () => reporterApi.createIncident({ ...validWaterInput, title: 'Tiêu đề đã bị thay đổi khác' }, idempotencyKey1, reporter.id),
    'idempotency_conflict'
  )

  // 1.4 Thiếu UUID Idempotency-Key bị từ chối HTTP 422
  await rejectsCode(
    'N6-W06: Thiếu Idempotency-Key hợp lệ bị HTTP 422 validation_error',
    () => reporterApi.createIncident(validWaterInput, 'invalid-non-uuid-key', reporter.id),
    'validation_error'
  )

  // ==========================================
  // 2. TẠO INCIDENT RỒI UPLOAD TỪNG FILE
  // ==========================================
  const validElecInput = {
    category: 'electrical_hazard' as const,
    title: 'Ổ cắm điện phát tia lửa tại phòng Lab 301',
    description: 'Ổ cắm điện âm tường có mùi khét và tia lửa nhỏ khi cắm thiết bị.',
    building: 'Tòa B',
    answers: {
      exposed_wire: 'yes' as const,
      smoke_or_sparks: 'yes' as const,
      equipment: 'Ổ cắm âm tường phòng Lab',
    },
  }

  const idempotencyKey2 = crypto.randomUUID()
  const createRes2 = await reporterApi.createIncident(validElecInput, idempotencyKey2, reporter.id)
  check('N6-W06: Bước 1 tạo incident thành công trước khi upload file', createRes2.status === 201 && createRes2.data.version === 1)
  const incident2 = createRes2.data

  let currentVersion = incident2.version

  // File 1: PDF hợp lệ (100 bytes)
  const file1 = {
    filename: 'bien_ban_hien_truong.pdf',
    sizeBytes: 1024 * 100,
    mimeType: 'application/pdf',
    signature: [37, 80, 68, 70, 45], // %PDF-
  }
  const att1 = await reporterApi.uploadAttachment(incident2.id, file1, currentVersion, reporter.id)
  check('N6-W06: Upload tệp 1 thành công với expected_version = 1', att1.incident_version === 2 && att1.original_name === file1.filename)
  currentVersion = att1.incident_version

  // File 2: PNG hợp lệ
  const file2 = {
    filename: 'anh_chup_o_cam.png',
    sizeBytes: 1024 * 500,
    mimeType: 'image/png',
    signature: [137, 80, 78, 71, 13, 10, 26, 10], // PNG magic
  }
  const att2 = await reporterApi.uploadAttachment(incident2.id, file2, currentVersion, reporter.id)
  check('N6-W06: Upload tệp 2 thành công với expected_version = 2', att2.incident_version === 3 && att2.original_name === file2.filename)
  currentVersion = att2.incident_version

  // Kiểm tra version conflict khi gửi expected_version cũ
  await rejectsCode(
    'N6-W06: Upload với expected_version cũ bị từ chối HTTP 409 version_conflict',
    () => reporterApi.uploadAttachment(incident2.id, file1, 1, reporter.id),
    'version_conflict'
  )

  // ==========================================
  // 3. HIỂN THỊ LỖI RIÊNG TỪNG TỆP
  // ==========================================
  // 3.1 Tệp vượt quá 10MB (11MB)
  const fileTooLarge = {
    filename: 'video_nang_11mb.pdf',
    sizeBytes: 11 * 1024 * 1024,
    mimeType: 'application/pdf',
    signature: [37, 80, 68, 70, 45],
  }
  await rejectsCode(
    'N6-W06: Tệp vượt quá 10MB bị từ chối với mã file_too_large',
    () => reporterApi.uploadAttachment(incident2.id, fileTooLarge, currentVersion, reporter.id),
    'file_too_large'
  )

  // 3.2 Tệp sai MIME không hỗ trợ (.exe)
  const fileBadMime = {
    filename: 'virus.exe',
    sizeBytes: 50 * 1024,
    mimeType: 'application/x-msdownload',
    signature: [77, 90],
  }
  await rejectsCode(
    'N6-W06: Tệp sai định dạng bị từ chối với mã unsupported_media_type',
    () => reporterApi.uploadAttachment(incident2.id, fileBadMime, currentVersion, reporter.id),
    'unsupported_media_type'
  )

  // 3.3 Tệp giả mạo chữ ký (nội dung rác)
  const fileFakeSignature = {
    filename: 'fake_file.pdf',
    sizeBytes: 50 * 1024,
    mimeType: 'application/pdf',
    signature: [0, 0, 0, 0, 0],
  }
  await rejectsCode(
    'N6-W06: Tệp sai chữ ký nội dung bị từ chối với mã unsupported_media_type',
    () => reporterApi.uploadAttachment(incident2.id, fileFakeSignature, currentVersion, reporter.id),
    'unsupported_media_type'
  )

  // ==========================================
  // 4. TIÊU CHÍ HOÀN THÀNH:
  // "Incident thành công nhưng file lỗi được báo đúng, không nói thành công toàn bộ."
  // ==========================================
  const phishingInput = {
    category: 'phishing' as const,
    title: 'Email giả mạo phòng Đào tạo yêu cầu đổi mật khẩu',
    description: 'Email gửi từ địa chỉ lạ daotao-usth.net yêu cầu đăng nhập tài khoản sinh viên.',
    building: 'Khu vực ngoài trời',
    answers: {
      interaction: 'clicked_link' as const,
      channel: 'email' as const,
      sender_text: 'support@daotao-usth.net',
    },
  }

  const keyPhishing = crypto.randomUUID()
  const createPhishingRes = await reporterApi.createIncident(phishingInput, keyPhishing, reporter.id)
  const phishIncident = createPhishingRes.data
  check('N6-W06: Tạo sự cố Phishing thành công', createPhishingRes.status === 201 && phishIncident.id.length > 0)

  // Giả lập luồng upload tuần tự với 1 file thành công và 1 file lỗi
  const queueToUpload = [
    {
      name: 'email_screen.png',
      sizeBytes: 500 * 1024,
      mimeType: 'image/png',
      signature: [137, 80, 78, 71, 13, 10, 26, 10],
    },
    {
      name: 'dump_qua_lon.pdf',
      sizeBytes: 15 * 1024 * 1024, // >10MB
      mimeType: 'application/pdf',
      signature: [37, 80, 68, 70, 45],
    },
  ]

  const uploadResults: Array<{ name: string; success: boolean; errorCode?: string; reason?: string }> = []
  let phishVersion = phishIncident.version

  for (const item of queueToUpload) {
    try {
      const att = await reporterApi.uploadAttachment(
        phishIncident.id,
        { filename: item.name, sizeBytes: item.sizeBytes, mimeType: item.mimeType, signature: item.signature },
        phishVersion,
        reporter.id
      )
      phishVersion = att.incident_version
      uploadResults.push({ name: item.name, success: true })
    } catch (err: unknown) {
      const cErr = err as ContractError
      uploadResults.push({
        name: item.name,
        success: false,
        errorCode: cErr.error.code,
        reason: cErr.error.details?.[0]?.reason || cErr.error.message,
      })
    }
  }

  // Tiêu chí kiểm tra kết quả:
  // 1) Sự cố vẫn tồn tại trên server (không bị xóa / rollback khi file lỗi)
  const verifiedIncident = await reporterApi.getIncidentDetail(phishIncident.id, reporter.id)
  check('N6-W06: Incident vẫn tồn tại thành công trên hệ thống sau khi có file upload lỗi', verifiedIncident.id === phishIncident.id)

  // 2) File 1 thành công
  check('N6-W06: File hợp lệ được ghi nhận thành công', uploadResults[0].success === true)

  // 3) File 2 báo lỗi riêng biệt chính xác (file_too_large)
  check('N6-W06: File lỗi được báo đúng mã lỗi riêng (file_too_large)',
    uploadResults[1].success === false && uploadResults[1].errorCode === 'file_too_large' && !!uploadResults[1].reason
  )

  // 4) Logic phân loại trạng thái tổng thể: PHẢI là "partial_success", KHÔNG ĐƯỢC báo "all_success"
  const failedCount = uploadResults.filter((r) => !r.success).length
  const isOverallAllSuccess = failedCount === 0
  const isOverallPartialSuccess = failedCount > 0 && verifiedIncident.id !== ''

  check('N6-W06: TIÊU CHÍ HOÀN THÀNH - Không nói thành công toàn bộ khi có file lỗi', !isOverallAllSuccess)
  check('N6-W06: TIÊU CHÍ HOÀN THÀNH - Báo đúng trạng thái có lỗi tệp đính kèm riêng', isOverallPartialSuccess)

  // ==========================================
  // 5. DEMO CLIENT & TRUY CẬP DANH SÁCH
  // ==========================================
  demoClient.logout()
  await demoClient.login(reporter.email)
  const clientCreate = await demoClient.createIncident(
    {
      category: 'water_leak',
      title: 'Nước nhỏ giọt tại nhà vệ sinh Tòa C',
      description: 'Vòi nước bị rò rỉ liên tục cả ngày đêm tại tầng 1.',
      building: 'Tòa C',
      answers: { leak_amount: 'small', near_electricity: 'no', slip_risk: false },
    },
    crypto.randomUUID()
  )
  check('N6-W06: demoClient.createIncident hoạt động đúng hợp đồng', clientCreate.status === 201)

  const ownList = await demoClient.reporterIncidents()
  check('N6-W06: Sự cố mới tạo xuất hiện trong danh sách báo cáo của người dùng', ownList.some((i) => i.id === clientCreate.data.id))

  demoClient.logout()

  console.log('==================================================================')
  console.log(`ĐẠT TOÀN BỘ ${passed} KIỂM TRA CHO TASK N6-W06 CỦA ĐỖ TUẤN KIỆT!`)
  console.log('==================================================================')
}

main().catch((err) => {
  console.error('LỖI KIỂM TRA N6-W06:', err)
  process.exitCode = 1
})
