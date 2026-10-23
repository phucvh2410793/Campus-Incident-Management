import { useState, useEffect } from 'react'
import './App.css'
import { ReporterW2View } from './features/reporter-w2/ReporterW2View.tsx'
import { StaffManagementView } from './features/staff/StaffManagementView.tsx'

import { transitionGui } from './utils/transition.ts'

type AppTab = 'reporter' | 'staff' | 'health'

type Health = 'checking' | 'online' | 'offline'
const healthLabels: Record<Health, string> = {
  checking: 'Đang kiểm tra API…',
  online: 'API đang hoạt động',
  offline: 'Chưa kết nối được API',
}

function FoundationHealthSection() {
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
      .catch(() => {
        if (active) setHealth('offline')
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [attempt])

  return (
    <section aria-labelledby="foundation-heading" className="foundation-box">
      <h2 id="foundation-heading">Kiểm tra kết nối API Nền tảng (FastAPI)</h2>
      <p>
        Kiểm tra tính sẵn sàng của backend FastAPI gốc qua proxy <code>/api/v1/health/live</code>.
      </p>
      <p role="status" aria-live="polite" className={`health ${health}`}>
        {healthLabels[health]}
      </p>
      <button
        type="button"
        disabled={health === 'checking'}
        className="btn btn-outline btn-sm"
        onClick={() => {
          setHealth('checking')
          setAttempt((value) => value + 1)
        }}
      >
        Kiểm tra lại kết nối HTTP
      </button>
      <p className="hint mt-2">
        Kết nối API ở đây kiểm tra dịch vụ HTTP backend khi chạy Docker Compose. Các tính năng của
        Task N6 và N7 chạy độc lập trên Mock API Adapter đúng contract.
      </p>
    </section>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('reporter')

  return (
    <div className="app-layout">
      {/* Top Navbar */}
      <header className="app-navbar">
        <div className="navbar-brand">
          <span className="brand-logo">🛡️ USTH</span>
          <div className="brand-text">
            <span className="brand-title">Hệ Thống Quản Lý Sự Cố Khuôn Viên</span>
            <span className="brand-sub">Tiếp nhận và theo dõi an toàn, an ninh trong trường</span>
          </div>
        </div>

        {/* Main Navigation Tabs */}
        <nav className="navbar-nav">
          <button
            type="button"
            className={`nav-link ${activeTab === 'reporter' ? 'active' : ''}`}
            onClick={() => transitionGui(() => setActiveTab('reporter'))}
          >
            📐 Người Báo Cáo
          </button>
          <button
            type="button"
            className={`nav-link ${activeTab === 'staff' ? 'active' : ''}`}
            onClick={() => transitionGui(() => setActiveTab('staff'))}
          >
            📋 Nhân Viên &amp; Quản Lý
          </button>
          <button
            type="button"
            className={`nav-link ${activeTab === 'health' ? 'active' : ''}`}
            onClick={() => transitionGui(() => setActiveTab('health'))}
          >
            🔌 Kiểm Tra Kết Nối API
          </button>
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="app-main-content">
        <div key={activeTab} className="gui-fade-transition">
          {activeTab === 'reporter' && <ReporterW2View />}
          {activeTab === 'staff' && <StaffManagementView />}
          {activeTab === 'health' && <FoundationHealthSection />}
        </div>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>
          Hệ thống Quản lý Sự cố Khuôn viên · USTH Cyber Security
        </p>
      </footer>
    </div>
  )
}
