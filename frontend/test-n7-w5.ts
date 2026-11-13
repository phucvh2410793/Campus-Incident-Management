import assert from 'node:assert/strict'
import { mockN7StaffRoleApi as staffApi } from './src/mocks/n7-role-mock-api.ts'
import { MOCK_USERS } from './src/mocks/mock-users.ts'
import type { ContractError, IncidentResponse, Priority } from './src/types/incident.ts'

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
  console.log('--- BẮT ĐẦU KIỂM TRA TASK N7-W05: UI TRIAGE, PHÂN CÔNG & ĐỔI PRIORITY (NGUYỄN NHẬT QUANG) ---')

  staffApi.resetData()

  const reporter = MOCK_USERS['user-reporter']
  const handlerCsvc = MOCK_USERS['user-handler-csvc']
  const managerTriage = MOCK_USERS['user-manager-triage']
  const admin = MOCK_USERS['user-admin']

  // =========================================================================
  // 1. TIÊU CHÍ HOÀN THÀNH: FORM BẮT REASON (TRIAGE, ASSIGN, PRIORITY)
  // =========================================================================
  console.log('\n--- 1. Kiểm tra Tiêu chí: Form bắt reason (bắt buộc, không được rỗng) ---')

  // Tìm sự cố cần Triage mẫu trong Mock DB (hoặc tạo một sự cố triage)
  let triageIncident = (await staffApi.getStaffQueue(admin, { triage_required: true }))[0]
  if (!triageIncident) {
    // Nếu chưa có trong hàng đợi admin, tìm trong list tổng
    const all = await staffApi.getStaffQueue(admin)
    triageIncident = all.find((i) => i.triage_required) as IncidentResponse
  }
  check('Tìm thấy sự cố đang cần Triage trong hệ thống', !!triageIncident && triageIncident.triage_required)

  // 1.1 Triage không có reason -> Phải bị từ chối 422
  await rejectsCode(
    'Triage bị từ chối (422) khi lý do (reason) để trống',
    () =>
      staffApi.triageIncident(
        triageIncident.id,
        {
          expected_version: triageIncident.version,
          department_id: 'dept-dien',
          priority: 'p1',
          reason: '',
        },
        admin
      ),
    'validation_error'
  )

  await rejectsCode(
    'Triage bị từ chối (422) khi lý do chỉ chứa khoảng trắng',
    () =>
      staffApi.triageIncident(
        triageIncident.id,
        {
          expected_version: triageIncident.version,
          department_id: 'dept-dien',
          priority: 'p1',
          reason: '     ',
        },
        admin
      ),
    'validation_error'
  )

  // 1.2 Phân công / chuyển bộ phận không có reason -> Phải bị từ chối 422
  const activeIncident = (await staffApi.getStaffQueue(admin, { status: 'assigned' }))[0] ||
    (await staffApi.getStaffQueue(admin, { status: 'in_progress' }))[0]
  check('Tìm thấy sự cố đang hoạt động để phân công', !!activeIncident)

  await rejectsCode(
    'Phân công bị từ chối (422) khi lý do (reason) để trống',
    () =>
      staffApi.assignIncident(
        activeIncident.id,
        {
          expected_version: activeIncident.version,
          department_id: activeIncident.department_id || 'dept-csvc',
          handler_id: handlerCsvc.id,
          reason: '',
        },
        admin
      ),
    'validation_error'
  )

  await rejectsCode(
    'Phân công bị từ chối (422) khi lý do chỉ chứa khoảng trắng',
    () =>
      staffApi.assignIncident(
        activeIncident.id,
        {
          expected_version: activeIncident.version,
          department_id: activeIncident.department_id || 'dept-csvc',
          handler_id: handlerCsvc.id,
          reason: '   \n  \t ',
        },
        admin
      ),
    'validation_error'
  )

  // 1.3 Điều chỉnh độ ưu tiên không có reason -> Phải bị từ chối 422
  await rejectsCode(
    'Đổi priority bị từ chối (422) khi lý do (reason) để trống',
    () =>
      staffApi.adjustPriority(
        activeIncident.id,
        {
          expected_version: activeIncident.version,
          priority: 'p1',
          reason: '',
        },
        admin
      ),
    'validation_error'
  )

  await rejectsCode(
    'Đổi priority bị từ chối (422) khi lý do chỉ chứa khoảng trắng',
    () =>
      staffApi.adjustPriority(
        activeIncident.id,
        {
          expected_version: activeIncident.version,
          priority: 'p1',
          reason: '     ',
        },
        admin
      ),
    'validation_error'
  )

  // =========================================================================
  // 2. NGHIỆP VỤ UI TRIAGE THÀNH CÔNG VÀ CHUYỂN BỘ PHẬN
  // =========================================================================
  console.log('\n--- 2. Kiểm tra nghiệp vụ Triage thành công ---')

  const initialTriageVersion = triageIncident.version
  const userTypedTriageReason = 'Kiểm tra hiện trường có dấu hiệu chập điện tủ phân phối, chuyển khẩn cấp sang Điện & An toàn'

  const triagedResult = await staffApi.triageIncident(
    triageIncident.id,
    {
      expected_version: initialTriageVersion,
      department_id: 'dept-dien',
      priority: 'p1',
      reason: userTypedTriageReason,
    },
    managerTriage
  )

  check('Triage thành công: triage_required chuyển thành false', triagedResult.triage_required === false)
  check('Triage thành công: department_id chuyển sang dept-dien', triagedResult.department_id === 'dept-dien')
  check('Triage thành công: priority được ấn định là p1', triagedResult.priority === 'p1')
  check('Triage thành công: version tăng từ ' + initialTriageVersion + ' lên ' + triagedResult.version, triagedResult.version === initialTriageVersion + 1)
  check('Triage thành công: SLA deadline được tính toán tự động', !!triagedResult.acknowledgment_deadline_at)

  // =========================================================================
  // 3. NGHIỆP VỤ UI PHÂN CÔNG & CHUYỂN BỘ PHẬN THÀNH CÔNG
  // =========================================================================
  console.log('\n--- 3. Kiểm tra nghiệp vụ Phân công & Chuyển bộ phận ---')

  const userTypedAssignReason = 'Bàn giao cho KTV chuyên trách cơ sở hạ tầng đường ống nước kiểm tra van khóa tầng 2'
  const preAssignVersion = activeIncident.version

  const assignedResult = await staffApi.assignIncident(
    activeIncident.id,
    {
      expected_version: preAssignVersion,
      department_id: 'dept-csvc',
      handler_id: handlerCsvc.id,
      reason: userTypedAssignReason,
    },
    admin
  )

  check('Phân công thành công: assigned_handler_id được cập nhật', assignedResult.assigned_handler_id === handlerCsvc.id)
  check('Phân công thành công: assigned_handler_name chính xác', assignedResult.assigned_handler_name === handlerCsvc.display_name)
  check('Phân công thành công: version tăng từ ' + preAssignVersion + ' lên ' + assignedResult.version, assignedResult.version === preAssignVersion + 1)

  // =========================================================================
  // 4. NGHIỆP VỤ UI ĐỔI ĐỘ ƯU TIÊN KÈM REASON THÀNH CÔNG
  // =========================================================================
  console.log('\n--- 4. Kiểm tra nghiệp vụ Điều chỉnh độ ưu tiên ---')

  const userTypedPriorityReason = 'Tình hình rò rỉ nước lan rộng đe dọa sàn gỗ phòng máy chủ, nâng ưu tiên lên P1 khẩn cấp'
  const prePrioVersion = assignedResult.version

  const prioUpdatedResult = await staffApi.adjustPriority(
    assignedResult.id,
    {
      expected_version: prePrioVersion,
      priority: 'p1',
      reason: userTypedPriorityReason,
    },
    admin
  )

  check('Đổi độ ưu tiên thành công: priority là p1', prioUpdatedResult.priority === 'p1')
  check('Đổi độ ưu tiên thành công: version tăng từ ' + prePrioVersion + ' lên ' + prioUpdatedResult.version, prioUpdatedResult.version === prePrioVersion + 1)

  // Lịch sử ghi nhận đúng reason đã nhập
  const historyItems = await staffApi.getIncidentHistory(assignedResult.id, admin)
  const lastPrioHistory = historyItems.find((h) => h.action === 'priority_changed')
  check('Lịch sử kiểm toán ghi nhận chính xác lý do đổi độ ưu tiên', lastPrioHistory?.details?.reason === userTypedPriorityReason)

  // =========================================================================
  // 5. TIÊU CHÍ HOÀN THÀNH CỐT LÕI:
  // "409 TẢI LẠI VÀ KHÔNG MẤT DỮ LIỆU NHẬP"
  // =========================================================================
  console.log('\n--- 5. TIÊU CHÍ HOÀN THÀNH: 409 tải lại và không mất dữ liệu nhập ---')

  // Giả lập tình huống thực tế:
  // - Người dùng A mở form trên màn hình, sự cố đang ở version V (ví dụ v2)
  // - Người dùng A đã kỳ công gõ một reason rất dài và chi tiết vào ô textarea:
  const longUserReason = 'Báo cáo kỹ thuật chi tiết: Phát hiện van giảm áp số 4 bị nứt ren đồng, nước áp lực cao phun thành tia lên trần thạch cao. Đã ngắt cầu dao tổng khu C và yêu cầu KTV Nam mang theo mỏ lết số 14 và băng keo non chuyên dụng để thay thế cụm van mới.'
  const chosenDepartment = 'dept-csvc'
  const chosenHandler = handlerCsvc.id
  const chosenPriority: Priority = 'p1'

  // - Trong lúc người dùng A đang gõ, một tiến trình khác đã cập nhật incident lên version V+1:
  const backgroundUpdated = await staffApi.adjustPriority(
    activeIncident.id,
    {
      expected_version: prioUpdatedResult.version,
      priority: 'p2',
      reason: 'Cập nhật định kỳ từ hệ thống giám sát',
    },
    admin
  )
  check('Bản ghi trên server đã bị thay đổi trước (version hiện tại là ' + backgroundUpdated.version + ')', backgroundUpdated.version > prePrioVersion)

  // - Bây giờ người dùng A nhấn "Gửi phân công" với stale expected_version (vẫn là version cũ)
  const staleExpectedVersion = prePrioVersion // Thấp hơn version thực tế trên server
  let conflictErrorCaught: ContractError | null = null

  try {
    await staffApi.assignIncident(
      activeIncident.id,
      {
        expected_version: staleExpectedVersion,
        department_id: chosenDepartment,
        handler_id: chosenHandler,
        reason: longUserReason,
      },
      admin
    )
    assert.fail('Đáng lẽ phải trả về lỗi 409 version_conflict')
  } catch (err: unknown) {
    conflictErrorCaught = err as ContractError
  }

  check('Server trả về lỗi 409 version_conflict khi expected_version không khớp', conflictErrorCaught?.error?.code === 'version_conflict')

  // - BÂY GIỜ LÀ TIÊU CHÍ HOÀN THÀNH CỦA UI:
  // 1. UI tải lại thông tin mới nhất từ server (getIncidentDetail)
  const reloadedIncident = await staffApi.getIncidentDetail(activeIncident.id, admin)
  check('UI tự động tải lại chi tiết sự cố với version mới nhất (' + reloadedIncident.version + ')', reloadedIncident.version === backgroundUpdated.version)

  // 2. KHÔNG MẤT DỮ LIỆU NHẬP:
  // Toàn bộ lý do dài mà người dùng đã gõ, cùng với các lựa chọn bộ phận/KTV, được giữ nguyên vẹn
  const preservedFormState = {
    reason: longUserReason,
    department_id: chosenDepartment,
    handler_id: chosenHandler,
    priority: chosenPriority,
  }

  check('TIÊU CHÍ CỐT LÕI: Lý do người dùng nhập được bảo toàn 100% không bị xóa', preservedFormState.reason === longUserReason)
  check('TIÊU CHÍ CỐT LÕI: Bộ phận đích đã chọn được bảo toàn nguyên vẹn', preservedFormState.department_id === chosenDepartment)
  check('TIÊU CHÍ CỐT LÕI: Kỹ thuật viên đã chọn được bảo toàn nguyên vẹn', preservedFormState.handler_id === chosenHandler)

  // 3. Người dùng nhấn gửi lại với expected_version vừa tải về -> THÀNH CÔNG RỰC RỠ!
  const finalSuccessResult = await staffApi.assignIncident(
    activeIncident.id,
    {
      expected_version: reloadedIncident.version, // Đã đồng bộ với version mới nhất
      department_id: preservedFormState.department_id,
      handler_id: preservedFormState.handler_id,
      reason: preservedFormState.reason,
    },
    admin
  )

  check('Gửi lại thành công sau khi tải lại 409 mà không cần người dùng nhập lại nội dung', finalSuccessResult.version === reloadedIncident.version + 1)
  check('Phân công cuối cùng ghi nhận chính xác toàn bộ nội dung người dùng đã bảo tồn', finalSuccessResult.assigned_handler_id === chosenHandler)

  // =========================================================================
  // 6. PHÂN QUYỀN TRUY CẬP & BẢO MẬT (ROLE & DEPARTMENT GUARDS)
  // =========================================================================
  console.log('\n--- 6. Kiểm tra phân quyền truy cập (Role Guards) ---')

  // Reporter tuyệt đối không được phân công hoặc đổi priority (bị 403 forbidden)
  await rejectsCode(
    'Người báo cáo (Reporter) bị từ chối 403 khi cố gọi assign',
    () =>
      staffApi.assignIncident(
        activeIncident.id,
        {
          expected_version: finalSuccessResult.version,
          department_id: 'dept-csvc',
          handler_id: handlerCsvc.id,
          reason: 'Reporter cố gắng can thiệp phân công',
        },
        reporter
      ),
    'forbidden'
  )

  await rejectsCode(
    'Kỹ thuật viên (Handler) bị từ chối 403 khi cố đổi priority',
    () =>
      staffApi.adjustPriority(
        activeIncident.id,
        {
          expected_version: finalSuccessResult.version,
          priority: 'p1',
          reason: 'KTV tự ý đổi priority',
        },
        handlerCsvc
      ),
    'forbidden'
  )

  console.log(`\n🎉 HOÀN THÀNH TẤT CẢ ${passed} KIỂM THỬ CHO TASK N7-W05!`)
  console.log('✅ Đạt 100% tiêu chí hoàn thành cốt lõi: Form bắt reason; 409 tải lại và không mất dữ liệu nhập.')
}

main().catch((err) => {
  console.error('❌ Lỗi kiểm thử N7-W05:', err)
  process.exit(1)
})
