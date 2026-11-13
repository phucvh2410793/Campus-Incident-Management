import { useState, useEffect, useId } from 'react'
import type { IncidentResponse, HistoryItem, Comment, AttachmentSummary } from '../../types/incident.ts'
import type { UserSummary } from '../../types/auth.ts'
import { DEPARTMENTS, MOCK_USERS } from '../../mocks/mock-users.ts'
import { mockN7StaffRoleApi, type PermissionStatus } from '../../mocks/n7-role-mock-api.ts'
import { StaffWorkflowActions } from './StaffWorkflowActions.tsx'

interface StaffIncidentDetailModalProps {
  incident: IncidentResponse | null
  currentUser?: UserSummary | null
  onClose: () => void
  onIncidentUpdated?: (updated: IncidentResponse) => void
  forceReporterView?: boolean
}

type DetailTabKey = 'info' | 'actions' | 'timeline' | 'files' | 'comments' | 'permissions'

const categoryMeta: Record<string, { label: string; icon: string }> = {
  water_leak: { label: 'Rò rỉ nước', icon: '💧' },
  electrical_hazard: { label: 'Nguy hiểm điện', icon: '⚡' },
  phishing: { label: 'Tấn công Phishing', icon: '🎣' },
}

const statusMeta: Record<string, { label: string; className: string }> = {
  reported: { label: 'Mới báo cáo', className: 'status-reported' },
  assigned: { label: 'Đã phân công', className: 'status-assigned' },
  in_progress: { label: 'Đang xử lý', className: 'status-in-progress' },
  resolved: { label: 'Đã giải quyết', className: 'status-resolved' },
  closed: { label: 'Đã đóng', className: 'status-closed' },
}

