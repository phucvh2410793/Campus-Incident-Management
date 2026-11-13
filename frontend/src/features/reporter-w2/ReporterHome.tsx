import { useEffect, useState } from 'react'
import { demoClient } from '../../api/demo-client.ts'
import type { IncidentResponse, IncidentSummary } from '../../types/incident.ts'
import { StaffIncidentDetailModal } from '../staff/StaffIncidentDetailModal.tsx'

const statusText: Record<string, string> = {
  reported: 'Đã gửi', assigned: 'Đã phân công', in_progress: 'Đang xử lý',
  resolved: 'Đã giải quyết', closed: 'Đã đóng',
}

export function ReporterHome() {
  const session = demoClient.currentSession()
  const isAdmin = session?.user.role === 'administrator'
  const [items, setItems] = useState<IncidentSummary[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedIncident, setSelectedIncident] = useState<IncidentResponse | null>(null)
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    demoClient.reporterIncidents().then((result) => {
      if (active) { setItems(result); setState('ready') }
    }).catch(() => { if (active) setState('error') })
    return () => { active = false }
  }, [])

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
    <>
      <section className="w2-panel" aria-labelledby="reporter-heading">
        <div className="w2-heading">
          <div>
            <p className="w2-kicker">{isAdmin ? 'Quản trị viên' : 'Người báo cáo'}</p>
            <h1 id="reporter-heading">{isAdmin ? 'Tất cả báo cáo' : 'Báo cáo của tôi'}</h1>
          </div>
          <span className="w2-badge">N7-W04 · Reporter View</span>
        </div>
        <p>
          Danh sách báo cáo sự cố của bạn. Nhấp vào bất kỳ sự cố nào để xem <strong>Chi tiết, Timeline công khai, Tệp bằng chứng và Trao đổi</strong> (Góc nhìn Người báo cáo).
        </p>
        {state === 'loading' && <p role="status">Đang tải báo cáo…</p>}
        {state === 'error' && <p role="alert">Không tải được báo cáo. Hãy thử đăng nhập lại.</p>}
        {state === 'ready' && items.length === 0 && <p role="status">Bạn chưa có báo cáo nào.</p>}
        {state === 'ready' && items.length > 0 && (
          <div className="w2-table-wrap">
            <table className="w2-table">
              <thead>
                <tr>
                  <th>Tiêu đề (Bấm để xem chi tiết)</th>
                  <th>Trạng thái</th>
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
                      {loadingDetailId === item.id && <small style={{ marginLeft: '8px', color: 'var(--primary)' }}>Đang mở…</small>}
                    </td>
                    <td>
                      <span className={`status-chip ${item.status === 'reported' ? 'pending' : item.status === 'resolved' || item.status === 'closed' ? 'success' : 'uploading'}`}>
                        {statusText[item.status] || item.status}
                      </span>
                    </td>
                    <td className="font-mono">{new Date(item.reported_at).toLocaleDateString('vi-VN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal xem chi tiết ở góc nhìn Người báo cáo (Reporter View) */}
      {selectedIncident && (
        <StaffIncidentDetailModal
          incident={selectedIncident}
          currentUser={session?.user}
          forceReporterView={!isAdmin}
          onClose={() => setSelectedIncident(null)}
        />
      )}
    </>
  )
}
