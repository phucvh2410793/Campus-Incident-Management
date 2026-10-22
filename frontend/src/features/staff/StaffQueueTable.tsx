import { useState } from 'react'
import type { IncidentResponse } from '../../types/incident.ts'
import { DEPARTMENTS } from '../../mocks/mock-users.ts'
import { mockN7StaffRoleApi } from '../../mocks/n7-role-mock-api.ts'

interface StaffQueueTableProps {
  incidents: IncidentResponse[]
  onSelectIncident: (incident: IncidentResponse) => void
}

const categoryIcons: Record<string, { label: string; icon: string }> = {
  water_leak: { label: 'Rò rỉ nước', icon: '💧' },
  electrical_hazard: { label: 'Nguy hiểm điện', icon: '⚡' },
  phishing: { label: 'Phishing', icon: '🎣' },
}

const statusDisplay: Record<string, { label: string; className: string }> = {
  reported: { label: 'Mới báo cáo', className: 'badge-status-reported' },
  assigned: { label: 'Đã phân công', className: 'badge-status-assigned' },
  in_progress: { label: 'Đang xử lý', className: 'badge-status-progress' },
  resolved: { label: 'Đã giải quyết', className: 'badge-status-resolved' },
  closed: { label: 'Đã đóng', className: 'badge-status-closed' },
}

const priorityBadges: Record<string, { label: string; className: string }> = {
  p1: { label: 'P1 KHẨN CẤP', className: 'badge-prio-p1' },
  p2: { label: 'P2 CAO', className: 'badge-prio-p2' },
  p3: { label: 'P3 TIÊU CHUẨN', className: 'badge-prio-p3' },
}

export function StaffQueueTable({ incidents, onSelectIncident }: StaffQueueTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopyId = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(id)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1800)
  }

  return (
    <div className="table-responsive-wrapper">
      <table className="queue-table operational-table">
        <thead>
          <tr>
            <th style={{ width: '14%' }}>MÃ &amp; PHIÊN BẢN</th>
            <th style={{ width: '26%' }}>TIÊU ĐỀ &amp; ĐỊA ĐIỂM</th>
            <th style={{ width: '13%' }}>LOẠI SỰ CỐ</th>
            <th style={{ width: '10%' }}>ƯU TIÊN</th>
            <th style={{ width: '15%' }}>BỘ PHẬN &amp; KTV</th>
            <th style={{ width: '10%' }}>TRẠNG THÁI</th>
            <th style={{ width: '12%' }}>GIÁM SÁT SLA</th>
            <th style={{ width: '8%', textAlign: 'center' }}>THAO TÁC</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => {
            const cat = categoryIcons[incident.category] || { label: incident.category, icon: '📌' }
            const prio = incident.priority ? priorityBadges[incident.priority] : null
            const stat = statusDisplay[incident.status] || { label: incident.status, className: '' }
            const sla = mockN7StaffRoleApi.getSlaStatus(incident)
            const dept = incident.department_id ? DEPARTMENTS[incident.department_id] : null
            const shortId = incident.id.slice(0, 8)

            return (
              <tr
                key={incident.id}
                className="operational-row"
                onClick={() => onSelectIncident(incident)}
              >
                {/* ID & Version */}
                <td>
                  <div className="id-cell">
                    <button
                      type="button"
                      className="id-copy-btn"
                      onClick={(e) => handleCopyId(e, incident.id)}
                      title={`Nhấp để sao chép UUID: ${incident.id}`}
                    >
                      <code>#{shortId}</code>
                      <span className="copy-icon">{copiedId === incident.id ? '✓' : '📋'}</span>
                    </button>
                    <span className="version-tag">v{incident.version}</span>
                  </div>
                </td>

                {/* Title & Location */}
                <td>
                  <div className="title-cell">
                    <strong className="incident-title-text">{incident.title}</strong>
                    <div className="location-sub">
                      📍 {incident.building || 'Khuôn viên'}
                      {incident.location_detail ? ` · ${incident.location_detail}` : ''}
                    </div>
                  </div>
                </td>

                {/* Category */}
                <td>
                  <span className="category-pill-sm">
                    {cat.icon} {cat.label}
                  </span>
                </td>

                {/* Priority */}
                <td>
                  {prio ? (
                    <span className={`badge ${prio.className}`}>{prio.label}</span>
                  ) : (
                    <span className="badge badge-neutral">Chưa gán</span>
                  )}
                </td>

                {/* Department & Assigned Handler */}
                <td>
                  <div className="dept-cell">
                    <span className="dept-name">
                      {dept?.name || (incident.triage_required ? '⚡ Hàng đợi Triage' : 'Chưa phân bổ')}
                    </span>
                    <span className="handler-name">
                      {incident.assigned_handler_name ? (
                        <>👤 {incident.assigned_handler_name}</>
                      ) : (
                        <span className="text-unassigned">Chưa phân công KTV</span>
                      )}
                    </span>
                  </div>
                </td>

                {/* Status */}
                <td>
                  <div className="status-cell">
                    <span className={`badge ${stat.className}`}>{stat.label}</span>
                    {incident.triage_required && (
                      <span className="badge badge-warning mt-1">Cần Triage</span>
                    )}
                  </div>
                </td>

                {/* SLA Monitor */}
                <td>
                  <div className="sla-cell">
                    {sla.state === 'overdue' && (
                      <span className="badge badge-danger badge-pulse">
                        🚨 {sla.label}
                      </span>
                    )}
                    {sla.state === 'warning' && (
                      <span className="badge badge-warning">
                        ⏳ {sla.label}
                      </span>
                    )}
                    {sla.state === 'safe' && (
                      <span className="badge badge-success">
                        🟢 {sla.label}
                      </span>
                    )}
                    {sla.state === 'met' && (
                      <span className="badge badge-neutral">
                        ✅ {sla.label}
                      </span>
                    )}
                    {sla.state === 'unassigned' && (
                      <span className="badge badge-neutral">
                        ⚪ {sla.label}
                      </span>
                    )}
                  </div>
                </td>

                {/* Actions */}
                <td style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-xs btn-outline"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectIncident(incident)
                    }}
                  >
                    Chi tiết
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
