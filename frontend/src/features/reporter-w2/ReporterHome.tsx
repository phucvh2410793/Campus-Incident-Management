import { useEffect, useState } from 'react'
import { demoClient } from '../../api/demo-client.ts'
import type { IncidentSummary } from '../../types/incident.ts'

const statusText: Record<string, string> = {
  reported: 'Đã gửi', assigned: 'Đã phân công', in_progress: 'Đang xử lý',
  resolved: 'Đã giải quyết', closed: 'Đã đóng',
}

export function ReporterHome() {
  const isAdmin = demoClient.currentSession()?.user.role === 'administrator'
  const [items, setItems] = useState<IncidentSummary[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let active = true
    demoClient.reporterIncidents().then((result) => {
      if (active) { setItems(result); setState('ready') }
    }).catch(() => { if (active) setState('error') })
    return () => { active = false }
  }, [])

  return (
    <section className="w2-panel" aria-labelledby="reporter-heading">
      <div className="w2-heading"><div><p className="w2-kicker">{isAdmin ? 'Quản trị viên' : 'Người báo cáo'}</p><h1 id="reporter-heading">{isAdmin ? 'Tất cả báo cáo' : 'Báo cáo của tôi'}</h1></div><span className="w2-badge">Mock API · W2</span></div>
      <p>Dữ liệu mẫu để kiểm tra luồng đăng nhập và theo dõi. Biểu mẫu gửi báo cáo sẽ được nối API ở các tuần tiếp theo.</p>
      {state === 'loading' && <p role="status">Đang tải báo cáo…</p>}
      {state === 'error' && <p role="alert">Không tải được báo cáo. Hãy thử đăng nhập lại.</p>}
      {state === 'ready' && items.length === 0 && <p role="status">Bạn chưa có báo cáo nào.</p>}
      {state === 'ready' && items.length > 0 && <div className="w2-table-wrap"><table className="w2-table"><thead><tr><th>Tiêu đề</th><th>Trạng thái</th><th>Ngày báo</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.title}</td><td>{statusText[item.status]}</td><td>{new Date(item.reported_at).toLocaleDateString('vi-VN')}</td></tr>)}</tbody></table></div>}
    </section>
  )
}
