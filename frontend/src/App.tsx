import { useEffect, useState } from 'react'
import './App.css'
import { demoClient, type DemoSession } from './api/demo-client.ts'
import { MOCK_USERS } from './mocks/mock-users.ts'
import { ReporterHome } from './features/reporter-w2/ReporterHome.tsx'
import { ReporterWireframeView } from './features/reporter-w1/ReporterWireframeView.tsx'
import { StaffManagementView } from './features/staff/StaffManagementView.tsx'

type Route = '/login' | '/reporter' | '/reporter/wireframe' | '/staff' | '/health'
const routes: Route[] = ['/login', '/reporter', '/reporter/wireframe', '/staff', '/health']

function currentRoute(): Route {
  const path = window.location.pathname
  return routes.includes(path as Route) ? path as Route : '/login'
}

function HealthSection() {
  const [state, setState] = useState<'loading' | 'online' | 'offline'>('loading')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    fetch('/api/v1/health/live', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || (await response.json()).status !== 'ok') throw new Error('API unavailable')
        if (active) setState('online')
      })
      .catch(() => { if (active) setState('offline') })
      .finally(() => window.clearTimeout(timeout))
    return () => { active = false; controller.abort(); window.clearTimeout(timeout) }
  }, [revision])

  return <section className="w2-panel"><h1>Kết nối backend</h1><p role="status">{state === 'loading' ? 'Đang kiểm tra…' : state === 'online' ? 'API hoạt động' : 'Không kết nối được API'}</p><button type="button" className="btn btn-outline" disabled={state === 'loading'} onClick={() => { setState('loading'); setRevision((value) => value + 1) }}>Kiểm tra lại</button></section>
}

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute)
  const [session, setSession] = useState<DemoSession | null>(demoClient.currentSession)
  const [email, setEmail] = useState(MOCK_USERS['user-reporter'].email)
  const [loginState, setLoginState] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    const onPopState = () => setRoute(currentRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = (path: Route) => { window.history.pushState({}, '', path); setRoute(path) }
  const canReport = session?.user.role === 'reporter' || session?.user.role === 'administrator'
  const canWork = !!session && session.user.role !== 'reporter'
  const allowed = route === '/login' || route === '/health' ||
    (route.startsWith('/reporter') ? canReport : canWork)

  const login = async () => {
    setLoginState('loading')
    try {
      const next = await demoClient.login(email)
      setSession(next)
      setLoginState('idle')
      navigate(next.user.role === 'reporter' ? '/reporter' : '/staff')
    } catch { setLoginState('error') }
  }

  const logout = () => { demoClient.logout(); setSession(null); navigate('/login') }

  return <div className="app-layout">
    <header className="app-navbar">
      <div className="navbar-brand"><span className="brand-logo">CIM</span><div className="brand-text"><span className="brand-title">Campus Incident Management</span><span className="brand-sub">Tiếp nhận và xử lý sự cố khuôn viên</span></div></div>
      <nav className="navbar-nav" aria-label="Điều hướng chính">
        {canReport && <button type="button" className={`nav-link ${route === '/reporter' ? 'active' : ''}`} onClick={() => navigate('/reporter')}>Báo cáo của tôi</button>}
        {canReport && <button type="button" className={`nav-link ${route === '/reporter/wireframe' ? 'active' : ''}`} onClick={() => navigate('/reporter/wireframe')}>Mẫu giao diện báo cáo</button>}
        {canWork && <button type="button" className={`nav-link ${route === '/staff' ? 'active' : ''}`} onClick={() => navigate('/staff')}>Hàng đợi xử lý</button>}
        <button type="button" className={`nav-link ${route === '/health' ? 'active' : ''}`} onClick={() => navigate('/health')}>Kết nối API</button>
        {session && <button type="button" className="nav-link" onClick={logout}>Đăng xuất</button>}
      </nav>
    </header>
    <main className="app-main-content">
      {!allowed && <section className="w2-panel"><h1>Không có quyền truy cập</h1><p>Đăng nhập bằng tài khoản phù hợp để xem trang này.</p><button type="button" className="btn btn-primary" onClick={() => navigate('/login')}>Đến đăng nhập</button></section>}
      {allowed && route === '/login' && <section className="w2-panel w2-login" aria-labelledby="login-heading"><p className="w2-kicker">Bản demo W2</p><h1 id="login-heading">Đăng nhập mô phỏng</h1><p>Chọn tài khoản mẫu để kiểm tra quyền và giao diện. Luồng này chưa gọi API đăng nhập thật.</p><label>Tài khoản<select value={email} onChange={(event) => setEmail(event.target.value)}>{Object.values(MOCK_USERS).map((user) => <option key={user.id} value={user.email}>{user.display_name}</option>)}</select></label><button type="button" className="btn btn-primary" disabled={loginState === 'loading'} onClick={login}>{loginState === 'loading' ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>{loginState === 'error' && <p role="alert">Đăng nhập thất bại. Vui lòng thử lại.</p>}<p className="hint">Token demo chỉ giữ trong bộ nhớ; tải lại trang sẽ đăng xuất.</p></section>}
      {allowed && route === '/reporter' && <ReporterHome />}
      {allowed && route === '/reporter/wireframe' && <ReporterWireframeView />}
      {allowed && route === '/staff' && session && <StaffManagementView key={session.user.id} user={session.user} />}
      {allowed && route === '/health' && <HealthSection />}
    </main>
    <footer className="app-footer"><p>Campus Incident Management · USTH</p></footer>
  </div>
}
