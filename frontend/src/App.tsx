import { useEffect, useState, type FormEvent } from 'react'
import { Activity, ArrowRight, CircleHelp, ClipboardList, Inbox, LayoutDashboard, LogOut, Menu, Plus, ShieldCheck, X } from 'lucide-react'
import { demoClient, type DemoSession } from './api/demo-client.ts'
import { ReporterWorkspace } from './modern/ReporterWorkspace.tsx'
import { StaffWorkspace } from './modern/StaffWorkspace.tsx'
import { HealthPage } from './modern/HealthPage.tsx'
import './modern/modern.css'
import './modern/modern-extra.css'

export type Page = 'login' | 'reports' | 'create' | 'overview' | 'queue' | 'health'
const paths: Record<Page, string> = { login: '/login', reports: '/reporter', create: '/reporter/new', overview: '/staff/dashboard', queue: '/staff', health: '/health' }
const pageFromPath = (): Page => (Object.keys(paths) as Page[]).find(key => paths[key] === location.pathname) || 'login'

export function Brand() { return <span className="m-brand-mark" aria-hidden="true">CIM<span /></span> }
export function errorText(error: unknown) { const value = error as { error?: { message?: string }; message?: string }; return value?.error?.message || value?.message || 'Không thể hoàn tất thao tác. Vui lòng thử lại.' }

export default function App() {
  const [session, setSession] = useState<DemoSession | null>(() => demoClient.currentSession())
  const [page, setPage] = useState<Page>(pageFromPath)
  const [email, setEmail] = useState('reporter@demo.invalid')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => { const pop = () => setPage(pageFromPath()); addEventListener('popstate', pop); return () => removeEventListener('popstate', pop) }, [])
  const go = (next: Page) => { history.pushState({}, '', paths[next]); setPage(next); setMenuOpen(false); scrollTo(0, 0) }
  const login = async (event: FormEvent) => { event.preventDefault(); setLoggingIn(true); setLoginError(''); try { demoClient.setReporterAdapterMode('real'); const result = await demoClient.login(email, password); setSession(result); go(result.user.role === 'reporter' ? 'reports' : 'overview') } catch (error) { setLoginError(errorText(error)) } finally { setLoggingIn(false) } }
  const logout = () => { demoClient.logout(); setSession(null); go('login') }
  const isReporter = session?.user.role === 'reporter'
  const allowed = page === 'health' || (isReporter ? page === 'reports' || page === 'create' : !!session && (page === 'overview' || page === 'queue'))
  const nav = isReporter ? [{ page: 'reports' as Page, label: 'Báo cáo của tôi', icon: ClipboardList }, { page: 'create' as Page, label: 'Tạo báo cáo', icon: Plus }] : [{ page: 'overview' as Page, label: 'Tổng quan', icon: LayoutDashboard }, { page: 'queue' as Page, label: 'Hàng đợi sự cố', icon: Inbox }]

  if (page === 'login') return <div className="m-auth"><div className="m-auth-brand"><Brand /><strong>Campus Incident Management</strong></div><div className="m-auth-layout"><div className="m-auth-story"><span className="m-eyebrow">USTH · CAMPUS INCIDENT MANAGEMENT</span><h1>Một khuôn viên<br /><em>an toàn hơn</em><br />bắt đầu từ đây.</h1><p>Báo cáo sự cố, theo dõi tiến độ và phối hợp xử lý trong cùng một không gian rõ ràng.</p><div className="m-auth-flow"><span><b>01</b> Ghi nhận</span><span><b>02</b> Điều phối</span><span><b>03</b> Xử lý</span></div></div><form className="m-auth-card" onSubmit={login}><span className="m-auth-icon"><ShieldCheck size={23} /></span><span className="m-eyebrow">MÔI TRƯỜNG TRẢI NGHIỆM</span><h2>Chào mừng trở lại</h2><p>Đăng nhập bằng tài khoản được cấp để xem không gian làm việc tương ứng.</p><label className="m-field">Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="username" /></label><label className="m-field">Mật khẩu<input type="password" value={password} onChange={event => setPassword(event.target.value)} required autoComplete="current-password" /></label>{loginError && <p className="m-error" role="alert">{loginError}</p>}<button className="m-button primary wide" disabled={loggingIn}>{loggingIn ? 'Đang vào hệ thống…' : 'Vào hệ thống'}<ArrowRight size={18} /></button><small>Phiên đăng nhập sẽ kết nối với API của hệ thống.</small></form></div><footer className="m-auth-footer">Campus Incident Management <span>© USTH</span></footer></div>

  return <div className="m-app"><aside className={`m-sidebar ${menuOpen ? 'open' : ''}`}><button className="m-sidebar-brand" onClick={() => go(isReporter ? 'reports' : 'overview')}><Brand /><span><strong>Campus Incident Management</strong><small>USTH · Quản lý sự cố</small></span></button><div className="m-sidebar-label">KHÔNG GIAN LÀM VIỆC</div><nav aria-label="Điều hướng chính">{nav.map(item => { const Icon = item.icon; return <button key={item.page} className={`m-nav-item ${page === item.page ? 'active' : ''}`} onClick={() => go(item.page)}><Icon size={19} />{item.label}</button> })}</nav><div className="m-sidebar-bottom"><div className="m-help"><CircleHelp size={18} /><span><strong>Cần hỗ trợ?</strong><small>Liên hệ bộ phận phụ trách của trường.</small></span></div><button className={`m-nav-item ${page === 'health' ? 'active' : ''}`} onClick={() => go('health')}><Activity size={19} />Trạng thái hệ thống</button><button className="m-nav-item danger" onClick={logout}><LogOut size={19} />Đăng xuất</button></div></aside><div className="m-content"><header className="m-topbar"><button className="m-menu" aria-label="Mở điều hướng" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button><span>Campus Incident Management <b>/</b> <strong>{page === 'reports' ? 'Báo cáo của tôi' : page === 'create' ? 'Tạo báo cáo' : page === 'overview' ? 'Tổng quan' : page === 'queue' ? 'Hàng đợi sự cố' : 'Trạng thái hệ thống'}</strong></span><div className="m-topbar-end"><span className="m-demo"><i /> Bản demo</span><span className="m-avatar" title={session?.user.display_name}>{session?.user.display_name.split(' ').slice(-2).map(word => word[0]).join('') || '?'}</span></div></header><main className="m-main">{!allowed ? <div className="m-empty"><h2>Không có quyền truy cập</h2><p>Hãy đăng nhập bằng vai trò phù hợp.</p><button className="m-button primary" onClick={() => go('login')}>Đến đăng nhập</button></div> : page === 'health' ? <HealthPage /> : isReporter ? <ReporterWorkspace page={page === 'create' ? 'create' : 'reports'} onCreate={() => go('create')} onBack={() => go('reports')} /> : session && <StaffWorkspace page={page === 'queue' ? 'queue' : 'overview'} user={session.user} onQueue={() => go('queue')} />}</main><footer className="m-footer"><span>Campus Incident Management · USTH</span><span>Tiếp nhận rõ ràng. Xử lý kịp thời.</span></footer></div></div>
}
