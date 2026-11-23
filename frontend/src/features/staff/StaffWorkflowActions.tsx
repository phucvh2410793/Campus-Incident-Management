import { useState, useId, type FormEvent } from 'react'
import type { IncidentResponse, Priority } from '../../types/incident.ts'
import type { UserSummary } from '../../types/auth.ts'
import {
  type PermissionStatus,
  type TriageInput,
  type AssignInput,
  type PriorityInput,
  type DispositionInput,
} from '../../mocks/n7-role-mock-api.ts'
import { staffApiAdapter, type AdapterMode } from '../../api/staff-api-adapter.ts'
import { DEPARTMENTS, MOCK_USERS } from '../../mocks/mock-users.ts'

interface StaffWorkflowActionsProps {
  incident: IncidentResponse
  currentUser: UserSummary
  permissions: PermissionStatus
  onIncidentUpdated: (updated: IncidentResponse) => void
  onReloadIncident: () => Promise<IncidentResponse>
}

export type ActionTabKey = 'triage' | 'assign' | 'priority' | 'ack' | 'resolve' | 'close' | 'reopen' | 'disposition'

export function StaffWorkflowActions({
  incident,
  currentUser,
  permissions,
  onIncidentUpdated,
  onReloadIncident,
}: StaffWorkflowActionsProps) {
  // =========================================================================
  // TIÊU CHÍ HOÀN THÀNH N7-W06: "Không hiện hành động sai trạng thái"
  // Xác định các hành động hợp lệ theo đúng máy trạng thái (State Machine Guard)
  // =========================================================================
  const canManage = permissions.isDepartmentManager || permissions.isAdmin
  const canShowTriage = canManage && incident.department_id === 'dept-triage' && incident.triage_required && incident.status === 'reported'
  const canShowAssign = permissions.canAssign && ['reported', 'assigned', 'in_progress'].includes(incident.status)
  const canShowPriority = permissions.canAdjustPriority && ['reported', 'assigned'].includes(incident.status) && !incident.acknowledged_at && !incident.triage_required
  const canShowAck = permissions.canAcknowledge && incident.status === 'assigned'
  const canShowResolve = permissions.canResolve && incident.status === 'in_progress'
  const canShowClose = permissions.canClose && incident.status === 'resolved'
  const canShowReopen = canManage && (incident.status === 'resolved' || incident.status === 'closed')
  const canShowDisposition = canManage && incident.status !== 'closed'

  // Danh sách các tab hợp lệ ở trạng thái hiện tại
  const validActionTabs: ActionTabKey[] = []
  if (canShowTriage) validActionTabs.push('triage')
  if (canShowAck) validActionTabs.push('ack')
  if (canShowResolve) validActionTabs.push('resolve')
  if (canShowClose) validActionTabs.push('close')
  if (canShowReopen) validActionTabs.push('reopen')
  if (canShowAssign) validActionTabs.push('assign')
  if (canShowPriority) validActionTabs.push('priority')
  if (canShowDisposition) validActionTabs.push('disposition')

  // Mặc định tab phù hợp theo trạng thái
  const [activeActionTab, setActiveActionTab] = useState<ActionTabKey>(() => {
    if (canShowTriage) return 'triage'
    if (canShowAck && permissions.canAcknowledge) return 'ack'
    if (canShowResolve && permissions.canResolve) return 'resolve'
    if (canShowClose && permissions.canClose) return 'close'
    if (canShowReopen) return 'reopen'
    if (canShowAssign) return 'assign'
    if (canShowPriority) return 'priority'
    return 'disposition'
  })

  // Đảm bảo tab đang chọn luôn hợp lệ theo trạng thái hiện tại
  const currentTab = validActionTabs.includes(activeActionTab)
    ? activeActionTab
    : validActionTabs[0]

  // Trạng thái chế độ Adapter
  const [adapterMode, setAdapterMode] = useState<AdapterMode>(() => staffApiAdapter.getMode())

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

  // 4. Form Tiếp nhận (Acknowledge)
  const [isSubmittingAck, setIsSubmittingAck] = useState(false)
  const [ackGeneralError, setAckGeneralError] = useState<string | null>(null)

  // 5. Form Giải quyết (Resolve)
  const [resolutionText, setResolutionText] = useState<string>('')
  const [resolveReason, setResolveReason] = useState<string>('')
  const [resolveFieldErrors, setResolveFieldErrors] = useState<{ resolution?: string; general?: string }>({})
  const [isSubmittingResolve, setIsSubmittingResolve] = useState(false)

  // 6. Form Đóng sự cố (Close)
  const [closeReason, setCloseReason] = useState<string>('')
  const [closeFieldErrors, setCloseFieldErrors] = useState<{ reason?: string; general?: string }>({})
  const [isSubmittingClose, setIsSubmittingClose] = useState(false)

  // 7. Form Mở lại sự cố (Reopen)
  const [reopenReason, setReopenReason] = useState<string>('')
  const [reopenFieldErrors, setReopenFieldErrors] = useState<{ reason?: string; general?: string }>({})
  const [isSubmittingReopen, setIsSubmittingReopen] = useState(false)

  // 8. Form Kết thúc hồ sơ (Disposition: Duplicate / Invalid) - N7-W06
  const [dispositionKind, setDispositionKind] = useState<'duplicate' | 'invalid'>('duplicate')
  const [duplicateOfId, setDuplicateOfId] = useState<string>('')
  const [dispositionReason, setDispositionReason] = useState<string>('')
  const [dispositionFieldErrors, setDispositionFieldErrors] = useState<{
    reason?: string
    duplicate_of_id?: string
    general?: string
  }>({})
  const [isSubmittingDisposition, setIsSubmittingDisposition] = useState(false)

  // Thông báo xung đột phiên bản 409
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
  const resolveResolutionId = useId()
  const closeReasonId = useId()
  const reopenReasonId = useId()
  const dispositionKindId = useId()
  const duplicateOfIdInputId = useId()
  const dispositionReasonId = useId()

  const availableHandlersForDept = Object.values(MOCK_USERS).filter(
    (u) => u.role === 'handler' && u.department_id === assignDeptId && u.is_active
  )

  const handleToggleAdapterMode = (mode: AdapterMode) => {
    staffApiAdapter.setMode(mode)
    setAdapterMode(mode)
  }

  // =========================================================================
  // XỬ LÝ LỖI 409 VERSION CONFLICT (TIÊU CHÍ HOÀN THÀNH CỐT LÕI)
  // "409 tải lại và không mất dữ liệu nhập"
  // =========================================================================
  const handleCatchError = async (
    actionLabel: string,
    err: unknown,
    setLocalErrors: (errors: { reason?: string; general?: string }) => void
  ) => {
    const errObj = err as {
      error?: { code?: string; message?: string; details?: Array<{ field: string; reason: string }> }
    }
    const errorCode = errObj?.error?.code
    const errorMsg = errObj?.error?.message || 'Có lỗi xảy ra khi thực hiện thao tác.'

    if (errorCode === 'version_conflict') {
      const oldVer = incident.version
      try {
        const fresh = await onReloadIncident()
        setConflictNotice({
          action: actionLabel,
          oldVersion: oldVer,
          newVersion: fresh.version,
          message: `Sự cố đã được người khác cập nhật lên phiên bản v${fresh.version}. Biểu mẫu đã tự động đồng bộ mã phiên bản mới nhất. Dữ liệu lý do bạn vừa nhập vẫn được giữ nguyên đầy đủ bên dưới để bạn rà soát và gửi lại!`,
        })
      } catch {
        setConflictNotice({
          action: actionLabel,
          oldVersion: oldVer,
          newVersion: oldVer + 1,
          message: 'Phát hiện xung đột phiên bản. Vui lòng thử gửi lại.',
        })
      }
      return
    }

    if (errorCode === 'validation_error' && errObj?.error?.details) {
      const fieldMap: Record<string, string> = {}
      for (const d of errObj.error.details) {
        fieldMap[d.field] = d.reason
      }
      setLocalErrors({
        reason: fieldMap['reason'] || fieldMap['resolution'] || undefined,
        general: errorMsg,
      })
      return
    }

    setLocalErrors({ general: errorMsg })
  }

  // =========================================================================
  // 1. SUBMIT TRIAGE PHÂN LOẠI
  // =========================================================================
  const handleSubmitTriage = async (e: FormEvent, simulateConflictVersion?: number) => {
    e.preventDefault()
    setConflictNotice(null)
    setSuccessNotice(null)

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

      const updated = await staffApiAdapter.triageIncident(incident.id, input, currentUser)
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

      const updated = await staffApiAdapter.assignIncident(incident.id, input, currentUser)
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

      const updated = await staffApiAdapter.adjustPriority(incident.id, input, currentUser)
      onIncidentUpdated(updated)
      setSuccessNotice(`✅ Điều chỉnh độ ưu tiên thành công! Sự cố chuyển sang mức ${newPriority?.toUpperCase()}, hạn SLA đã được tính lại từ ngày báo cáo (Phiên bản v${updated.version}).`)
      setPriorityReason('')
    } catch (err: unknown) {
      await handleCatchError('Điều chỉnh độ ưu tiên', err, setPriorityFieldErrors)
    } finally {
      setIsSubmittingPriority(false)
    }
  }

  // =========================================================================
  // 4. SUBMIT TIẾP NHẬN SỰ CỐ (ACKNOWLEDGE) - ASSIGNED -> IN_PROGRESS
  // =========================================================================
  const handleSubmitAcknowledge = async (e: FormEvent, simulateConflictVersion?: number) => {
    e.preventDefault()
    setConflictNotice(null)
    setSuccessNotice(null)
    setAckGeneralError(null)
    setIsSubmittingAck(true)

    try {
      const expectedVersion = simulateConflictVersion ?? incident.version
      const updated = await staffApiAdapter.acknowledgeIncident(incident.id, expectedVersion, currentUser)
      onIncidentUpdated(updated)
      setSuccessNotice(`✅ Tiếp nhận sự cố thành công! Trạng thái chuyển sang "Đang xử lý" (in_progress), đồng hồ SLA tiếp nhận đã dừng (Phiên bản v${updated.version}).`)
    } catch (err: unknown) {
      await handleCatchError('Tiếp nhận sự cố', err, (errs) => setAckGeneralError(errs.general || null))
    } finally {
      setIsSubmittingAck(false)
    }
  }

  // =========================================================================
  // 5. SUBMIT GIẢI QUYẾT SỰ CỐ (RESOLVE) - IN_PROGRESS -> RESOLVED
  // =========================================================================
  const handleSubmitResolve = async (e: FormEvent, simulateConflictVersion?: number) => {
    e.preventDefault()
    setConflictNotice(null)
    setSuccessNotice(null)

    if (!resolutionText.trim()) {
      setResolveFieldErrors({ resolution: 'Bắt buộc nhập kết quả / nội dung đã xử lý để giải quyết sự cố.' })
      return
    }
    if (resolutionText.trim().length < 5) {
      setResolveFieldErrors({ resolution: 'Nội dung xử lý cần tối thiểu 5 ký tự.' })
      return
    }
    setResolveFieldErrors({})
    setIsSubmittingResolve(true)

    try {
      const expectedVersion = simulateConflictVersion ?? incident.version
      const updated = await staffApiAdapter.resolveIncident(
        incident.id,
        {
          expected_version: expectedVersion,
          resolution: resolutionText.trim(),
          reason: resolveReason.trim() || undefined,
        },
        currentUser
      )
      onIncidentUpdated(updated)
      setSuccessNotice(`✅ Đã ghi nhận giải quyết sự cố thành công! Trạng thái chuyển sang "Đã giải quyết" (resolved) (Phiên bản v${updated.version}).`)
      setResolutionText('')
      setResolveReason('')
    } catch (err: unknown) {
      await handleCatchError('Giải quyết sự cố', err, setResolveFieldErrors)
    } finally {
      setIsSubmittingResolve(false)
    }
  }

  // =========================================================================
  // 6. SUBMIT ĐÓNG SỰ CỐ (CLOSE) - RESOLVED -> CLOSED
  // =========================================================================
  const handleSubmitClose = async (e: FormEvent, simulateConflictVersion?: number) => {
    e.preventDefault()
    setConflictNotice(null)
    setSuccessNotice(null)
    setCloseFieldErrors({})
    setIsSubmittingClose(true)

    try {
      const expectedVersion = simulateConflictVersion ?? incident.version
      const updated = await staffApiAdapter.closeIncident(
        incident.id,
        {
          expected_version: expectedVersion,
          reason: closeReason.trim() || 'Đã kiểm tra, nghiệm thu và hoàn tất đóng sự cố.',
        },
        currentUser
      )
      onIncidentUpdated(updated)
      setSuccessNotice(`✅ Đã nghiệm thu và đóng sự cố thành công! Trạng thái chuyển sang "Đã đóng" (closed) (Phiên bản v${updated.version}).`)
      setCloseReason('')
    } catch (err: unknown) {
      await handleCatchError('Đóng sự cố', err, setCloseFieldErrors)
    } finally {
      setIsSubmittingClose(false)
    }
  }

  // =========================================================================
  // 7. SUBMIT MỞ LẠI SỰ CỐ (REOPEN) - RESOLVED/CLOSED -> IN_PROGRESS
  // =========================================================================
  const handleSubmitReopen = async (e: FormEvent, simulateConflictVersion?: number) => {
    e.preventDefault()
    setConflictNotice(null)
    setSuccessNotice(null)

    if (!reopenReason.trim() || reopenReason.trim().length < 5) {
      setReopenFieldErrors({ reason: 'Bắt buộc nhập lý do mở lại sự cố (tối thiểu 5 ký tự).' })
      return
    }
    setReopenFieldErrors({})
    setIsSubmittingReopen(true)

    try {
      const expectedVersion = simulateConflictVersion ?? incident.version
      const updated = await staffApiAdapter.reopenIncident(
        incident.id,
        {
          expected_version: expectedVersion,
          reason: reopenReason.trim(),
        },
        currentUser
      )
      onIncidentUpdated(updated)
      setSuccessNotice(`✅ Đã mở lại sự cố thành công! Trạng thái chuyển về "Đang xử lý" (in_progress) (Phiên bản v${updated.version}).`)
      setReopenReason('')
    } catch (err: unknown) {
      await handleCatchError('Mở lại sự cố', err, setReopenFieldErrors)
    } finally {
      setIsSubmittingReopen(false)
    }
  }

  // =========================================================================
  // 8. SUBMIT DISPOSITION (DUPLICATE / INVALID) - N7-W06
  // =========================================================================
  const handleSubmitDisposition = async (e: FormEvent, simulateConflictVersion?: number) => {
    e.preventDefault()
    setConflictNotice(null)
    setSuccessNotice(null)

    const errors: { reason?: string; duplicate_of_id?: string; general?: string } = {}
    if (!dispositionReason.trim()) {
      errors.reason = 'Vui lòng nhập lý do kết thúc hồ sơ (bắt buộc).'
    } else if (dispositionReason.trim().length < 5) {
      errors.reason = 'Lý do kết thúc hồ sơ cần tối thiểu 5 ký tự để truy vết kiểm toán.'
    }
    if (dispositionKind === 'duplicate' && !duplicateOfId.trim()) {
      errors.duplicate_of_id = 'Vui lòng nhập hoặc chọn mã sự cố gốc bị trùng lặp.'
    }

    if (Object.keys(errors).length > 0) {
      setDispositionFieldErrors(errors)
      return
    }

    setDispositionFieldErrors({})
    setIsSubmittingDisposition(true)

    try {
      const expectedVersion = simulateConflictVersion ?? incident.version
      const input: DispositionInput = {
        kind: dispositionKind,
        reason: dispositionReason.trim(),
        duplicate_of_id: dispositionKind === 'duplicate' ? duplicateOfId.trim() : undefined,
        expected_version: expectedVersion,
      }

      const updated = await staffApiAdapter.dispositionIncident(incident.id, input, currentUser)
      onIncidentUpdated(updated)
      setSuccessNotice(
        `✅ Đã kết thúc hồ sơ thành công theo phân loại "${dispositionKind === 'duplicate' ? 'Sự cố trùng lặp' : 'Sự cố không hợp lệ'}" (Phiên bản v${updated.version}).`
      )
      setDispositionReason('')
      setDuplicateOfId('')
    } catch (err: unknown) {
      await handleCatchError(
        dispositionKind === 'duplicate' ? 'Đánh dấu trùng lặp' : 'Đánh dấu không hợp lệ',
        err,
        setDispositionFieldErrors
      )
    } finally {
      setIsSubmittingDisposition(false)
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
          {canShowTriage && currentTab !== 'triage' && (
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

      {/* CẢNH BÁO XUNG ĐỘT PHIÊN BẢN (HTTP 409) */}
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

      {/* HEADER: CHẾ ĐỘ ADAPTER THẬT / MOCK */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', marginBottom: '12px' }}>
        <div style={{ fontSize: '0.82rem', color: '#475569' }}>
          <strong>Cầu nối Adapter:</strong> {adapterMode === 'real' ? '🚀 API Thật (FastAPI Backend + PostgreSQL DB)' : '🧪 Mock Adapter (In-Memory Engine)'}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className={`btn btn-xs ${adapterMode === 'real' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.75rem', padding: '2px 8px' }}
            onClick={() => handleToggleAdapterMode('real')}
          >
            API Thật (DB)
          </button>
          <button
            type="button"
            className={`btn btn-xs ${adapterMode === 'mock' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.75rem', padding: '2px 8px' }}
            onClick={() => handleToggleAdapterMode('mock')}
          >
            Mock Adapter
          </button>
        </div>
      </div>

      {/* SUB-NAV CHO CÁC HÀNH ĐỘNG HỢP LỆ VỚI TRẠNG THÁI (TIÊU CHÍ N7-W06: KHÔNG HIỆN HÀNH ĐỘNG SAI TRẠNG THÁI) */}
      {validActionTabs.length === 0 && (
        <p role="status">Hiện không có thao tác xử lý phù hợp với trạng thái và quyền của bạn.</p>
      )}
      <div className="workflow-subnav-pills" role="tablist" aria-label="Các thao tác điều phối sự cố">
        {canShowTriage && (
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'triage'}
            className={`workflow-subnav-pill ${currentTab === 'triage' ? 'active' : ''}`}
            onClick={() => setActiveActionTab('triage')}
          >
            ⚡ Triage <span className="pill-badge-warning">Cần xử lý</span>
          </button>
        )}

        {canShowAck && (
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'ack'}
            className={`workflow-subnav-pill ${currentTab === 'ack' ? 'active' : ''}`}
            onClick={() => setActiveActionTab('ack')}
          >
            📥 Tiếp nhận (Ack) <span className="pill-badge-warning">Chờ nhận</span>
          </button>
        )}

        {canShowResolve && (
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'resolve'}
            className={`workflow-subnav-pill ${currentTab === 'resolve' ? 'active' : ''}`}
            onClick={() => setActiveActionTab('resolve')}
          >
            🔨 Giải quyết (Resolution) <span className="pill-badge-info">Đang xử lý</span>
          </button>
        )}

        {canShowClose && (
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'close'}
            className={`workflow-subnav-pill ${currentTab === 'close' ? 'active' : ''}`}
            onClick={() => setActiveActionTab('close')}
          >
            🔒 Nghiệm thu &amp; Đóng <span className="pill-badge-success">Chờ đóng</span>
          </button>
        )}

        {canShowReopen && (
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'reopen'}
            className={`workflow-subnav-pill ${currentTab === 'reopen' ? 'active' : ''}`}
            onClick={() => setActiveActionTab('reopen')}
          >
            🔄 Mở lại sự cố
          </button>
        )}

        {canShowAssign && (
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'assign'}
            className={`workflow-subnav-pill ${currentTab === 'assign' ? 'active' : ''}`}
            onClick={() => setActiveActionTab('assign')}
          >
            👥 Phân công
          </button>
        )}

        {canShowPriority && (
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'priority'}
            className={`workflow-subnav-pill ${currentTab === 'priority' ? 'active' : ''}`}
            onClick={() => setActiveActionTab('priority')}
          >
            ⏱️ Đổi Priority
          </button>
        )}

        {canShowDisposition && (
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'disposition'}
            className={`workflow-subnav-pill ${currentTab === 'disposition' ? 'active' : ''}`}
            onClick={() => setActiveActionTab('disposition')}
          >
            📋 Trùng / Không hợp lệ
          </button>
        )}
      </div>

      {/* =================================================================== */}
      {/* 1. FORM TRIAGE PHÂN LOẠI THỦ CÔNG                                    */}
      {/* =================================================================== */}
      {currentTab === 'triage' && (
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
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-simulate-conflict"
                  title="Gửi kèm expected_version cũ để mô phỏng HTTP 409 Version Conflict"
                  onClick={(e) => handleSubmitTriage(e, incident.version - 1)}
                  disabled={isSubmittingTriage}
                >
                  ⚡ Giả lập xung đột 409 (Test)
                </button>
              </div>

              <div className="workflow-footer-right">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmittingTriage}
                >
                  {isSubmittingTriage ? 'Đang phân loại…' : '⚡ Xác nhận phân loại Triage'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* =================================================================== */}
      {/* 2. FORM PHÂN CÔNG & CHUYỂN BỘ PHẬN                                  */}
      {/* =================================================================== */}
      {currentTab === 'assign' && (
        <div className="workflow-action-card gui-fade-transition">
          <div className="workflow-action-header">
            <div>
              <h4 className="workflow-action-title">👥 Phân công &amp; Chuyển giao bộ phận</h4>
              <p className="workflow-action-subtitle">
                Điều phối sự cố đến Ban phụ trách hoặc chỉ định đích danh Kỹ thuật viên (Handler).
              </p>
            </div>
            <span className="workflow-version-badge" title="Mã phiên bản hiện tại trên server">
              Phiên bản hiện tại: <strong>v{incident.version}</strong>
            </span>
          </div>

          {!permissions.canAssign && (
            <div className="alert alert-warning" style={{ margin: '1rem 0' }}>
              🔒 <em>Chỉ Quản lý bộ phận hoặc Quản trị viên mới có thẩm quyền phân công sự cố.</em>
            </div>
          )}

          <form className="workflow-form" onSubmit={(e) => handleSubmitAssign(e)}>
            <div className="workflow-form-grid">
              <div className="workflow-field-group">
                <label className="workflow-field-label" htmlFor="assign-dept-select">
                  Bộ phận phụ trách <span className="workflow-field-label-required">(*)</span>
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
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-simulate-conflict"
                  title="Gửi kèm expected_version cũ để mô phỏng HTTP 409 Version Conflict"
                  onClick={(e) => handleSubmitAssign(e, incident.version - 1)}
                  disabled={isSubmittingAssign || !permissions.canAssign}
                >
                  ⚡ Giả lập xung đột 409 (Test)
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
      {currentTab === 'priority' && (
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
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-simulate-conflict"
                  title="Gửi kèm expected_version cũ để mô phỏng HTTP 409 Version Conflict"
                  onClick={(e) => handleSubmitPriority(e, incident.version - 1)}
                  disabled={isSubmittingPriority || !permissions.canAdjustPriority}
                >
                  ⚡ Giả lập xung đột 409 (Test)
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

      {/* =================================================================== */}
      {/* 4. FORM TIẾP NHẬN SỰ CỐ (ACKNOWLEDGE) - N7-W06                       */}
      {/* =================================================================== */}
      {currentTab === 'ack' && (
        <div className="workflow-action-card gui-fade-transition">
          <div className="workflow-action-header">
            <div>
              <h4 className="workflow-action-title">📥 Tiếp nhận sự cố (Acknowledge)</h4>
              <p className="workflow-action-subtitle">
                Xác nhận đã có mặt hoặc bắt đầu tiếp nhận xử lý tại hiện trường. Hành động này sẽ chuyển trạng thái sang <strong>Đang xử lý (in_progress)</strong> và dừng đồng hồ đếm SLA.
              </p>
            </div>
            <span className="workflow-version-badge">Phiên bản: <strong>v{incident.version}</strong></span>
          </div>

          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '12px', margin: '12px 0', fontSize: '0.85rem' }}>
            <p style={{ margin: 0, color: '#1e40af' }}>
              ℹ️ <strong>Quy định SLA:</strong> Khi Kỹ thuật viên nhấn Tiếp nhận, hệ thống sẽ lưu thời điểm <code>acknowledged_at</code> và đánh dấu mốc hoàn thành trách nhiệm tiếp nhận ban đầu.
            </p>
          </div>

          {incident.status !== 'assigned' && (
            <div className="alert alert-warning" style={{ margin: '1rem 0' }}>
              ⚠️ Sự cố hiện đang ở trạng thái <strong>{incident.status}</strong> (chỉ sự cố ở trạng thái <em>assigned</em> mới cần tiếp nhận).
            </div>
          )}

          {ackGeneralError && (
            <div className="workflow-error-banner" role="alert">
              ⚠️ {ackGeneralError}
            </div>
          )}

          <div className="workflow-action-footer">
            <div className="workflow-footer-left">
              <button
                type="button"
                className="btn btn-sm btn-outline btn-simulate-conflict"
                title="Gửi kèm expected_version cũ để kiểm thử 409"
                onClick={(e) => handleSubmitAcknowledge(e, incident.version - 1)}
                disabled={isSubmittingAck || incident.status !== 'assigned'}
              >
                ⚡ Giả lập xung đột 409 (Test)
              </button>
            </div>
            <div className="workflow-footer-right">
              <button
                type="button"
                className="btn btn-primary"
                onClick={(e) => handleSubmitAcknowledge(e)}
                disabled={isSubmittingAck || incident.status !== 'assigned'}
              >
                {isSubmittingAck ? 'Đang tiếp nhận…' : '📥 Xác nhận Tiếp nhận sự cố'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* 5. FORM GIẢI QUYẾT SỰ CỐ (RESOLVE) - N7-W06                          */}
      {/* =================================================================== */}
      {currentTab === 'resolve' && (
        <div className="workflow-action-card gui-fade-transition">
          <div className="workflow-action-header">
            <div>
              <h4 className="workflow-action-title">🔨 Hoàn tất xử lý &amp; Giải quyết sự cố (Resolve)</h4>
              <p className="workflow-action-subtitle">
                Ghi nhận kết quả khắc phục sự cố tại hiện trường. Bắt buộc nhập kết quả xử lý chi tiết (Resolution).
              </p>
            </div>
            <span className="workflow-version-badge">Phiên bản: <strong>v{incident.version}</strong></span>
          </div>

          <form className="workflow-form" onSubmit={(e) => handleSubmitResolve(e)}>
            <div className="workflow-form-grid">
              <div className="workflow-field-group workflow-field-wide">
                <label className="workflow-field-label" htmlFor={resolveResolutionId}>
                  Kết quả xử lý sự cố (Resolution) <span className="workflow-field-label-required">(*) Bắt buộc</span>
                </label>
                <textarea
                  id={resolveResolutionId}
                  className={`workflow-textarea ${resolveFieldErrors.resolution ? 'has-error' : ''}`}
                  rows={3}
                  placeholder="Mô tả các biện pháp đã thực hiện: thay thế thiết bị, sửa đường ống, khóa tài khoản rò rỉ..."
                  value={resolutionText}
                  onChange={(e) => {
                    setResolutionText(e.target.value)
                    if (resolveFieldErrors.resolution) setResolveFieldErrors({})
                  }}
                />
                <div className="workflow-field-help">
                  {resolveFieldErrors.resolution ? (
                    <span className="workflow-error-text">⚠️ {resolveFieldErrors.resolution}</span>
                  ) : (
                    <span className="workflow-char-counter">{resolutionText.length} ký tự (tối thiểu 5 ký tự)</span>
                  )}
                </div>
              </div>
            </div>

            {resolveFieldErrors.general && (
              <div className="workflow-error-banner" role="alert">⚠️ {resolveFieldErrors.general}</div>
            )}

            <div className="workflow-action-footer">
              <div className="workflow-footer-left">
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-simulate-conflict"
                  onClick={(e) => handleSubmitResolve(e, incident.version - 1)}
                  disabled={isSubmittingResolve}
                >
                  ⚡ Giả lập xung đột 409 (Test)
                </button>
              </div>
              <div className="workflow-footer-right">
                <button type="submit" className="btn btn-primary" disabled={isSubmittingResolve}>
                  {isSubmittingResolve ? 'Đang gửi…' : '✓ Hoàn tất giải quyết sự cố'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* =================================================================== */}
      {/* 6. FORM NGHIỆM THU & ĐÓNG SỰ CỐ (CLOSE) - N7-W06                    */}
      {/* =================================================================== */}
      {currentTab === 'close' && (
        <div className="workflow-action-card gui-fade-transition">
          <div className="workflow-action-header">
            <div>
              <h4 className="workflow-action-title">🔒 Nghiệm thu &amp; Đóng sự cố (Close)</h4>
              <p className="workflow-action-subtitle">
                Dành cho Trưởng ban hoặc Quản trị viên để đóng chính thức sự cố sau khi đã kiểm tra hiện trường.
              </p>
            </div>
            <span className="workflow-version-badge">Phiên bản: <strong>v{incident.version}</strong></span>
          </div>

          <form className="workflow-form" onSubmit={(e) => handleSubmitClose(e)}>
            <div className="workflow-form-grid">
              <div className="workflow-field-group workflow-field-wide">
                <label className="workflow-field-label" htmlFor={closeReasonId}>
                  Ghi chú nghiệm thu đóng sự cố
                </label>
                <textarea
                  id={closeReasonId}
                  className="workflow-textarea"
                  rows={2}
                  placeholder="Ghi chú xác nhận hiện trường đã ổn định, sinh viên/giảng viên đã sử dụng lại bình thường..."
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                />
              </div>
            </div>

            {closeFieldErrors.general && (
              <div className="workflow-error-banner" role="alert">⚠️ {closeFieldErrors.general}</div>
            )}

            <div className="workflow-action-footer">
              <div className="workflow-footer-left">
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-simulate-conflict"
                  onClick={(e) => handleSubmitClose(e, incident.version - 1)}
                  disabled={isSubmittingClose}
                >
                  ⚡ Giả lập xung đột 409 (Test)
                </button>
              </div>
              <div className="workflow-footer-right">
                <button type="submit" className="btn btn-primary" disabled={isSubmittingClose}>
                  {isSubmittingClose ? 'Đang đóng…' : '🔒 Xác nhận Đóng sự cố'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* =================================================================== */}
      {/* 7. FORM MỞ LẠI SỰ CỐ (REOPEN) - N7-W06                               */}
      {/* =================================================================== */}
      {currentTab === 'reopen' && (
        <div className="workflow-action-card gui-fade-transition">
          <div className="workflow-action-header">
            <div>
              <h4 className="workflow-action-title">🔄 Mở lại sự cố (Reopen)</h4>
              <p className="workflow-action-subtitle">
                Mở lại sự cố nếu hiện trường tái phát lỗi hoặc việc xử lý chưa triệt để. Bắt buộc nêu rõ lý do.
              </p>
            </div>
            <span className="workflow-version-badge">Phiên bản: <strong>v{incident.version}</strong></span>
          </div>

          <form className="workflow-form" onSubmit={(e) => handleSubmitReopen(e)}>
            <div className="workflow-form-grid">
              <div className="workflow-field-group workflow-field-wide">
                <label className="workflow-field-label" htmlFor={reopenReasonId}>
                  Lý do mở lại sự cố <span className="workflow-field-label-required">(*) Bắt buộc</span>
                </label>
                <textarea
                  id={reopenReasonId}
                  className={`workflow-textarea ${reopenFieldErrors.reason ? 'has-error' : ''}`}
                  rows={3}
                  placeholder="Nêu rõ lý do cần mở lại: rò nước tái phát sau 2 tiếng, ổ cắm vẫn bốc khói..."
                  value={reopenReason}
                  onChange={(e) => {
                    setReopenReason(e.target.value)
                    if (reopenFieldErrors.reason) setReopenFieldErrors({})
                  }}
                />
                <div className="workflow-field-help">
                  {reopenFieldErrors.reason ? (
                    <span className="workflow-error-text">⚠️ {reopenFieldErrors.reason}</span>
                  ) : (
                    <span className="workflow-char-counter">{reopenReason.length} ký tự (tối thiểu 5 ký tự)</span>
                  )}
                </div>
              </div>
            </div>

            {reopenFieldErrors.general && (
              <div className="workflow-error-banner" role="alert">⚠️ {reopenFieldErrors.general}</div>
            )}

            <div className="workflow-action-footer">
              <div className="workflow-footer-left">
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-simulate-conflict"
                  onClick={(e) => handleSubmitReopen(e, incident.version - 1)}
                  disabled={isSubmittingReopen}
                >
                  ⚡ Giả lập xung đột 409 (Test)
                </button>
              </div>
              <div className="workflow-footer-right">
                <button type="submit" className="btn btn-primary" disabled={isSubmittingReopen}>
                  {isSubmittingReopen ? 'Đang mở lại…' : '🔄 Xác nhận Mở lại sự cố'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* =================================================================== */}
      {/* 8. FORM KẾT THÚC HỒ SƠ: TRÙNG LẶP / KHÔNG HỢP LỆ (DISPOSITION) - N7-W06 */}
      {/* =================================================================== */}
      {currentTab === 'disposition' && canShowDisposition && (
        <div className="workflow-action-card gui-fade-transition">
          <div className="workflow-action-header">
            <div>
              <h4 className="workflow-action-title">📋 Kết thúc hồ sơ: Báo trùng / Không hợp lệ (Disposition)</h4>
              <p className="workflow-action-subtitle">
                Đóng sự cố với lý do trùng lặp (duplicate) hoặc báo sai / spam / không hợp lệ (invalid). Thao tác này lưu trữ kết quả phân loại kiểm toán mà không xóa bản ghi.
              </p>
            </div>
            <span className="workflow-version-badge">Phiên bản: <strong>v{incident.version}</strong></span>
          </div>

          {!permissions.isAdmin && !permissions.isDepartmentManager && (
            <div className="alert alert-warning" style={{ margin: '1rem 0' }}>
              🔒 <em>Chỉ Quản lý bộ phận hoặc Quản trị viên mới có thẩm quyền kết thúc hồ sơ (Disposition). Kỹ thuật viên không có quyền này (backend sẽ trả 403 Forbidden nếu cố gắng gửi).</em>
            </div>
          )}

          <form className="workflow-form" onSubmit={(e) => handleSubmitDisposition(e)}>
            <div className="workflow-form-grid">
              <div className="workflow-field-group workflow-field-wide">
                <label className="workflow-field-label" htmlFor={dispositionKindId}>
                  Phân loại kết thúc hồ sơ <span className="workflow-field-label-required">(*) Bắt buộc</span>
                </label>
                <div style={{ display: 'flex', gap: '1.5rem', marginTop: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input
                      type="radio"
                      name="dispositionKind"
                      value="duplicate"
                      checked={dispositionKind === 'duplicate'}
                      onChange={() => setDispositionKind('duplicate')}
                    />
                    <span><strong>Sự cố trùng lặp</strong> (Duplicate)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input
                      type="radio"
                      name="dispositionKind"
                      value="invalid"
                      checked={dispositionKind === 'invalid'}
                      onChange={() => setDispositionKind('invalid')}
                    />
                    <span><strong>Sự cố không hợp lệ / Báo sai</strong> (Invalid)</span>
                  </label>
                </div>
              </div>

              {dispositionKind === 'duplicate' && (
                <div className="workflow-field-group workflow-field-wide">
                  <label className="workflow-field-label" htmlFor={duplicateOfIdInputId}>
                    Mã sự cố gốc bị trùng lặp (duplicate_of_id) <span className="workflow-field-label-required">(*) Bắt buộc</span>
                  </label>
                  <input
                    id={duplicateOfIdInputId}
                    type="text"
                    className={`workflow-input ${dispositionFieldErrors.duplicate_of_id ? 'has-error' : ''}`}
                    placeholder="Nhập UUID sự cố gốc đã được báo cáo trước đó..."
                    value={duplicateOfId}
                    onChange={(e) => {
                      setDuplicateOfId(e.target.value)
                      if (dispositionFieldErrors.duplicate_of_id) {
                        setDispositionFieldErrors({ ...dispositionFieldErrors, duplicate_of_id: undefined })
                      }
                    }}
                  />
                  {dispositionFieldErrors.duplicate_of_id && (
                    <span className="workflow-error-text">⚠️ {dispositionFieldErrors.duplicate_of_id}</span>
                  )}
                </div>
              )}

              <div className="workflow-field-group workflow-field-wide">
                <label className="workflow-field-label" htmlFor={dispositionReasonId}>
                  Lý do kết thúc hồ sơ <span className="workflow-field-label-required">(*) Bắt buộc</span>
                </label>
                <textarea
                  id={dispositionReasonId}
                  className={`workflow-textarea ${dispositionFieldErrors.reason ? 'has-error' : ''}`}
                  rows={3}
                  placeholder={
                    dispositionKind === 'duplicate'
                      ? 'Nêu rõ lý do xác định trùng: cùng vị trí rò rỉ tại P.201 đã được phân công xử lý ở sự cố #...'
                      : 'Nêu rõ lý do không hợp lệ: thông tin phản ánh không có thật, sinh viên thử nghiệm form...'
                  }
                  value={dispositionReason}
                  onChange={(e) => {
                    setDispositionReason(e.target.value)
                    if (dispositionFieldErrors.reason) {
                      setDispositionFieldErrors({ ...dispositionFieldErrors, reason: undefined })
                    }
                  }}
                />
                <div className="workflow-field-help">
                  {dispositionFieldErrors.reason ? (
                    <span className="workflow-error-text">⚠️ {dispositionFieldErrors.reason}</span>
                  ) : (
                    <span className="workflow-char-counter">{dispositionReason.length} ký tự (tối thiểu 5 ký tự)</span>
                  )}
                </div>
              </div>
            </div>

            {dispositionFieldErrors.general && (
              <div className="workflow-error-banner" role="alert">⚠️ {dispositionFieldErrors.general}</div>
            )}

            <div className="workflow-action-footer">
              <div className="workflow-footer-left">
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-simulate-conflict"
                  onClick={(e) => handleSubmitDisposition(e, incident.version - 1)}
                  disabled={isSubmittingDisposition}
                >
                  ⚡ Giả lập xung đột 409 (Test)
                </button>
              </div>
              <div className="workflow-footer-right">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmittingDisposition || (!permissions.isAdmin && !permissions.isDepartmentManager)}
                >
                  {isSubmittingDisposition ? 'Đang gửi…' : '📋 Xác nhận kết thúc hồ sơ (Disposition)'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
