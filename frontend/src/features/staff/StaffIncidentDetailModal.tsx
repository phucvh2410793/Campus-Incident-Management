import type { IncidentResponse } from '../../types/incident.ts'
import { DEPARTMENTS } from '../../mocks/mock-users.ts'
import { mockN7StaffRoleApi } from '../../mocks/n7-role-mock-api.ts'

interface StaffIncidentDetailModalProps {
  incident: IncidentResponse | null
  onClose: () => void
}

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

export function StaffIncidentDetailModal({ incident, onClose }: StaffIncidentDetailModalProps) {
  if (!incident) return null

  const cat = categoryMeta[incident.category] || { label: incident.category, icon: '📌' }
  const stat = statusMeta[incident.status] || { label: incident.status, className: '' }
  const prio = incident.priority ? priorityMeta[incident.priority] : null
  const sla = mockN7StaffRoleApi.getSlaStatus(incident)
  const deptName = incident.department_id ? DEPARTMENTS[incident.department_id]?.name || incident.department_id : 'Chưa gán bộ phận'

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-incident-title">
      <div className="modal-container">
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
          <button type="button" className="btn-close-modal" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body">
          <h3 id="modal-incident-title" className="modal-title">
            {incident.title}
          </h3>
          <p className="modal-desc">{incident.description}</p>

          {/* Grid thông tin chi tiết */}
          <div className="modal-section">
            <h4 className="modal-section-title">📍 THÔNG TIN ĐỊA ĐIỂM &amp; PHỤ TRÁCH</h4>
            <div className="info-grid-2">
              <div className="info-item">
                <span className="info-label">Tòa nhà:</span>
                <span className="info-val">{incident.building || 'Chưa xác định'}</span>
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
                <span className="info-label">Thời điểm phát hiện:</span>
                <span className="info-val font-mono">
                  {incident.observed_at ? new Date(incident.observed_at).toLocaleString('vi-VN') : 'Không ghi nhận'}
                </span>
              </div>
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
            </div>
          </div>

          {/* Giám sát SLA */}
          <div className="modal-section">
            <h4 className="modal-section-title">⏱️ GIÁM SÁT THỜI HẠN TIẾP NHẬN (SLA)</h4>
            <div className={`sla-card-box ${sla.state === 'overdue' ? 'sla-box-overdue' : sla.state === 'warning' ? 'sla-box-warning' : 'sla-box-safe'}`}>
              <div className="sla-grid">
                <div>
                  <span className="sla-label">Thời điểm ghi nhận:</span>
                  <strong className="font-mono">{new Date(incident.reported_at).toLocaleString('vi-VN')}</strong>
                </div>
                <div>
                  <span className="sla-label">Hạn chót tiếp nhận:</span>
                  <strong className="font-mono">
                    {incident.acknowledgment_deadline_at
                      ? new Date(incident.acknowledgment_deadline_at).toLocaleString('vi-VN')
                      : 'Chưa có deadline'}
                  </strong>
                  {prio && <small className="sla-hint"> ({prio.slaNote})</small>}
                </div>
                <div>
                  <span className="sla-label">Trạng thái SLA hiện tại:</span>
                  <span className={`badge ${sla.state === 'overdue' ? 'badge-danger' : sla.state === 'warning' ? 'badge-warning' : 'badge-success'}`}>
                    {sla.label}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Câu hỏi khảo sát */}
          {incident.answers && Object.keys(incident.answers).length > 0 && (
            <div className="modal-section">
              <h4 className="modal-section-title">📋 KHẢO SÁT NGHIỆP VỤ</h4>
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

          {/* Đánh giá quy tắc tự động */}
          {incident.rule_evaluation && (
            <div className="modal-section">
              <h4 className="modal-section-title">🤖 ĐÁNH GIÁ QUY TẮC TỰ ĐỘNG</h4>
              <div className="rule-eval-box">
                <div><strong>Mã quy tắc:</strong> <code>{incident.rule_evaluation.rule_id}</code> (Phiên bản: {incident.rule_evaluation.rule_version})</div>
                <div className="mt-1"><strong>Lý do giải thích:</strong> {incident.rule_evaluation.reason}</div>
              </div>
            </div>
          )}

          {/* Ghi chú kết quả xử lý nếu có */}
          {incident.resolution && (
            <div className="modal-section">
              <h4 className="modal-section-title">✅ KẾT QUẢ XỬ LÝ (RESOLUTION NOTE)</h4>
              <div className="resolution-box">
                {incident.resolution}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <span className="modal-footer-hint">
            Hàng đợi W2: Danh sách và bộ lọc sự cố · Các thao tác Tiếp nhận/Phân công/Đổi ưu tiên sẽ kích hoạt ở các tuần tiếp theo.
          </span>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Đóng cửa sổ
          </button>
        </div>
      </div>
    </div>
  )
}
