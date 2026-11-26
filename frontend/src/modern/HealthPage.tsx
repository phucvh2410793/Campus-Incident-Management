import { useEffect, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'

export function HealthPage() {
  const [state, setState] = useState<'loading' | 'online' | 'offline'>('loading')
  const [revision, setRevision] = useState(0)
  useEffect(() => { const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000); fetch('/api/v1/health/live', { signal: controller.signal }).then(async response => { if (!response.ok || (await response.json()).status !== 'ok') throw new Error(); setState('online') }).catch(() => setState('offline')).finally(() => clearTimeout(timeout)); return () => { clearTimeout(timeout); controller.abort() } }, [revision])
  return <section className="m-health"><span className="m-eyebrow">HỆ THỐNG</span><h1>Trạng thái kết nối</h1><div className="m-health-card"><span className="m-side-icon"><Activity size={24} /></span><div><h2>Backend API</h2><p>{state === 'loading' ? 'Đang kiểm tra kết nối…' : state === 'online' ? 'Hệ thống đang hoạt động.' : 'Chưa kết nối được với backend. Giao diện demo vẫn có thể dùng với dữ liệu mẫu.'}</p></div><span className={`m-health-badge ${state}`}>{state === 'loading' ? 'Đang kiểm tra' : state === 'online' ? 'Hoạt động' : 'Ngoại tuyến'}</span></div><button className="m-button secondary" disabled={state === 'loading'} onClick={() => { setState('loading'); setRevision(value => value + 1) }}><RefreshCw size={17} /> Kiểm tra lại</button></section>
}
