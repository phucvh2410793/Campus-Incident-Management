import assert from 'node:assert/strict'
import { mockN7StaffRoleApi as staffApi } from './src/mocks/n7-role-mock-api.ts'
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
  console.log('--- BẮT ĐẦU KIỂM TRA TASK N7-W04: CHI TIẾT, TIMELINE, FILE, NOTE & QUYỀN (NGUYỄN NHẬT QUANG) ---')

  staffApi.resetData()

  const reporter = MOCK_USERS['user-reporter']
  const otherReporter = {
    id: '99999999-76fd-4638-a97f-96919031e999',
    display_name: 'Người báo khác',
    email: 'other@usth.edu.vn',
    role: 'reporter' as const,
    department_id: null,
    is_active: true,
  }
  const handlerCsvc = MOCK_USERS['user-handler-csvc']
  const managerCsvc = MOCK_USERS['user-manager-csvc']
  const admin = MOCK_USERS['user-admin']

  // ID sự cố mẫu T02 (thuộc về reporter Lê Minh Tuấn, CSVC phụ trách, có SLA P1, có internal notes và attachments)
  const incidentId = '2ee24992-34d3-4955-9e5c-f7446fd42393'

  // ==========================================
  // 1. CHI TIẾT SỰ CỐ & PHÂN QUYỀN TRUY CẬP (GET /incidents/:id)
  // ==========================================
  const reporterDetail = await staffApi.getIncidentDetail(incidentId, reporter)
  check('N7 W4: Người báo cáo xem được chi tiết sự cố do mình tạo', reporterDetail.id === incidentId)

  // Reporter khác không có quyền xem sự cố này -> bị 404 not_found che giấu sự tồn tại theo contract
  await rejectsCode(
    'N7 W4: Người báo cáo khác không xem được sự cố ngoài quyền (trả 404 not_found)',
    () => staffApi.getIncidentDetail(incidentId, otherReporter),
    'not_found'
  )

  const staffDetail = await staffApi.getIncidentDetail(incidentId, handlerCsvc)
  check('N7 W4: Kỹ thuật viên phụ trách xem được sự cố trong bộ phận/phân công', staffDetail.id === incidentId)

  const adminDetail = await staffApi.getIncidentDetail(incidentId, admin)
  check('N7 W4: Quản trị viên xem được chi tiết mọi sự cố', adminDetail.id === incidentId)

  // ==========================================
  // 2. TIMELINE / LỊCH SỬ XỬ LÝ (GET /incidents/:id/history)
  // Tiêu chí: Reporter view không lẫn các sự kiện nội bộ của Staff
  // ==========================================
  const reporterHistory = await staffApi.getIncidentHistory(incidentId, reporter)
  check('N7 W4: Reporter view - Timeline chỉ chứa các sự kiện công khai (visibility: public)',
    reporterHistory.length > 0 && reporterHistory.every((h) => h.visibility === 'public')
  )
  check('N7 W4: Reporter view - Không bị lẫn sự kiện nội bộ (internal audit/SLA)',
    reporterHistory.every((h) => h.visibility !== 'internal')
  )

  const staffHistory = await staffApi.getIncidentHistory(incidentId, handlerCsvc)
  check('N7 W4: Staff view - Timeline hiển thị toàn bộ sự kiện bao gồm cả nội bộ',
    staffHistory.length >= reporterHistory.length && staffHistory.some((h) => h.visibility === 'internal')
  )

  // ==========================================
  // 3. TỆP BẰNG CHỨNG (GET /incidents/:id/attachments)
  // ==========================================
  const attachments = await staffApi.getIncidentAttachments(incidentId, reporter)
  check('N7 W4: Lấy danh sách tệp bằng chứng đính kèm thành công', attachments.length > 0)
  check('N7 W4: Tệp bằng chứng có đầy đủ thông tin tên, mime type và dung lượng',
    !!attachments[0].original_name && !!attachments[0].content_type && attachments[0].size_bytes > 0
  )

  // ==========================================
  // 4. TRAO ĐỔI & GHI CHÚ NỘI BỘ (GET & POST /incidents/:id/comments)
  // TIÊU CHÍ HOÀN THÀNH:
  // "Reporter view không lẫn staff view, note internal được đánh dấu rõ."
  // ==========================================
  const reporterComments = await staffApi.getIncidentComments(incidentId, reporter)
  check('N7 W4: TIÊU CHÍ HOÀN THÀNH - Reporter view CHỈ nhận ghi chú công khai (public)',
    reporterComments.length > 0 && reporterComments.every((c) => c.visibility === 'public')
  )
  check('N7 W4: TIÊU CHÍ HOÀN THÀNH - Reporter view TUYỆT ĐỐI KHÔNG LẪN bất kỳ note internal nào',
    reporterComments.every((c) => c.visibility !== 'internal')
  )

  const staffComments = await staffApi.getIncidentComments(incidentId, handlerCsvc)
  check('N7 W4: Staff view nhận được đầy đủ cả bình luận công khai và ghi chú nội bộ',
    staffComments.some((c) => c.visibility === 'public') && staffComments.some((c) => c.visibility === 'internal')
  )

  const internalNote = staffComments.find((c) => c.visibility === 'internal')
  check('N7 W4: TIÊU CHÍ HOÀN THÀNH - Note internal được đánh dấu rõ ràng với cờ internal',
    !!internalNote && internalNote.visibility === 'internal'
  )

  // Reporter cố tình gửi ghi chú nội bộ -> BỊ TỪ CHỐI 403 Forbidden
  await rejectsCode(
    'N7 W4: Phân định quyền - Reporter cố tạo note internal bị từ chối 403 forbidden',
    () => staffApi.addComment(incidentId, { body: 'Ghi chú thử nghiệm nội bộ', visibility: 'internal' }, reporter),
    'forbidden'
  )

  // Reporter gửi bình luận công khai -> THÀNH CÔNG
  const newPublicComment = await staffApi.addComment(
    incidentId,
    { body: 'Em đã kê xô hứng nước tạm thời rồi ạ.', visibility: 'public' },
    reporter
  )
  check('N7 W4: Reporter gửi bình luận công khai thành công', newPublicComment.visibility === 'public')

  // Staff gửi ghi chú nội bộ -> THÀNH CÔNG và được đánh dấu rõ ràng
  const newInternalNote = await staffApi.addComment(
    incidentId,
    { body: '[NỘI BỘ KTV] Đã mang van khóa 21mm và cờ lê lên hiện trường.', visibility: 'internal' },
    handlerCsvc
  )
  check('N7 W4: TIÊU CHÍ HOÀN THÀNH - Staff thêm note internal thành công và được đánh dấu rõ ràng',
    newInternalNote.visibility === 'internal' && newInternalNote.author_id === handlerCsvc.id
  )

  // Kiểm tra lại: Reporter vẫn KHÔNG nhìn thấy ghi chú nội bộ vừa tạo!
  const reporterCommentsAfter = await staffApi.getIncidentComments(incidentId, reporter)
  check('N7 W4: TIÊU CHÍ HOÀN THÀNH - Reporter view không thấy note internal mới tạo',
    reporterCommentsAfter.every((c) => c.id !== newInternalNote.id && c.visibility === 'public')
  )

  // Staff view nhìn thấy note internal vừa tạo
  const staffCommentsAfter = await staffApi.getIncidentComments(incidentId, handlerCsvc)
  check('N7 W4: Staff view thấy note internal mới tạo',
    staffCommentsAfter.some((c) => c.id === newInternalNote.id && c.visibility === 'internal')
  )

  // ==========================================
  // 5. MA TRẬN TRẠNG THÁI QUYỀN HẠN (ROLE PERMISSIONS MATRIX)
  // ==========================================
  const permReporter = staffApi.getPermissionMatrix(reporterDetail, reporter)
  check('N7 W4: Trạng thái quyền Reporter - không được xem và không được tạo note internal',
    permReporter.isReporter === true &&
    permReporter.canViewInternalNotes === false &&
    permReporter.canAddInternalNotes === false &&
    permReporter.canAddPublicComments === true &&
    permReporter.canAcknowledge === false &&
    permReporter.canAssign === false
  )

  const permHandler = staffApi.getPermissionMatrix(reporterDetail, handlerCsvc)
  check('N7 W4: Trạng thái quyền Handler - xem/tạo được note internal, có quyền tiếp nhận',
    permHandler.isAssignedHandler === true &&
    permHandler.canViewInternalNotes === true &&
    permHandler.canAddInternalNotes === true &&
    permHandler.canAcknowledge === true
  )

  const permManager = staffApi.getPermissionMatrix(reporterDetail, managerCsvc)
  check('N7 W4: Trạng thái quyền Manager - toàn quyền phân công, đổi ưu tiên trong bộ phận',
    permManager.isDepartmentManager === true &&
    permManager.canAssign === true &&
    permManager.canAdjustPriority === true
  )

  const permAdmin = staffApi.getPermissionMatrix(reporterDetail, admin)
  check('N7 W4: Trạng thái quyền Administrator - toàn quyền trên mọi sự cố',
    permAdmin.isAdmin === true &&
    permAdmin.canViewInternalNotes === true &&
    permAdmin.canAssign === true &&
    permAdmin.canAdjustPriority === true
  )

  console.log('==================================================================')
  console.log(`ĐẠT TOÀN BỘ ${passed} KIỂM TRA CHO TASK N7-W04 CỦA NGUYỄN NHẬT QUANG!`)
  console.log('Tiêu chí: "Reporter view không lẫn staff view, note internal được đánh dấu rõ."')
  console.log('==================================================================')
}

main().catch((err) => {
  console.error('LỖI TEST N7-W04:', err)
  process.exitCode = 1
})
