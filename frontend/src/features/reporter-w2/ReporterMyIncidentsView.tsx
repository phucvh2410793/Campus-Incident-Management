import { useState, useEffect } from 'react'
import type { IncidentResponse } from '../../types/incident.ts'
import { reporterApiClient } from './reporterApiClient.ts'

interface ReporterMyIncidentsViewProps {
  onGoToNewIncident: () => void
}

const categoryMeta: Record<string, { label: string; icon: string }> = {
  water_leak: { label: 'Rò rỉ nước', icon: '💧' },
  electrical_hazard: { label: 'Nguy hiểm điện', icon: '⚡' },
  phishing: { label: 'Tấn công Phishing', icon: '🎣' },
}

const statusDisplay: Record<string, { label: string; className: string }> = {
  reported: { label: 'Mới báo cáo', className: 'badge-status-reported' },
  assigned: { label: 'Đã phân công', className: 'badge-status-assigned' },
  in_progress: { label: 'Đang xử lý', className: 'badge-status-progress' },
  resolved: { label: 'Đã giải quyết', className: 'badge-status-resolved' },
  closed: { label: 'Đã đóng', className: 'badge-status-closed' },
}

export function ReporterMyIncidentsView({ onGoToNewIncident }: ReporterMyIncidentsViewProps) {
  const [incidents, setIncidents] = useState<IncidentResponse[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [search, setSearch] = useState<string>('')
  const [selectedIncident, setSelectedIncident] = useState<IncidentResponse | null>(null)

  useEffect(() => {
    let active = true

    reporterApiClient
      .getMyIncidents()
      .then((items) => {
        if (active) {
          setIncidents(items)
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const filteredIncidents = incidents.filter((inc) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      inc.title.toLowerCase().includes(q) ||
      inc.id.toLowerCase().includes(q) ||
      (inc.building && inc.building.toLowerCase().includes(q))
    )
  })

  return (
    <div className="reporter-my-incidents-container">
      {/* Search & Actions Bar */}
      <div className="my-incidents-toolbar">
        <div className="toolbar-search-wrap">
          <span className="search-icon">🔎</span>
          <input
            type="text"
            className="input-text"
            placeholder="Tìm theo mã sự cố hoặc tiêu đề..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="btn-clear-search"
              onClick={() => setSearch('')}
              aria-label="Xóa tìm kiếm"
            >
              ✕
            </button>
          )}
        </div>

        <div className="toolbar-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onGoToNewIncident}
          >
            ➕ Gửi Báo Cáo Sự Cố Mới
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="staff-loading-container p-4">
          <div className="staff-loading-bar">
            <span className="spinner-inline"></span>
            <span>Đang lấy danh sách sự cố của bạn từ Bearer token...</span>
          </div>
        </div>
      ) : filteredIncidents.length === 0 ? (
        <div className="staff-state-card staff-state-empty">
          <div className="state-icon-box">📭</div>
          <h3 className="state-title">
            {search ? 'Không tìm thấy sự cố phù hợp' : 'Bạn chưa gửi báo cáo sự cố nào'}
          </h3>
          <p className="state-description">
            {search
              ? `Không có sự cố nào khớp với từ khóa "${search}".`
              : 'Khi bạn gửi báo cáo sự cố mới về cơ sở vật chất hoặc an ninh, danh sách và tiến độ xử lý sẽ hiển thị tại đây.'}
          </p>
          <div className="state-actions mt-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onGoToNewIncident}
            >
              🚀 Báo sự cố ngay bây giờ
            </button>
          </div>
        </div>
      ) : (
        <div className="my-incidents-grid">
          {filteredIncidents.map((inc) => {
            const cat = categoryMeta[inc.category] || { label: inc.category, icon: '📌' }
            const stat = statusDisplay[inc.status] || { label: inc.status, className: '' }

            return (
              <div
                key={inc.id}
                className="my-incident-card"
                onClick={() => setSelectedIncident(inc)}
              >
                <div className="card-top-row">
                  <span className="incident-id-tag">
                    <code>#{inc.id.slice(0, 8)}</code>
                    <span className="version-tag">v{inc.version}</span>
                  </span>
                  <span className={`badge ${stat.className}`}>{stat.label}</span>
                </div>

                <h4 className="card-incident-title">{inc.title}</h4>
                <p className="card-incident-desc">{inc.description}</p>

                <div className="card-meta-row">
                  <span className="card-category">
                    {cat.icon} {cat.label}
                  </span>
                  <span className="card-location">
                    📍 {inc.building} {inc.location_detail ? `· ${inc.location_detail}` : ''}
                  </span>
                  <span className="card-time font-mono">
                    🕒 {new Date(inc.reported_at).toLocaleDateString('vi-VN')}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Quick View Modal */}
      {selectedIncident && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-container">
            <div className="modal-header">
              <div className="modal-header-info">
                <span className="modal-incident-id">
                  <code>#{selectedIncident.id.slice(0, 8)}</code>
                  <span className="version-tag">v{selectedIncident.version}</span>
                </span>
                <span className="badge badge-status-reported">{selectedIncident.status}</span>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setSelectedIncident(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <h3 className="modal-title">{selectedIncident.title}</h3>
              <p className="modal-desc">{selectedIncident.description}</p>
              <div className="info-grid-2">
                <div className="info-item">
                  <span className="info-label">Tòa nhà:</span>
                  <span className="info-val">{selectedIncident.building}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Vị trí cụ thể:</span>
                  <span className="info-val">{selectedIncident.location_detail || 'Không ghi'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Thời điểm báo:</span>
                  <span className="info-val font-mono">
                    {new Date(selectedIncident.reported_at).toLocaleString('vi-VN')}
                  </span>
                </div>
                <div className="info-item">
                  <span className="info-label">Trạng thái:</span>
                  <span className="info-val font-semibold">{selectedIncident.status}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <span className="modal-footer-hint">Báo cáo bảo mật · Chỉ người tạo và nhân viên có quyền mới xem được</span>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setSelectedIncident(null)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
