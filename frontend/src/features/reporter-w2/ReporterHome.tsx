import { useEffect, useState } from 'react'
import { demoClient } from '../../api/demo-client.ts'
import type { IncidentResponse, IncidentSummary } from '../../types/incident.ts'
import { ReporterCreateIncident } from '../reporter-w6/ReporterCreateIncident.tsx'
import { StaffIncidentDetailModal } from '../staff/StaffIncidentDetailModal.tsx'

const statusText: Record<string, string> = {
  reported: 'Đã gửi',
  assigned: 'Đã phân công',
  in_progress: 'Đang xử lý',
  resolved: 'Đã giải quyết',
  closed: 'Đã đóng',
}

const categoryText: Record<string, string> = {
  water_leak: '💧 Rò nước',
  electrical_hazard: '⚡ Nguy hiểm điện',
  phishing: '🎣 Phishing',
}

export function ReporterHome() {
  const session = demoClient.currentSession()
  const isAdmin = session?.user.role === 'administrator'
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list')
  const [items, setItems] = useState<IncidentSummary[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [revision, setRevision] = useState(0)
  const [selectedIncident, setSelectedIncident] = useState<IncidentResponse | null>(null)
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    demoClient
      .reporterIncidents()
      .then((result) => {
        if (active) {
          setItems(result)
          setState('ready')
        }
      })
      .catch(() => {
        if (active) setState('error')
      })
    return () => {
      active = false
    }
  }, [revision])

  const refreshList = () => {
    setState('loading')
    setRevision((prev) => prev + 1)
  }

  const handleRowClick = async (id: string) => {
    try {
      setLoadingDetailId(id)
      const detail = await demoClient.getIncidentDetail(id)
      setSelectedIncident(detail)
    } catch {
      alert('Không thể tải chi tiết sự cố.')
    } finally {
      setLoadingDetailId(null)
    }
  }

  return (
    <div className="reporter-home-wrap">
      {/* Top Action & Sub-Navigation */}
      <div
        className="reporter-tab-strip"
        style={{
          display: 'flex',
          gap: '0.75rem',
          marginBottom: '1rem',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className={`btn ${activeTab === 'list' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => {
              setActiveTab('list')
              refreshList()
            }}
          >
            📋 Báo cáo của tôi ({items.length})
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'create' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setActiveTab('create')}
          >
            ➕ Gửi báo cáo mới (N6-W06)
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            className="w2-badge"
            style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}
          >
            N6 · Giao diện Người báo cáo
          </span>
        </div>
      </div>

      {activeTab === 'create' && (
        <ReporterCreateIncident
          onIncidentCreated={() => {
            setActiveTab('list')
            refreshList()
          }}
          onCancel={() => {
            setActiveTab('list')
            refreshList()
          }}
        />
      )}

      {activeTab === 'list' && (
        <section className="w2-panel" aria-labelledby="reporter-heading">
          <div className="w2-heading">
            <div>
              <p className="w2-kicker">{isAdmin ? 'Quản trị viên' : 'Người báo cáo'}</p>
              <h1 id="reporter-heading">{isAdmin ? 'Tất cả báo cáo' : 'Báo cáo của tôi'}</h1>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setActiveTab('create')}
            >
              + Tạo báo cáo mới
            </button>
          </div>
          <p>
            Danh sách sự cố bạn đã gửi lên hệ thống. Bấm vào sự cố bất kỳ để xem <strong>Chi tiết, Timeline công khai, Tệp bằng chứng và Bổ sung thông tin</strong>.
          </p>

          {state === 'loading' && <p role="status">Đang tải báo cáo…</p>}
          {state === 'error' && <p role="alert">Không tải được báo cáo. Hãy thử đăng nhập lại.</p>}
          {state === 'ready' && items.length === 0 && (
            <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
              <p role="status" style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Bạn chưa có báo cáo sự cố nào.
              </p>
              <button type="button" className="btn btn-primary" onClick={() => setActiveTab('create')}>
                Tạo báo cáo sự cố đầu tiên
              </button>
            </div>
          )}
          {state === 'ready' && items.length > 0 && (
            <div className="w2-table-wrap">
              <table className="w2-table">
                <thead>
                  <tr>
                    <th>Tiêu đề (Bấm để xem chi tiết)</th>
                    <th>Loại</th>
                    <th>Trạng thái</th>
                    <th>Phiên bản</th>
                    <th>Ngày báo</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => handleRowClick(item.id)}
                      style={{ cursor: 'pointer' }}
                      title="Bấm để xem chi tiết và trao đổi"
                    >
                      <td>
                        <strong>{item.title}</strong>
                        {loadingDetailId === item.id && (
                          <small style={{ marginLeft: '8px', color: 'var(--primary)' }}>
                            Đang mở…
                          </small>
                        )}
                      </td>
                      <td>{categoryText[item.category] || item.category}</td>
                      <td>
                        <span
                          className={`status-chip ${
                            item.status === 'reported'
                              ? 'pending'
                              : item.status === 'resolved' || item.status === 'closed'
                              ? 'success'
                              : 'uploading'
                          }`}
                        >
                          {statusText[item.status] || item.status}
                        </span>
                      </td>
                      <td>
                        <code>v{item.version}</code>
                      </td>
                      <td className="font-mono">
                        {new Date(item.reported_at).toLocaleDateString('vi-VN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Modal xem chi tiết ở góc nhìn Người báo cáo (Reporter View) */}
      {selectedIncident && (
        <StaffIncidentDetailModal
          incident={selectedIncident}
          currentUser={session?.user}
          forceReporterView={!isAdmin}
          onClose={() => setSelectedIncident(null)}
        />
      )}
    </div>
  )
}
