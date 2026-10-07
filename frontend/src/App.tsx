import { useEffect, useState } from 'react'
import './App.css'

type Health = 'checking' | 'online' | 'offline'
const labels: Record<Health, string> = {
  checking: 'Đang kiểm tra API…',
  online: 'API đang hoạt động',
  offline: 'Chưa kết nối được API',
}

function App() {
  const [health, setHealth] = useState<Health>('checking')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    let active = true
    fetch('/api/v1/health/live', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('API unavailable')
        const data: unknown = await response.json()
        if (typeof data !== 'object' || data === null || !('status' in data) || data.status !== 'ok') {
          throw new Error('Invalid response')
        }
        if (active) setHealth('online')
      })
      .catch(() => { if (active) setHealth('offline') })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [attempt])

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">USTH · Campus Incident Management</p>
        <h1>Campus Incident Management</h1>
        <p className="intro">Nền tảng tiếp nhận và theo dõi sự cố an toàn, an ninh trong khuôn viên trường.</p>
      </header>
      <section aria-labelledby="foundation-heading">
        <h2 id="foundation-heading">Khung phát triển ban đầu</h2>
        <p>Frontend và backend đã có cấu trúc để nhóm bắt đầu làm việc. Đăng nhập, gửi báo cáo, phân công và SLA sẽ được triển khai ở các bước tiếp theo.</p>
        <p role="status" aria-live="polite" className={`health ${health}`}>{labels[health]}</p>
        <button type="button" disabled={health === 'checking'} onClick={() => {
          setHealth('checking')
          setAttempt((value) => value + 1)
        }}>Kiểm tra lại kết nối</button>
        <p className="hint">Kết nối API ở đây chỉ kiểm tra dịch vụ HTTP. Database được kiểm tra riêng qua endpoint readiness.</p>
      </section>
      <section aria-labelledby="scope-heading">
        <h2 id="scope-heading">Phạm vi MVP đề xuất</h2>
        <ul className="scope">
          <li><strong>Rò nước</strong><span>Vị trí, mức độ và nguy cơ gần nguồn điện.</span></li>
          <li><strong>Nguy hiểm điện</strong><span>Dây điện hở, khói, tia lửa và bằng chứng.</span></li>
          <li><strong>Phishing</strong><span>Email đáng ngờ và mức độ tương tác của người báo.</span></li>
        </ul>
      </section>
      <footer>Bản phát triển nội bộ · Chưa tiếp nhận báo cáo sự cố thực tế.</footer>
    </main>
  )
}

export default App