const priorityMeta: Record<string, { label: string; className: string; slaNote: string }> = {
  p1: { label: 'P1 - Khẩn cấp', className: 'priority-p1', slaNote: 'Hạn tiếp nhận: 15 phút' },
  p2: { label: 'P2 - Cao', className: 'priority-p2', slaNote: 'Hạn tiếp nhận: 2 giờ' },
  p3: { label: 'P3 - Tiêu chuẩn', className: 'priority-p3', slaNote: 'Hạn tiếp nhận: 8 giờ' },
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function StaffIncidentDetailModal({
  incident: initialIncident,
  currentUser,
  onClose,
  onIncidentUpdated,
  forceReporterView = false,
}: StaffIncidentDetailModalProps) {
  // Quyết định danh tính người đang xem: mặc định admin nếu chưa đăng nhập staff
  const effectiveUser: UserSummary = currentUser || MOCK_USERS['user-admin']
  const isReporterAccount = effectiveUser.role === 'reporter' || forceReporterView

  // N7-W04: Phân biệt chế độ xem giữa Staff View và Reporter View
  // Nếu là tài khoản Reporter -> khóa cứng ở chế độ 'reporter'
  // Nếu là Staff / Admin -> mặc định 'staff', có thể bật toggle sang 'reporter' để kiểm thử xem trước
  const [viewMode, setViewMode] = useState<'staff' | 'reporter'>(() => (isReporterAccount ? 'reporter' : 'staff'))

  // Tabs bên trong modal
  const [activeTab, setActiveTab] = useState<DetailTabKey>('info')

  // Quản lý trạng thái Incident hiện thời (cập nhật khi Triage/Assign/Priority hoặc khi 409 tải lại)
  const [currentIncident, setCurrentIncident] = useState<IncidentResponse | null>(initialIncident)
  const [prevInitialId, setPrevInitialId] = useState(initialIncident?.id)

  if (initialIncident?.id !== prevInitialId) {
    setPrevInitialId(initialIncident?.id)
    setCurrentIncident(initialIncident)
  }

  const incident = currentIncident || initialIncident

  const handleReloadIncident = async (): Promise<IncidentResponse> => {
    if (!incident) throw new Error('Không có sự cố.')
    const fresh = await mockN7StaffRoleApi.getIncidentDetail(incident.id, effectiveUser)
    setCurrentIncident(fresh)
    setRefreshKey((k) => k + 1)
    onIncidentUpdated?.(fresh)
    return fresh
  }

  const handleIncidentUpdatedFromAction = (updated: IncidentResponse) => {
    setCurrentIncident(updated)
    setRefreshKey((k) => k + 1)
    onIncidentUpdated?.(updated)
  }

  // Dữ liệu timeline, comments, attachments
  const [timeline, setTimeline] = useState<HistoryItem[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [attachments, setAttachments] = useState<AttachmentSummary[]>([])
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null)

  // State làm mới dữ liệu
  const [refreshKey, setRefreshKey] = useState(0)

  // Form thêm bình luận / ghi chú
  const [newCommentBody, setNewCommentBody] = useState('')
  const [newCommentVisibility, setNewCommentVisibility] = useState<'public' | 'internal'>('public')
  const [isSubmittingComment, setIsSubmittingComment] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [commentSuccess, setCommentSuccess] = useState<string | null>(null)
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null)

  const commentInputId = useId()

  // Nạp dữ liệu chi tiết, lịch sử, tệp và trao đổi theo góc nhìn
  useEffect(() => {
    if (!incident) return
    let isMounted = true

    const fetchData = async () => {
      // Tạo actor tương ứng với viewMode đang chọn
      const actorForView: UserSummary =
        viewMode === 'reporter'
          ? {
              id: incident.reporter_id || MOCK_USERS['user-reporter'].id,
              display_name: incident.reporter_name || 'Người báo cáo (Sinh viên)',
              email: 'reporter@usth.edu.vn',
              role: 'reporter',
              department_id: null,
              is_active: true,
            }
          : effectiveUser

      try {
        const [hist, cmts, atts] = await Promise.all([
          mockN7StaffRoleApi.getIncidentHistory(incident.id, actorForView),
          mockN7StaffRoleApi.getIncidentComments(incident.id, actorForView),
          mockN7StaffRoleApi.getIncidentAttachments(incident.id, actorForView),
        ])

        if (!isMounted) return
        setTimeline(hist)
        setComments(cmts)
        setAttachments(atts)
        setPermissions(mockN7StaffRoleApi.getPermissionMatrix(incident, actorForView))
      } catch {
        // Fallback an toàn nếu lỗi
      }
    }

    void fetchData()
    return () => {
      isMounted = false
    }
  }, [incident, effectiveUser, viewMode, refreshKey])

  if (!incident) return null

  const cat = categoryMeta[incident.category] || { label: incident.category, icon: '📌' }
  const stat = statusMeta[incident.status] || { label: incident.status, className: '' }
  const prio = incident.priority ? priorityMeta[incident.priority] : null
  const sla = mockN7StaffRoleApi.getSlaStatus(incident)
  const deptName = incident.department_id ? DEPARTMENTS[incident.department_id]?.name || incident.department_id : 'Chưa gán bộ phận'

  // Xử lý gửi bình luận / ghi chú mới
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCommentBody.trim()) return

    setIsSubmittingComment(true)
    setCommentError(null)
    setCommentSuccess(null)

    // Xác định visibility: Nếu đang ở Reporter View, luôn luôn là 'public'
    const finalVisibility: 'public' | 'internal' = viewMode === 'reporter' ? 'public' : newCommentVisibility

    // Actor gửi bình luận
    const actorForPost: UserSummary =
      viewMode === 'reporter'
        ? {
            id: incident.reporter_id || MOCK_USERS['user-reporter'].id,
            display_name: incident.reporter_name || 'Lê Minh Tuấn (Reporter)',
            email: 'reporter@usth.edu.vn',
            role: 'reporter',
            department_id: null,
            is_active: true,
          }
        : effectiveUser

    try {
      await mockN7StaffRoleApi.addComment(
        incident.id,
        {
          body: newCommentBody.trim(),
          visibility: finalVisibility,
        },
        actorForPost
      )

      setNewCommentBody('')
      setCommentSuccess(
        finalVisibility === 'internal'
          ? '🔒 Ghi chú nội bộ đã được lưu thành công và chỉ nhân viên mới nhìn thấy!'
          : '💬 Bình luận công khai đã được gửi thành công!'
      )
      setRefreshKey((k) => k + 1)
    } catch (err: unknown) {
      const contractErr = err as { error?: { message?: string } }
      setCommentError(contractErr?.error?.message || 'Không thể lưu bình luận.')
    } finally {
      setIsSubmittingComment(false)
      setTimeout(() => setCommentSuccess(null), 4000)
    }
  }

  // Tải xuống file bằng chứng
  const handleDownloadAttachment = (file: AttachmentSummary) => {
    setDownloadNotice(`Đang tải xuống tệp: "${file.original_name}" (${formatFileSize(file.size_bytes)})...`)
    setTimeout(() => setDownloadNotice(null), 3500)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-incident-title">
      <div className="modal-container modal-container-w4">
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-header-info">
            <span className="modal-incident-id">
              <code>#{incident.id.slice(0, 8)}</code>
              <span className="version-tag">v{incident.version}</span>
            </span>
            <div className="modal-badges">
              <span className="category-pill">{cat.icon} {cat.label}</span>
              <span className={`status-pill ${stat.className}`}>{stat.label}</span>
              {prio && <span className={`priority-pill ${prio.className}`}>{prio.label}</span>}
              {incident.triage_required && <span className="badge badge-warning">Cần Triage</span>}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* N7-W04: Chuyển đổi góc nhìn nhanh (cho phép Staff so sánh với Reporter View) */}
            {!isReporterAccount ? (
              <div className="view-mode-toggle-pill" title="Chuyển đổi góc nhìn để kiểm chứng phân định quyền hiển thị">
                <span className="view-mode-label">Góc nhìn:</span>
                <button
                  type="button"
                  className={`btn-toggle-view ${viewMode === 'staff' ? 'active-staff' : ''}`}
                  onClick={() => setViewMode('staff')}
                >
                  🛡️ Staff View
                </button>
                <button
                  type="button"
                  className={`btn-toggle-view ${viewMode === 'reporter' ? 'active-reporter' : ''}`}
                  onClick={() => setViewMode('reporter')}
                >
                  👁️ Reporter View
                </button>
              </div>
            ) : (
              <span className="reporter-view-tag-badge">
                👁️ Reporter View (Chỉ xem công khai)
              </span>
            )}

            <button type="button" className="btn-close-modal" onClick={onClose} aria-label="Đóng cửa sổ">
              ✕
            </button>
          </div>
        </div>

        {/* N7-W04 BANNER PHÂN ĐỊNH GÓC NHÌN (ĐẢM BẢO KHÔNG LẪN LỘN) */}
        {viewMode === 'staff' ? (
          <div className="view-banner view-banner-staff" role="note">
            <span className="view-banner-icon">🛡️</span>
            <div className="view-banner-text">
              <strong>GÓC NHÌN NHÂN VIÊN &amp; QUẢN LÝ (STAFF VIEW):</strong> Hiển thị đầy đủ thông tin kỹ thuật,
              giám sát hạn chót SLA, toàn bộ timeline kiểm toán và <strong>các ghi chú nội bộ (Internal Notes)</strong> được phân định màu sắc rõ ràng.
            </div>
          </div>
        ) : (
          <div className="view-banner view-banner-reporter" role="note">
            <span className="view-banner-icon">👁️</span>
            <div className="view-banner-text">
              <strong>GÓC NHÌN NGƯỜI BÁO CÁO (REPORTER VIEW):</strong> Dữ liệu đã được kiểm duyệt theo chuẩn công khai.
              Toàn bộ ghi chú nội bộ của nhân viên và các sự kiện nhạy cảm <strong>được ẩn hoàn toàn (không bị rò rỉ)</strong>.
            </div>
          </div>
        )}

        {/* Navigation Tabs trong Modal */}
        <div className="modal-subnav-strip">
          <button
            type="button"
            className={`modal-subnav-btn ${activeTab === 'info' ? 'active' : ''}`}
            onClick={() => setActiveTab('info')}
          >
            📋 Thông tin chung
          </button>
          {viewMode === 'staff' && (
            <button
              type="button"
              className={`modal-subnav-btn ${activeTab === 'actions' ? 'active' : ''}`}
              onClick={() => setActiveTab('actions')}
            >
              ⚙️ Thao tác &amp; Phân công {incident.triage_required && <span className="pill-badge-warning">Triage</span>}
            </button>
          )}
          <button
            type="button"
            className={`modal-subnav-btn ${activeTab === 'timeline' ? 'active' : ''}`}
            onClick={() => setActiveTab('timeline')}
          >
            📜 Lịch sử xử lý ({timeline.length})
          </button>
          <button
            type="button"
            className={`modal-subnav-btn ${activeTab === 'files' ? 'active' : ''}`}
            onClick={() => setActiveTab('files')}
          >
            📎 Tệp bằng chứng ({attachments.length})
          </button>
          <button
            type="button"
            className={`modal-subnav-btn ${activeTab === 'comments' ? 'active' : ''}`}
            onClick={() => setActiveTab('comments')}
          >
            💬 Trao đổi &amp; Ghi chú ({comments.length})
          </button>
          <button
            type="button"
            className={`modal-subnav-btn ${activeTab === 'permissions' ? 'active' : ''}`}
            onClick={() => setActiveTab('permissions')}
          >
            🛡️ Trạng thái quyền
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body modal-body-scrollable">
          {downloadNotice && (
            <div className="alert alert-info alert-dismissible" style={{ marginBottom: '1rem' }}>
              <span>📥 {downloadNotice}</span>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 1: THÔNG TIN CHUNG SỰ CỐ & KHẢO SÁT                       */}
          {/* ============================================================ */}
          {activeTab === 'info' && (
            <div className="modal-tab-content gui-fade-transition">
              {/* N7-W05: Hộp nhắc Triage khẩn cấp */}
              {incident.triage_required && viewMode === 'staff' && (
                <div className="triage-callout-box" role="alert">
                  <div className="triage-callout-text">
                    <strong>🚨 SỰ CỐ ĐANG CẦN PHÂN LOẠI THỦ CÔNG (TRIAGE):</strong>
                    <span>Sự cố chưa có bộ phận chính thức hoặc độ ưu tiên SLA. Hãy chuyển sang tab Thao tác để phân loại ngay.</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-warning"
                    onClick={() => setActiveTab('actions')}
                  >
                    ⚡ Mở form Triage &amp; Phân công ngay →
                  </button>
                </div>
              )}

              <h3 id="modal-incident-title" className="modal-title">
                {incident.title}
              </h3>
              <p className="modal-desc">{incident.description}</p>

              {/* Grid thông tin chính */}
              <div className="modal-section">
                <h4 className="modal-section-title">📍 VỊ TRÍ &amp; THỜI ĐIỂM</h4>
                <div className="info-grid-2">
                  <div className="info-item">
                    <span className="info-label">Tòa nhà / Khu vực:</span>
                    <span className="info-val font-semibold">{incident.building || 'Chưa xác định'}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Vị trí cụ thể:</span>
                    <span className="info-val">{incident.location_detail || 'Không có mô tả chi tiết'}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Người báo cáo:</span>
                    <span className="info-val">{incident.reporter_name || incident.reporter_id}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Thời điểm ghi nhận:</span>
                    <span className="info-val font-mono">
                      {new Date(incident.reported_at).toLocaleString('vi-VN')}
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Thời điểm phát hiện:</span>
                    <span className="info-val font-mono">
                      {incident.observed_at ? new Date(incident.observed_at).toLocaleString('vi-VN') : 'Không ghi nhận'}
                    </span>
                  </div>

                  {/* THÔNG TIN BỘ PHẬN & KTV (Phân định hiển thị theo góc nhìn) */}
                  {viewMode === 'staff' ? (
                    <>
                      <div className="info-item">
                        <span className="info-label">Bộ phận phụ trách:</span>
                        <span className="info-val font-semibold">{deptName}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Kỹ thuật viên xử lý:</span>
                        <span className="info-val font-semibold">
                          {incident.assigned_handler_name || 'Chưa phân công KTV'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="info-item">
                      <span className="info-label">Tiến trình xử lý:</span>
                      <span className="info-val font-semibold" style={{ color: 'var(--primary)' }}>
                        {stat.label}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* GIÁM SÁT SLA (Chỉ hiển thị chi tiết hạn chót cho Staff View) */}
              {viewMode === 'staff' && (
                <div className="modal-section">
                  <h4 className="modal-section-title">⏱️ GIÁM SÁT THỜI HẠN TIẾP NHẬN (SLA STAFF)</h4>
                  <div className={`sla-card-box ${sla.state === 'overdue' ? 'sla-box-overdue' : sla.state === 'warning' ? 'sla-box-warning' : 'sla-box-safe'}`}>
                    <div className="sla-grid">
                      <div>
                        <span className="sla-label">Thời điểm báo cáo:</span>
                        <strong className="font-mono">{new Date(incident.reported_at).toLocaleString('vi-VN')}</strong>
                      </div>
                      <div>
                        <span className="sla-label">Hạn chót tiếp nhận:</span>
                        <strong className="font-mono">
                          {incident.acknowledgment_deadline_at
                            ? new Date(incident.acknowledgment_deadline_at).toLocaleString('vi-VN')
                            : 'Không áp dụng deadline'}
                        </strong>
                        {prio && <small className="sla-hint"> ({prio.slaNote})</small>}
                      </div>
                      <div>
                        <span className="sla-label">Tình trạng SLA:</span>
                        <span className={`badge ${sla.state === 'overdue' ? 'badge-danger' : sla.state === 'warning' ? 'badge-warning' : 'badge-success'}`}>
                          {sla.label}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* KHẢO SÁT NGHIỆP VỤ */}
              {incident.answers && Object.keys(incident.answers).length > 0 && (
                <div className="modal-section">
                  <h4 className="modal-section-title">📋 CÂU HỎI KHẢO SÁT ĐẶC THÙ</h4>
                  <div className="answers-box">
                    {Object.entries(incident.answers).map(([k, v]) => (
                      <div key={k} className="answer-row">
                        <span className="answer-key"><code>{k}</code>:</span>
                        <span className="answer-val"><strong>{String(v)}</strong></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ĐÁNH GIÁ QUY TẮC TỰ ĐỘNG */}
              {incident.rule_evaluation && (
                <div className="modal-section">
                  <h4 className="modal-section-title">🤖 ĐÁNH GIÁ QUY TẮC PHÂN LOẠI</h4>
                  <div className="rule-eval-box">
                    {viewMode === 'staff' && (
                      <div><strong>Mã quy tắc:</strong> <code>{incident.rule_evaluation.rule_id}</code> (Phiên bản: {incident.rule_evaluation.rule_version})</div>
                    )}
                    <div className={viewMode === 'staff' ? 'mt-1' : ''}>
                      <strong>Giải thích đánh giá:</strong> {incident.rule_evaluation.reason}
                    </div>
                  </div>
                </div>
              )}

              {/* KẾT QUẢ XỬ LÝ (NẾU CÓ) */}
              {incident.resolution && (
                <div className="modal-section">
                  <h4 className="modal-section-title">✅ KẾT QUẢ XỬ LÝ (RESOLUTION NOTE)</h4>
                  <div className="resolution-box">
                    {incident.resolution}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB N7-W05: THAO TÁC, TRIAGE, PHÂN CÔNG & ĐỔI ĐỘ ƯU TIÊN     */}
          {/* ============================================================ */}
          {activeTab === 'actions' && viewMode === 'staff' && permissions && (
            <div className="modal-tab-content gui-fade-transition">
              <StaffWorkflowActions
                incident={incident}
                currentUser={effectiveUser}
                permissions={permissions}
                onIncidentUpdated={handleIncidentUpdatedFromAction}
                onReloadIncident={handleReloadIncident}
              />
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 2: TIMELINE / LỊCH SỬ XỬ LÝ                               */}
          {/* ============================================================ */}
          {activeTab === 'timeline' && (
            <div className="modal-tab-content gui-fade-transition">
              <div className="section-header-row">
                <div>
                  <h4 className="modal-section-title">📜 TIẾN TRÌNH &amp; LỊCH SỬ THAO TÁC</h4>
                  <p className="tab-hint-desc">
                    {viewMode === 'staff'
                      ? 'Hiển thị toàn bộ các mốc sự kiện kiểm toán, bao gồm cả cảnh báo SLA và phân công nội bộ.'
                      : 'Hiển thị các mốc tiến độ xử lý công khai dành cho người báo cáo.'}
                  </p>
                </div>
                <span className="badge badge-info">{timeline.length} sự kiện</span>
              </div>

              {timeline.length === 0 ? (
                <div className="empty-subtab-box">
                  <p>Chưa có sự kiện nào được ghi nhận trong lịch sử.</p>
                </div>
              ) : (
                <div className="timeline-list">
                  {timeline.map((item) => {
                    const isInternal = item.visibility === 'internal'
                    return (
                      <div key={item.id} className="timeline-item">
                        <div className={`timeline-point ${isInternal ? 'point-internal' : ''}`}></div>
                        <div className={`timeline-body ${isInternal ? 'timeline-body-internal' : ''}`}>
                          <div className="timeline-header">
                            <span className="timeline-action">{item.action}</span>
                            {/* Đánh dấu cờ hiển thị cho Staff */}
                            {viewMode === 'staff' && (
                              <span className={`badge-visibility ${isInternal ? 'badge-internal' : 'badge-public'}`}>
                                {isInternal ? '🔒 Sự kiện nội bộ' : '💬 Công khai'}
                              </span>
                            )}
                          </div>
                          <div className="timeline-meta">
                            <span>Bởi: <strong>{item.actor_display_name || 'Hệ thống'}</strong></span>
                            <span> · </span>
                            <span className="font-mono">{new Date(item.created_at).toLocaleString('vi-VN')}</span>
                          </div>
                          {item.details && Object.keys(item.details).length > 0 && (
                            <div className="timeline-details-snippet">
                              {Object.entries(item.details).map(([dk, dv]) => (
                                <span key={dk} className="detail-tag">
                                  <code>{dk}</code>: {String(dv)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 3: TỆP BẰNG CHỨNG (ATTACHMENTS)                           */}
          {/* ============================================================ */}
          {activeTab === 'files' && (
            <div className="modal-tab-content gui-fade-transition">
              <div className="section-header-row">
                <div>
                  <h4 className="modal-section-title">📎 TỆP BẰNG CHỨNG ĐÍNH KÈM</h4>
                  <p className="tab-hint-desc">
                    Các tệp hình ảnh hoặc tài liệu PDF được đính kèm khi báo cáo sự cố (tối đa 5 tệp, $\le$ 10 MiB/tệp).
                  </p>
                </div>
                <span className="badge badge-info">{attachments.length} tệp</span>
              </div>

              {attachments.length === 0 ? (
                <div className="empty-subtab-box">
                  <span style={{ fontSize: '2rem' }}>📂</span>
                  <p>Sự cố này không có tệp bằng chứng đính kèm.</p>
                </div>
              ) : (
                <div className="attachments-grid-list">
                  {attachments.map((file) => (
                    <div key={file.id} className="attachment-card">
                      <div className="att-icon-wrapper">
                        {file.content_type === 'application/pdf' ? '📄' : '🖼️'}
                      </div>
                      <div className="att-info-body">
                        <strong className="att-filename" title={file.original_name}>
                          {file.original_name}
                        </strong>
                        <div className="att-meta">
                          <span>{formatFileSize(file.size_bytes)}</span>
                          <span> · </span>
                          <span>{file.content_type}</span>
                          <span> · </span>
                          <span className="font-mono">{new Date(file.created_at).toLocaleDateString('vi-VN')}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-download-att"
                        onClick={() => handleDownloadAttachment(file)}
                        title="Tải tệp bằng chứng"
                      >
                        📥 Tải xuống
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 4: TRAO ĐỔI & GHI CHÚ NỘI BỘ (COMMENTS & INTERNAL NOTES)  */}
          {/* TIÊU CHÍ HOÀN THÀNH: "note internal được đánh dấu rõ"         */}
          {/* ============================================================ */}
          {activeTab === 'comments' && (
            <div className="modal-tab-content gui-fade-transition">
              <div className="section-header-row">
                <div>
                  <h4 className="modal-section-title">💬 TRAO ĐỔI &amp; GHI CHÚ XỬ LÝ</h4>
                  <p className="tab-hint-desc">
                    {viewMode === 'staff'
                      ? 'Gồm bình luận trao đổi công khai và các ghi chú tác nghiệp nội bộ giữa các kỹ thuật viên.'
                      : 'Các thông tin phản hồi và trao đổi công khai giữa bạn và ban quản lý sự cố.'}
                  </p>
                </div>
                <span className="badge badge-info">{comments.length} ghi chú</span>
              </div>

              {/* Danh sách bình luận & ghi chú */}
              {comments.length === 0 ? (
                <div className="empty-subtab-box">
                  <span style={{ fontSize: '2rem' }}>💭</span>
                  <p>Chưa có bình luận hoặc ghi chú nào cho sự cố này.</p>
                </div>
              ) : (
                <div className="comments-list">
                  {comments.map((cmt) => {
                    const isInternal = cmt.visibility === 'internal'

                    return (
                      <div
                        key={cmt.id}
                        className={`comment-card ${isInternal ? 'comment-card-internal note-internal-highlight' : 'comment-card-public note-public-box'}`}
                      >
                        <div className="comment-card-header">
                          <div className="comment-author-group">
                            <span className="comment-author-name">
                              {cmt.author_name}
                            </span>
                            <span className="comment-time font-mono">
                              {new Date(cmt.created_at).toLocaleString('vi-VN')}
                            </span>
                          </div>

                          {/* TIÊU CHÍ HOÀN THÀNH: ĐÁNH DẤU RÕ RÀNG NOTE INTERNAL */}
                          {isInternal ? (
                            <span className="internal-note-badge" title="Chỉ nhân viên nội bộ mới xem được ghi chú này">
                              🔒 GHI CHÚ NỘI BỘ (INTERNAL ONLY)
                            </span>
                          ) : (
                            <span className="public-comment-badge" title="Người báo cáo và nhân viên đều xem được">
                              💬 CÔNG KHAI (PUBLIC)
                            </span>
                          )}
                        </div>

                        <div className="comment-body-text">
                          {cmt.body}
                        </div>

                        {/* Cảnh báo riêng cho Internal Note trong Staff View */}
                        {isInternal && (
                          <div className="internal-note-footer-notice">
                            🛡️ <em>Bảo mật nội bộ: Người báo cáo (Reporter) KHÔNG THỂ nhìn thấy ghi chú này.</em>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Form gửi bình luận / ghi chú mới */}
              <div className="comment-form-container">
                <form onSubmit={handleAddComment}>
                  <div className="comment-form-header">
                    <strong>✍️ Thêm trao đổi mới:</strong>

                    {/* Lựa chọn loại ghi chú (Chỉ hiện khi ở Staff View) */}
                    {viewMode === 'staff' ? (
                      <div className="radio-group-visibility" role="radiogroup" aria-label="Loại ghi chú">
                        <label className="visibility-radio-label">
                          <input
                            type="radio"
                            name="visibility"
                            value="public"
                            checked={newCommentVisibility === 'public'}
                            onChange={() => setNewCommentVisibility('public')}
                          />
                          <span>💬 Bình luận công khai</span>
                        </label>

                        <label className="visibility-radio-label internal-label">
                          <input
                            type="radio"
                            name="visibility"
                            value="internal"
                            checked={newCommentVisibility === 'internal'}
                            onChange={() => setNewCommentVisibility('internal')}
                          />
                          <span>🔒 Ghi chú nội bộ</span>
                        </label>
                      </div>
                    ) : (
                      <span className="reporter-fixed-badge">
                        💬 Gửi phản hồi công khai đến ban kỹ thuật
                      </span>
                    )}
                  </div>

                  {/* Cảnh báo khi Staff đang chọn Internal Note */}
                  {viewMode === 'staff' && newCommentVisibility === 'internal' && (
                    <div className="internal-note-type-alert">
                      🔒 <strong>Chế độ Ghi chú nội bộ:</strong> Nội dung này sẽ được đánh dấu vàng nổi bật và chỉ hiển thị
                      trong hàng đợi xử lý của Nhân viên / Quản lý. Người báo cáo sẽ hoàn toàn không thấy.
                    </div>
                  )}

                  {commentError && (
                    <div className="alert alert-danger mt-1">
                      ⚠️ {commentError}
                    </div>
                  )}
                  {commentSuccess && (
                    <div className="alert alert-success mt-1">
                      ✓ {commentSuccess}
                    </div>
                  )}

                  <div className="mt-1">
                    <label htmlFor={commentInputId} style={{ display: 'none' }}>Nội dung trao đổi</label>
                    <textarea
                      id={commentInputId}
                      className="comment-textarea"
                      placeholder={
                        viewMode === 'staff' && newCommentVisibility === 'internal'
                          ? 'Nhập ghi chú tác nghiệp nội bộ (VD: Đã khảo sát hiện trường, cần mang máy hàn và vật tư thay thế)...'
                          : 'Nhập thông tin phản hồi công khai (1 - 2000 ký tự)...'
                      }
                      rows={3}
                      value={newCommentBody}
                      onChange={(e) => setNewCommentBody(e.target.value)}
                      maxLength={2000}
                      required
                    />
                  </div>

                  <div className="comment-form-actions">
                    <span className="char-counter">{newCommentBody.length}/2000 ký tự</span>
                    <button
                      type="submit"
                      className={`btn ${viewMode === 'staff' && newCommentVisibility === 'internal' ? 'btn-warning-dark' : 'btn-primary'}`}
                      disabled={isSubmittingComment || !newCommentBody.trim()}
                    >
                      {isSubmittingComment ? 'Đang gửi…' : viewMode === 'staff' && newCommentVisibility === 'internal' ? '🔒 Lưu ghi chú nội bộ' : '💬 Gửi bình luận công khai'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 5: TRẠNG THÁI QUYỀN (ROLE PERMISSIONS MATRIX)             */}
          {/* ============================================================ */}
          {activeTab === 'permissions' && permissions && (
            <div className="modal-tab-content gui-fade-transition">
              <div className="section-header-row">
                <div>
                  <h4 className="modal-section-title">🛡️ MA TRẬN TRẠNG THÁI QUYỀN HẠN</h4>
                  <p className="tab-hint-desc">
                    Kiểm soát quyền truy cập chi tiết dựa trên vai trò ({permissions.role}) và mối quan hệ với sự cố này.
                  </p>
                </div>
              </div>

              {/* Thông tin ngữ cảnh vai trò */}
              <div className="permission-context-card">
                <div className="perm-row">
                  <span className="perm-label">Tài khoản đang xem:</span>
                  <strong className="perm-val">{effectiveUser.display_name} ({effectiveUser.email})</strong>
                </div>
                <div className="perm-row">
                  <span className="perm-label">Vai trò hệ thống:</span>
                  <span className="badge badge-info">{permissions.role.toUpperCase()}</span>
                </div>
                <div className="perm-row">
                  <span className="perm-label">Thuộc bộ phận:</span>
                  <span className="perm-val">{effectiveUser.department_id ? DEPARTMENTS[effectiveUser.department_id]?.name || effectiveUser.department_id : 'Không có'}</span>
                </div>
                <div className="perm-row">
                  <span className="perm-label">Quan hệ với sự cố:</span>
                  <span className="perm-val">
                    {permissions.isReporter && '👤 Là Người tạo báo cáo này'}
                    {permissions.isAssignedHandler && ' 🛠️ Là Kỹ thuật viên được phân công'}
                    {permissions.isDepartmentManager && ' 👔 Là Quản lý bộ phận chịu trách nhiệm'}
                    {permissions.isAdmin && ' 👑 Quản trị viên hệ thống (Toàn quyền)'}
                    {!permissions.isReporter && !permissions.isAssignedHandler && !permissions.isDepartmentManager && !permissions.isAdmin && 'Khách theo dõi'}
                  </span>
                </div>
              </div>

              {/* Bảng phân quyền chi tiết */}
              <div className="w2-table-wrap mt-2">
                <table className="w2-table perm-matrix-table">
                  <thead>
                    <tr>
                      <th>Hành động / Nghiệp vụ</th>
                      <th>Trạng thái quyền</th>
                      <th>Ghi chú quy tắc</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Xem thông tin &amp; lịch sử công khai</strong></td>
                      <td><span className="status-chip success">✓ Được phép</span></td>
                      <td>Mọi vai trò đều được xem dữ liệu công khai của sự cố thuộc phạm vi.</td>
                    </tr>
                    <tr>
                      <td><strong>Xem ghi chú &amp; sự kiện nội bộ</strong></td>
                      <td>
                        {permissions.canViewInternalNotes ? (
                          <span className="status-chip success">✓ Được phép (Staff)</span>
                        ) : (
                          <span className="status-chip error">✗ Bị ẩn (Chỉ Staff)</span>
                        )}
                      </td>
                      <td>Người báo cáo (Reporter) hoàn toàn không xem được ghi chú nội bộ.</td>
                    </tr>
                    <tr>
                      <td><strong>Tạo ghi chú nội bộ (Internal Note)</strong></td>
                      <td>
                        {permissions.canAddInternalNotes ? (
                          <span className="status-chip success">✓ Được phép</span>
                        ) : (
                          <span className="status-chip error">✗ Không có quyền</span>
                        )}
                      </td>
                      <td>Chỉ Nhân viên kỹ thuật, Quản lý bộ phận hoặc Quản trị viên mới được tạo.</td>
                    </tr>
                    <tr>
                      <td><strong>Gửi bình luận công khai</strong></td>
                      <td><span className="status-chip success">✓ Được phép</span></td>
                      <td>Cả người báo cáo và nhân viên đều được gửi để trao đổi hai chiều.</td>
                    </tr>
                    <tr>
                      <td><strong>Tiếp nhận sự cố (Acknowledge)</strong></td>
                      <td>
                        {permissions.canAcknowledge ? (
                          <span className="status-chip success">✓ Khả dụng</span>
                        ) : (
                          <span className="status-chip pending">Không khả dụng</span>
                        )}
                      </td>
                      <td>Dành cho KTV được giao khi sự cố ở trạng thái "Đã phân công" (assigned).</td>
                    </tr>
                    <tr>
                      <td><strong>Phân công / Chuyển bộ phận</strong></td>
                      <td>
                        {permissions.canAssign ? (
                          <span className="status-chip success">✓ Khả dụng</span>
                        ) : (
                          <span className="status-chip pending">Không khả dụng</span>
                        )}
                      </td>
                      <td>Dành cho Quản lý bộ phận hoặc Quản trị viên hệ thống.</td>
                    </tr>
                    <tr>
                      <td><strong>Đổi độ ưu tiên P1/P2/P3</strong></td>
                      <td>
                        {permissions.canAdjustPriority ? (
                          <span className="status-chip success">✓ Khả dụng</span>
                        ) : (
                          <span className="status-chip pending">Không khả dụng</span>
                        )}
                      </td>
                      <td>Tính lại deadline SLA từ ngày báo cáo; chỉ Quản lý / Admin được chỉnh.</td>
                    </tr>
                    <tr>
                      <td><strong>Giải quyết sự cố (Resolve)</strong></td>
                      <td>
                        {permissions.canResolve ? (
                          <span className="status-chip success">✓ Khả dụng</span>
                        ) : (
                          <span className="status-chip pending">Không khả dụng</span>
                        )}
                      </td>
                      <td>Dành cho KTV khi trạng thái đang xử lý (in_progress), bắt buộc nhập lý do.</td>
                    </tr>
                    <tr>
                      <td><strong>Đóng sự cố (Close)</strong></td>
                      <td>
                        {permissions.canClose ? (
                          <span className="status-chip success">✓ Khả dụng</span>
                        ) : (
                          <span className="status-chip pending">Không khả dụng</span>
                        )}
                      </td>
                      <td>Chỉ Quản lý hoặc Quản trị viên mới có thẩm quyền nghiệm thu đóng sự cố.</td>
                    </tr>
                  </tbody>
                </table>

                {viewMode === 'staff' && (
                  <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => setActiveTab('actions')}
                    >
                      ⚙️ Mở giao diện Thao tác &amp; Phân công →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <span className="modal-footer-hint">
            N7-W04 &amp; N7-W05: Chi tiết, Timeline, Ghi chú, Quyền, UI Triage, Phân công &amp; Đổi Priority (OCC 409).
          </span>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Đóng cửa sổ
          </button>
        </div>
      </div>
    </div>
  )
}
