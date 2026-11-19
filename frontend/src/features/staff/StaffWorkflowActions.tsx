import { useState, useId, type FormEvent } from 'react'
import type { IncidentResponse, Priority } from '../../types/incident.ts'
import type { UserSummary } from '../../types/auth.ts'
import {
  mockN7StaffRoleApi,
  type PermissionStatus,
  type TriageInput,
  type AssignInput,
  type PriorityInput,
} from '../../mocks/n7-role-mock-api.ts'
import { DEPARTMENTS, MOCK_USERS } from '../../mocks/mock-users.ts'

interface StaffWorkflowActionsProps {
  incident: IncidentResponse
  currentUser: UserSummary
  permissions: PermissionStatus
  onIncidentUpdated: (updated: IncidentResponse) => void
  onReloadIncident: () => Promise<IncidentResponse>
}

type ActionTabKey = 'triage' | 'assign' | 'priority'

export function StaffWorkflowActions({
  incident,
  currentUser,
  permissions,
  onIncidentUpdated,
  onReloadIncident,
}: StaffWorkflowActionsProps) {
  // Mặc định mở tab Triage nếu sự cố cần Triage; nếu không thì mở tab Phân công
  const [activeActionTab, setActiveActionTab] = useState<ActionTabKey>(() =>
    incident.triage_required ? 'triage' : 'assign'
  )

  // Danh sách các bộ phận hợp lệ để chuyển đến (loại trừ dept-triage)
  const validTargetDepartments = Object.values(DEPARTMENTS).filter(
    (dept) => dept.id !== 'dept-triage'
  )

  // =========================================================================
  // STATE CÁC FORM (ĐẢM BẢO BẢO LƯU DỮ LIỆU NHẬP KHI XẢY RA XUNG ĐỘT 409)
  // =========================================================================

  // 1. Form Triage
  const [triageDeptId, setTriageDeptId] = useState<string>(() => {
    if (incident.category === 'electrical_hazard') return 'dept-dien'
    if (incident.category === 'water_leak') return 'dept-csvc'
    if (incident.category === 'phishing') return 'dept-it'
    return 'dept-dien'
  })
  const [triagePriority, setTriagePriority] = useState<Priority>('p2')
  const [triageReason, setTriageReason] = useState<string>('')
  const [triageFieldErrors, setTriageFieldErrors] = useState<{ reason?: string; general?: string }>({})
  const [isSubmittingTriage, setIsSubmittingTriage] = useState(false)

  // 2. Form Phân công & Chuyển bộ phận
  const [assignDeptId, setAssignDeptId] = useState<string>(() =>
    incident.department_id && incident.department_id !== 'dept-triage'
      ? incident.department_id
      : 'dept-csvc'
  )
  const [assignHandlerId, setAssignHandlerId] = useState<string>(() =>
    incident.assigned_handler_id || ''
  )
  const [assignReason, setAssignReason] = useState<string>('')
  const [assignFieldErrors, setAssignFieldErrors] = useState<{ reason?: string; general?: string }>({})
  const [isSubmittingAssign, setIsSubmittingAssign] = useState(false)

  // 3. Form Điều chỉnh độ ưu tiên kèm reason
  const [newPriority, setNewPriority] = useState<Priority>(() => incident.priority || 'p2')
  const [priorityReason, setPriorityReason] = useState<string>('')
  const [priorityFieldErrors, setPriorityFieldErrors] = useState<{ reason?: string; general?: string }>({})
  const [isSubmittingPriority, setIsSubmittingPriority] = useState(false)

  // Thông báo xung đột phiên bản 409 (Optimistic Concurrency Control)
  const [conflictNotice, setConflictNotice] = useState<{
    action: string
    oldVersion: number
    newVersion: number
    message: string
  } | null>(null)

  // Thông báo thành công
  const [successNotice, setSuccessNotice] = useState<string | null>(null)

  const triageReasonId = useId()
  const assignReasonId = useId()
  const priorityReasonId = useId()

  // Tự động cập nhật danh sách KTV khi đổi bộ phận ở form Phân công
  const availableHandlersForDept = Object.values(MOCK_USERS).filter(
    (u) => u.role === 'handler' && u.department_id === assignDeptId && u.is_active
  )

  // =========================================================================
  // XỬ LÝ LỖI 409 VERSION CONFLICT (TIÊU CHÍ HOÀN THÀNH CỐT LÕI)
  // "409 tải lại và không mất dữ liệu nhập"
  // =========================================================================
  const handleCatchError = async (
    actionLabel: string,
    error: unknown,
    setFieldErrors: (errs: { reason?: string; general?: string }) => void
  ) => {
    const errObj = error as { status?: number; error?: { code?: string; message?: string; details?: Array<{ field: string; reason: string }> } }
    const isVersionConflict =
      errObj?.status === 409 ||
      errObj?.error?.code === 'version_conflict' ||
      String(errObj?.error?.message || '').toLowerCase().includes('xung đột phiên bản') ||
      String(errObj?.error?.message || '').toLowerCase().includes('version')

    if (isVersionConflict) {
      // 1. Tải lại phiên bản mới nhất từ server
      const freshIncident = await onReloadIncident()
      onIncidentUpdated(freshIncident)

      // 2. Tiêu chí hoàn thành cốt lõi: TUYỆT ĐỐI KHÔNG LÀM MẤT DỮ LIỆU ĐANG NHẬP
      // Các trường state `triageReason`, `assignReason`, `priorityReason` và các select
      // được giữ nguyên vẹn 100%.
      setConflictNotice({
        action: actionLabel,
        oldVersion: incident.version,
        newVersion: freshIncident.version,
        message: `⚠️ Xung đột phiên bản (HTTP 409): Sự cố vừa được cập nhật trên hệ thống lên phiên bản v${freshIncident.version}. Dữ liệu và lý do bạn vừa nhập đã được bảo lưu đầy đủ. Vui lòng kiểm tra lại thông tin và nhấn gửi lại để hoàn tất.`,
      })
      setFieldErrors({ general: 'Xung đột phiên bản (HTTP 409). Dữ liệu nhập đã được bảo lưu. Vui lòng nhấn gửi lại.' })
      return true
    }

    // Xử lý lỗi validation từ server
    if (errObj?.error?.code === 'validation_error' && errObj.error.details) {
      const reasonErr = errObj.error.details.find((d) => d.field === 'reason' || d.field.includes('reason'))
      if (reasonErr) {
        setFieldErrors({ reason: reasonErr.reason || 'Lý do không hợp lệ.' })
        return false
      }
    }

    setFieldErrors({ general: errObj?.error?.message || 'Có lỗi xảy ra khi thực hiện thao tác.' })
    return false
  }

  // =========================================================================
  // 1. SUBMIT TRIAGE PHÂN LOẠI
  // =========================================================================
  const handleSubmitTriage = async (e: FormEvent, simulateConflictVersion?: number) => {
    e.preventDefault()
    setConflictNotice(null)
    setSuccessNotice(null)

    // Tiêu chí hoàn thành cốt lõi: FORM BẮT REASON
    if (!triageReason.trim()) {
      setTriageFieldErrors({ reason: 'Vui lòng nhập lý do phân loại Triage (bắt buộc).' })
      return
    }
    if (triageReason.trim().length < 5) {
      setTriageFieldErrors({ reason: 'Lý do phân loại cần tối thiểu 5 ký tự.' })
      return
    }
    setTriageFieldErrors({})
    setIsSubmittingTriage(true)

    try {
      const expectedVersion = simulateConflictVersion ?? incident.version
      const input: TriageInput = {
        department_id: triageDeptId,
        priority: triagePriority,
        reason: triageReason.trim(),
        expected_version: expectedVersion,
      }

      const updated = await mockN7StaffRoleApi.triageIncident(incident.id, input, currentUser)
      onIncidentUpdated(updated)
      setSuccessNotice(`✅ Phân loại Triage thành công! Sự cố đã được chuyển sang "${DEPARTMENTS[triageDeptId]?.name}" với độ ưu tiên ${triagePriority?.toUpperCase()} (Phiên bản v${updated.version}).`)
      setTriageReason('')
    } catch (err: unknown) {
      await handleCatchError('Triage phân loại', err, setTriageFieldErrors)
    } finally {
      setIsSubmittingTriage(false)
    }
  }

  // =========================================================================
  // 2. SUBMIT PHÂN CÔNG & CHUYỂN BỘ PHẬN
  // =========================================================================
  const handleSubmitAssign = async (e: FormEvent, simulateConflictVersion?: number) => {
    e.preventDefault()
    setConflictNotice(null)
    setSuccessNotice(null)

    // Tiêu chí hoàn thành cốt lõi: FORM BẮT REASON
    if (!assignReason.trim()) {
      setAssignFieldErrors({ reason: 'Vui lòng nhập lý do phân công / chuyển bộ phận (bắt buộc).' })
      return
    }
    if (assignReason.trim().length < 5) {
      setAssignFieldErrors({ reason: 'Lý do phân công cần tối thiểu 5 ký tự để đảm bảo truy vết kiểm toán.' })
      return
    }
    setAssignFieldErrors({})
    setIsSubmittingAssign(true)

    try {
      const expectedVersion = simulateConflictVersion ?? incident.version
      const input: AssignInput = {
        department_id: assignDeptId,
        handler_id: assignHandlerId || null,
        reason: assignReason.trim(),
        expected_version: expectedVersion,
      }

      const updated = await mockN7StaffRoleApi.assignIncident(incident.id, input, currentUser)
      onIncidentUpdated(updated)
      const assignedHandlerObj = assignHandlerId ? Object.values(MOCK_USERS).find((u) => u.id === assignHandlerId) : null
      const handlerText = assignedHandlerObj ? `cho KTV ${assignedHandlerObj.display_name}` : 'cho toàn bộ phận'
      setSuccessNotice(`✅ Phân công thành công! Sự cố đã được giao đến "${DEPARTMENTS[assignDeptId]?.name}" ${handlerText} (Phiên bản v${updated.version}).`)
      setAssignReason('')
    } catch (err: unknown) {
      await handleCatchError('Phân công & chuyển bộ phận', err, setAssignFieldErrors)
    } finally {
      setIsSubmittingAssign(false)
    }
  }

  // =========================================================================
  // 3. SUBMIT ĐIỀU CHỈNH ĐỘ ƯU TIÊN KÈM REASON
  // =========================================================================
  const handleSubmitPriority = async (e: FormEvent, simulateConflictVersion?: number) => {
    e.preventDefault()
    setConflictNotice(null)
    setSuccessNotice(null)

    // Tiêu chí hoàn thành cốt lõi: FORM BẮT REASON
    if (!priorityReason.trim()) {
      setPriorityFieldErrors({ reason: 'Vui lòng nhập lý do điều chỉnh độ ưu tiên (bắt buộc).' })
      return
    }
    if (priorityReason.trim().length < 5) {
      setPriorityFieldErrors({ reason: 'Lý do điều chỉnh cần tối thiểu 5 ký tự.' })
      return
    }
    setPriorityFieldErrors({})
    setIsSubmittingPriority(true)

    try {
      const expectedVersion = simulateConflictVersion ?? incident.version
      const input: PriorityInput = {
        priority: newPriority,
        reason: priorityReason.trim(),
        expected_version: expectedVersion,
      }

      const updated = await mockN7StaffRoleApi.adjustPriority(incident.id, input, currentUser)
      onIncidentUpdated(updated)
      setSuccessNotice(`✅ Điều chỉnh độ ưu tiên thành công! Sự cố chuyển sang mức ${newPriority?.toUpperCase()}, hạn SLA đã được tính lại từ ngày báo cáo (Phiên bản v${updated.version}).`)
      setPriorityReason('')
    } catch (err: unknown) {
      await handleCatchError('Điều chỉnh độ ưu tiên', err, setPriorityFieldErrors)
    } finally {
      setIsSubmittingPriority(false)
    }
  }

  return (
    <div className="workflow-actions-wrapper">
      {/* CẢNH BÁO NỔI BẬT NẾU SỰ CỐ ĐANG CẦN TRIAGE */}
      {incident.triage_required && (
        <aside className="triage-alert-banner" role="alert" aria-live="polite">
          <div className="triage-alert-content">
            <span className="triage-alert-icon">🚨</span>
            <div>
              <strong>SỰ CỐ ĐANG CẦN PHÂN LOẠI THỦ CÔNG (TRIAGE REQUIRED):</strong>
              <p>
                Sự cố chưa có bộ phận chính thức hoặc độ ưu tiên SLA. Quản lý Triage hoặc Quản trị viên cần thực hiện phân loại, gán mức độ ưu tiên và ghi nhận lý do cụ thể.
              </p>
            </div>
          </div>
          {activeActionTab !== 'triage' && (
            <button
              type="button"
              className="btn btn-sm btn-warning"
              onClick={() => setActiveActionTab('triage')}
            >
              Chuyển đến form Triage ngay →
            </button>
          )}
        </aside>
      )}

      {/* CẢNH BÁO XUNG ĐỘT PHIÊN BẢN (HTTP 409) - TIÊU CHÍ: 409 TẢI LẠI VÀ KHÔNG MẤT DỮ LIỆU NHẬP */}
      {conflictNotice && (
        <div className="workflow-conflict-banner" role="alert" aria-live="assertive">
          <span className="workflow-conflict-banner-icon">⚠️</span>
          <div className="workflow-conflict-banner-content">
            <strong>XUNG ĐỘT PHIÊN BẢN (HTTP 409 CONFLICT) ĐÃ ĐƯỢC XỬ LÝ:</strong>
            <p>{conflictNotice.message}</p>
            <div className="workflow-conflict-note">
              <span>🔒 <strong>Bảo toàn dữ liệu:</strong> Toàn bộ nội dung lý do bạn đã nhập vẫn đang được giữ nguyên trong ô bên dưới. Hãy kiểm tra lại và nhấn gửi lại.</span>
            </div>
          </div>
        </div>
      )}

      {/* THÔNG BÁO THÀNH CÔNG */}
      {successNotice && (
        <div className="workflow-success-banner" role="status">
          <span>{successNotice}</span>
          <button type="button" className="btn-close-notice" onClick={() => setSuccessNotice(null)}>✕</button>
        </div>
      )}

      {/* SUB-NAV CHO 3 THAO TÁC CỐT LÕI */}
      <div className="workflow-subnav-pills" role="tablist" aria-label="Các thao tác điều phối sự cố">
        <button
          type="button"
          role="tab"
          aria-selected={activeActionTab === 'triage'}
          className={`workflow-subnav-pill ${activeActionTab === 'triage' ? 'active' : ''}`}
          onClick={() => setActiveActionTab('triage')}
        >
          ⚡ Triage phân loại {incident.triage_required && <span className="pill-badge-warning">Cần xử lý</span>}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeActionTab === 'assign'}
          className={`workflow-subnav-pill ${activeActionTab === 'assign' ? 'active' : ''}`}
          onClick={() => setActiveActionTab('assign')}
        >
          👥 Phân công / Chuyển bộ phận
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeActionTab === 'priority'}
          className={`workflow-subnav-pill ${activeActionTab === 'priority' ? 'active' : ''}`}
          onClick={() => setActiveActionTab('priority')}
        >
          ⏱️ Đổi độ ưu tiên kèm Reason
        </button>
      </div>

      {/* =================================================================== */}
      {/* 1. FORM TRIAGE PHÂN LOẠI THỦ CÔNG                                    */}
      {/* =================================================================== */}
      {activeActionTab === 'triage' && (
        <div className="workflow-action-card gui-fade-transition">
          <div className="workflow-action-header">
            <div>
              <h4 className="workflow-action-title">⚡ Phân loại Triage sự cố</h4>
              <p className="workflow-action-subtitle">
                Chuyển sự cố ra khỏi Hàng đợi Triage, chỉ định bộ phận xử lý và ấn định mức độ ưu tiên ban đầu.
              </p>
            </div>
            <span className="workflow-version-badge" title="Mã phiên bản hiện tại trên server">
              Phiên bản hiện tại: <strong>v{incident.version}</strong>
            </span>
          </div>

          {!permissions.isAdmin && (!permissions.isDepartmentManager || currentUser.department_id !== 'dept-triage') && (
            <div className="alert alert-warning" style={{ margin: '1rem 0' }}>
              🔒 <em>Chỉ Quản trị viên hệ thống hoặc Quản lý Hàng đợi Triage mới có thẩm quyền phân loại Triage.</em>
            </div>
          )}

          <form className="workflow-form" onSubmit={(e) => handleSubmitTriage(e)}>
            <div className="workflow-form-grid">
              <div className="workflow-field-group">
                <label className="workflow-field-label" htmlFor="triage-dept-select">
                  Bộ phận phụ trách mới <span className="workflow-field-label-required">(*)</span>
                </label>
                <select
                  id="triage-dept-select"
                  className="workflow-input-select"
                  value={triageDeptId}
                  onChange={(e) => setTriageDeptId(e.target.value)}
                >
                  {validTargetDepartments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name} ({dept.code}) — {dept.description}
                    </option>
                  ))}
                </select>
              </div>

              <div className="workflow-field-group">
                <label className="workflow-field-label" htmlFor="triage-prio-select">
                  Mức độ ưu tiên ấn định <span className="workflow-field-label-required">(*)</span>
                </label>
                <select
                  id="triage-prio-select"
                  className="workflow-input-select"
                  value={triagePriority || 'p2'}
                  onChange={(e) => setTriagePriority(e.target.value as Priority)}
                >
                  <option value="p1">P1 - Khẩn cấp (Hạn tiếp nhận: 15 phút)</option>
                  <option value="p2">P2 - Cao (Hạn tiếp nhận: 2 giờ)</option>
                  <option value="p3">P3 - Tiêu chuẩn (Hạn tiếp nhận: 8 giờ)</option>
                </select>
              </div>

              <div className="workflow-field-group workflow-field-wide">
                <label className="workflow-field-label" htmlFor={triageReasonId}>
                  Lý do phân loại Triage <span className="workflow-field-label-required">(*) Bắt buộc</span>
                </label>
                <textarea
                  id={triageReasonId}
                  className={`workflow-textarea ${triageFieldErrors.reason ? 'has-error' : ''}`}
                  rows={3}
                  placeholder="Nhập chi tiết căn cứ phân loại: đánh giá mức độ rủi ro, chuyển sang bộ phận phụ trách phù hợp..."
                  value={triageReason}
                  onChange={(e) => {
                    setTriageReason(e.target.value)
                    if (triageFieldErrors.reason) setTriageFieldErrors({})
                  }}
                  aria-invalid={Boolean(triageFieldErrors.reason)}
                  aria-describedby={triageFieldErrors.reason ? 'triage-reason-error' : undefined}
                />
                <div className="workflow-field-help">
                  {triageFieldErrors.reason ? (
                    <span className="workflow-error-text" id="triage-reason-error">
                      ⚠️ {triageFieldErrors.reason}
                    </span>
                  ) : (
                    <span className="workflow-char-counter">
                      {triageReason.length} ký tự (tối thiểu 5 ký tự)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {triageFieldErrors.general && (
              <div className="workflow-error-banner" role="alert">
                ⚠️ {triageFieldErrors.general}
              </div>
            )}

            <div className="workflow-action-footer">
              <div className="workflow-footer-left">
                {/* NÚT THỬ NGHIỆM GIẢ LẬP XUNG ĐỘT 409 DÀNH CHO REVIEW / TEST */}
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-simulate-conflict"
                  title="Gửi kèm expected_version cũ để mô phỏng HTTP 409 Version Conflict và chứng minh dữ liệu nhập không bị mất"
                  onClick={(e) => handleSubmitTriage(e, incident.version - 1)}
                  disabled={isSubmittingTriage}
                >
                  ⚡ Giả lập xung đột 409 (Test kiểm thử)
                </button>
              </div>

              <div className="workflow-footer-right">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmittingTriage}
                >
                  {isSubmittingTriage ? 'Đang phân loại…' : '⚡ Hoàn tất Triage & Chuyển bộ phận'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* =================================================================== */}
      {/* 2. FORM PHÂN CÔNG & CHUYỂN BỘ PHẬN                                  */}
      {/* =================================================================== */}
      {activeActionTab === 'assign' && (
        <div className="workflow-action-card gui-fade-transition">
          <div className="workflow-action-header">
            <div>
              <h4 className="workflow-action-title">👥 Phân công &amp; Chuyển giao bộ phận</h4>
              <p className="workflow-action-subtitle">
                Chỉ định kỹ thuật viên trực tiếp xử lý hoặc chuyển quyền phụ trách sang bộ phận chuyên môn khác.
              </p>
            </div>
            <span className="workflow-version-badge" title="Mã phiên bản hiện tại trên server">
              Phiên bản hiện tại: <strong>v{incident.version}</strong>
            </span>
          </div>

          {!permissions.canAssign && (
            <div className="alert alert-warning" style={{ margin: '1rem 0' }}>
              🔒 <em>Chỉ Quản lý bộ phận hoặc Quản trị viên mới có thẩm quyền phân công và chuyển bộ phận.</em>
            </div>
          )}

          <form className="workflow-form" onSubmit={(e) => handleSubmitAssign(e)}>
            <div className="workflow-form-grid">
              <div className="workflow-field-group">
                <label className="workflow-field-label" htmlFor="assign-dept-select">
                  Bộ phận tiếp nhận <span className="workflow-field-label-required">(*)</span>
                </label>
                <select
                  id="assign-dept-select"
                  className="workflow-input-select"
                  value={assignDeptId}
                  onChange={(e) => {
                    const nextDept = e.target.value
                    setAssignDeptId(nextDept)
                    const nextHandlers = Object.values(MOCK_USERS).filter(
                      (u) => u.role === 'handler' && u.department_id === nextDept && u.is_active
                    )
                    if (assignHandlerId && !nextHandlers.some((h) => h.id === assignHandlerId)) {
                      setAssignHandlerId('')
                    }
                  }}
                  disabled={!permissions.canAssign}
                >
                  {validTargetDepartments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name} ({dept.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="workflow-field-group">
                <label className="workflow-field-label" htmlFor="assign-handler-select">
                  Kỹ thuật viên chỉ định xử lý (Handler)
                </label>
                <select
                  id="assign-handler-select"
                  className="workflow-input-select"
                  value={assignHandlerId}
                  onChange={(e) => setAssignHandlerId(e.target.value)}
                  disabled={!permissions.canAssign}
                >
                  <option value="">-- Chưa chỉ định (Giao cho toàn bộ phận) --</option>
                  {availableHandlersForDept.map((handler) => (
                    <option key={handler.id} value={handler.id}>
                      {handler.display_name} ({handler.email})
                    </option>
                  ))}
                </select>
                {availableHandlersForDept.length === 0 && (
                  <span className="workflow-hint-text">
                    Bộ phận này chưa có KTV trực tiếp; sự cố sẽ được bàn giao chung cho trưởng ban điều phối.
                  </span>
                )}
              </div>

              <div className="workflow-field-group workflow-field-wide">
                <label className="workflow-field-label" htmlFor={assignReasonId}>
                  Lý do phân công / chuyển giao <span className="workflow-field-label-required">(*) Bắt buộc</span>
                </label>
                <textarea
                  id={assignReasonId}
                  className={`workflow-textarea ${assignFieldErrors.reason ? 'has-error' : ''}`}
                  rows={3}
                  placeholder="Nhập lý do cụ thể: phân công đúng chuyên môn, chuyển giao ca trực, điều phối lại..."
                  value={assignReason}
                  onChange={(e) => {
                    setAssignReason(e.target.value)
                    if (assignFieldErrors.reason) setAssignFieldErrors({})
                  }}
                  aria-invalid={Boolean(assignFieldErrors.reason)}
                  aria-describedby={assignFieldErrors.reason ? 'assign-reason-error' : undefined}
                  disabled={!permissions.canAssign}
                />
                <div className="workflow-field-help">
                  {assignFieldErrors.reason ? (
                    <span className="workflow-error-text" id="assign-reason-error">
                      ⚠️ {assignFieldErrors.reason}
                    </span>
                  ) : (
                    <span className="workflow-char-counter">
                      {assignReason.length} ký tự (tối thiểu 5 ký tự)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {assignFieldErrors.general && (
              <div className="workflow-error-banner" role="alert">
                ⚠️ {assignFieldErrors.general}
              </div>
            )}

            <div className="workflow-action-footer">
              <div className="workflow-footer-left">
                {/* NÚT THỬ NGHIỆM GIẢ LẬP XUNG ĐỘT 409 */}
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-simulate-conflict"
                  title="Gửi kèm expected_version cũ để mô phỏng HTTP 409 Version Conflict và chứng minh dữ liệu nhập không bị mất"
                  onClick={(e) => handleSubmitAssign(e, incident.version - 1)}
                  disabled={isSubmittingAssign || !permissions.canAssign}
                >
                  ⚡ Giả lập xung đột 409 (Test kiểm thử)
                </button>
              </div>

              <div className="workflow-footer-right">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmittingAssign || !permissions.canAssign}
                >
                  {isSubmittingAssign ? 'Đang phân công…' : '👥 Xác nhận phân công'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* =================================================================== */}
      {/* 3. FORM ĐIỀU CHỈNH ĐỘ ƯU TIÊN KÈM REASON                             */}
      {/* =================================================================== */}
      {activeActionTab === 'priority' && (
        <div className="workflow-action-card gui-fade-transition">
          <div className="workflow-action-header">
            <div>
              <h4 className="workflow-action-title">⏱️ Điều chỉnh mức độ ưu tiên &amp; Thời hạn SLA</h4>
              <p className="workflow-action-subtitle">
                Hệ thống sẽ tự động tính lại mốc thời gian tiếp nhận (SLA deadline) căn cứ từ thời điểm báo cáo ban đầu.
              </p>
            </div>
            <span className="workflow-version-badge" title="Mã phiên bản hiện tại trên server">
              Phiên bản hiện tại: <strong>v{incident.version}</strong>
            </span>
          </div>

          {!permissions.canAdjustPriority && (
            <div className="alert alert-warning" style={{ margin: '1rem 0' }}>
              🔒 <em>Chỉ Quản lý bộ phận hoặc Quản trị viên mới có thẩm quyền điều chỉnh độ ưu tiên.</em>
            </div>
          )}

          <form className="workflow-form" onSubmit={(e) => handleSubmitPriority(e)}>
            <div className="workflow-form-grid">
              <div className="workflow-field-group workflow-field-wide">
                <span className="workflow-field-label">
                  Chọn mức độ ưu tiên mới <span className="workflow-field-label-required">(*)</span>
                </span>
                <div className="priority-select-cards" role="radiogroup" aria-label="Mức độ ưu tiên">
                  <label className={`priority-select-card card-p1 ${newPriority === 'p1' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="priority-choice"
                      value="p1"
                      checked={newPriority === 'p1'}
                      onChange={() => setNewPriority('p1')}
                      disabled={!permissions.canAdjustPriority}
                    />
                    <div className="priority-card-body">
                      <span className="priority-badge-pill p1">P1 - Khẩn cấp</span>
                      <strong className="priority-card-sla">Hạn tiếp nhận: 15 phút</strong>
                      <span className="priority-card-desc">Nguy hiểm trực tiếp, cháy nổ, ngập tràn diện rộng</span>
                    </div>
                  </label>

                  <label className={`priority-select-card card-p2 ${newPriority === 'p2' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="priority-choice"
                      value="p2"
                      checked={newPriority === 'p2'}
                      onChange={() => setNewPriority('p2')}
                      disabled={!permissions.canAdjustPriority}
                    />
                    <div className="priority-card-body">
                      <span className="priority-badge-pill p2">P2 - Cao</span>
                      <strong className="priority-card-sla">Hạn tiếp nhận: 2 giờ</strong>
                      <span className="priority-card-desc">Ảnh hưởng phòng học, thiết bị lab, gián đoạn vừa</span>
                    </div>
                  </label>

                  <label className={`priority-select-card card-p3 ${newPriority === 'p3' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="priority-choice"
                      value="p3"
                      checked={newPriority === 'p3'}
                      onChange={() => setNewPriority('p3')}
                      disabled={!permissions.canAdjustPriority}
                    />
                    <div className="priority-card-body">
                      <span className="priority-badge-pill p3">P3 - Tiêu chuẩn</span>
                      <strong className="priority-card-sla">Hạn tiếp nhận: 8 giờ</strong>
                      <span className="priority-card-desc">Sự cố thông thường, khu vực ít người, bảo trì</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="workflow-field-group workflow-field-wide">
                <label className="workflow-field-label" htmlFor={priorityReasonId}>
                  Lý do điều chỉnh độ ưu tiên <span className="workflow-field-label-required">(*) Bắt buộc</span>
                </label>
                <textarea
                  id={priorityReasonId}
                  className={`workflow-textarea ${priorityFieldErrors.reason ? 'has-error' : ''}`}
                  rows={3}
                  placeholder="Bắt buộc nêu rõ căn cứ tăng hoặc giảm mức độ ưu tiên: mức độ đe dọa thực tế, điều kiện hiện trường..."
                  value={priorityReason}
                  onChange={(e) => {
                    setPriorityReason(e.target.value)
                    if (priorityFieldErrors.reason) setPriorityFieldErrors({})
                  }}
                  aria-invalid={Boolean(priorityFieldErrors.reason)}
                  aria-describedby={priorityFieldErrors.reason ? 'prio-reason-error' : undefined}
                  disabled={!permissions.canAdjustPriority}
                />
                <div className="workflow-field-help">
                  {priorityFieldErrors.reason ? (
                    <span className="workflow-error-text" id="prio-reason-error">
                      ⚠️ {priorityFieldErrors.reason}
                    </span>
                  ) : (
                    <span className="workflow-char-counter">
                      {priorityReason.length} ký tự (tối thiểu 5 ký tự)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {priorityFieldErrors.general && (
              <div className="workflow-error-banner" role="alert">
                ⚠️ {priorityFieldErrors.general}
              </div>
            )}

            <div className="workflow-action-footer">
              <div className="workflow-footer-left">
                {/* NÚT THỬ NGHIỆM GIẢ LẬP XUNG ĐỘT 409 */}
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-simulate-conflict"
                  title="Gửi kèm expected_version cũ để mô phỏng HTTP 409 Version Conflict và chứng minh dữ liệu nhập không bị mất"
                  onClick={(e) => handleSubmitPriority(e, incident.version - 1)}
                  disabled={isSubmittingPriority || !permissions.canAdjustPriority}
                >
                  ⚡ Giả lập xung đột 409 (Test kiểm thử)
                </button>
              </div>

              <div className="workflow-footer-right">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmittingPriority || !permissions.canAdjustPriority}
                >
                  {isSubmittingPriority ? 'Đang cập nhật…' : '⏱️ Cập nhật độ ưu tiên'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
