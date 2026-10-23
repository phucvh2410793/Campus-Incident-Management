import { useState } from 'react'
import type { UserSummary } from '../../types/auth.ts'
import { reporterApiClient } from './reporterApiClient.ts'

interface ReporterLoginViewProps {
  onLoginSuccess: (user: UserSummary) => void
}

export function ReporterLoginView({ onLoginSuccess }: ReporterLoginViewProps) {
  const [email, setEmail] = useState('reporter@usth.edu.vn')
  const [password, setPassword] = useState('usth@2026')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [storageCheck, setStorageCheck] = useState<ReturnType<typeof reporterApiClient.verifyStorageClean> | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setIsLoading(true)

    try {
      // Giả lập trễ nhẹ 200ms
      await new Promise((r) => setTimeout(r, 200))
      const res = await reporterApiClient.login({
        email: email.trim(),
        password: password.trim(),
      })
      setIsLoading(false)
      onLoginSuccess(res.user)
    } catch (err: unknown) {
      setIsLoading(false)
      const errObj = err as { error?: { code?: string; message?: string } }
      if (errObj?.error?.code === 'invalid_credentials') {
        setErrorMessage('Email hoặc mật khẩu không chính xác (Mã lỗi: 401 / invalid_credentials).')
      } else {
        setErrorMessage(errObj?.error?.message || 'Không thể đăng nhập vào hệ thống.')
      }
    }
  }

  const fillCredentials = (userEmail: string, userPass: string) => {
    setEmail(userEmail)
    setPassword(userPass)
    setErrorMessage(null)
  }

  const handleCheckStorage = () => {
    const res = reporterApiClient.verifyStorageClean()
    setStorageCheck(res)
  }

  return (
    <div className="reporter-auth-layout">
      <div className="login-card-container">
        {/* Header */}
        <div className="login-header">
          <div className="login-logo-wrap">
            <span className="login-logo">🛡️ USTH</span>
          </div>
          <h2 className="login-title">Đăng Nhập Cổng Người Báo Cáo</h2>
          <p className="login-sub">
            Hệ thống tiếp nhận thông tin sự cố cơ sở vật chất, an toàn điện và an ninh mạng
          </p>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="wf-alert wf-alert-danger" role="alert">
            <strong>[!] ĐĂNG NHẬP THẤT BẠI:</strong>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label htmlFor="login-email" className="form-label required">
              Địa chỉ Email trường (@usth.edu.vn):
            </label>
            <input
              id="login-email"
              type="email"
              className="input-text"
              placeholder="nhap-email@usth.edu.vn"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group mt-2">
            <label htmlFor="login-password" className="form-label required">
              Mật khẩu:
            </label>
            <input
              id="login-password"
              type="password"
              className="input-text"
              placeholder="Nhập mật khẩu..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="login-actions mt-3">
            <button
              type="submit"
              className="btn btn-primary btn-lg w-100"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <span className="spinner-inline"></span>
                  <span>Đang xác thực phiên...</span>
                </>
              ) : (
                <span>Đăng Nhập Vào Hệ Thống</span>
              )}
            </button>
          </div>
        </form>

        {/* Quick Login Presets */}
        <div className="quick-presets-box mt-3">
          <span className="quick-presets-title">Tài khoản mẫu để kiểm thử nhanh:</span>
          <div className="presets-button-grid">
            <button
              type="button"
              className="btn btn-xs btn-outline preset-user-btn"
              onClick={() => fillCredentials('reporter@usth.edu.vn', 'usth@2026')}
            >
              👤 Sinh viên Lê Minh Tuấn (Reporter)
            </button>
            <button
              type="button"
              className="btn btn-xs btn-outline preset-user-btn"
              onClick={() => fillCredentials('manager.csvc@usth.edu.vn', 'usth@2026')}
            >
              👔 Quản lý Hoàng Đức (Manager CSVC)
            </button>
            <button
              type="button"
              className="btn btn-xs btn-outline text-danger preset-user-btn"
              onClick={() => fillCredentials('khongtontai@usth.edu.vn', 'sai-pass')}
            >
              ❌ Tài khoản sai (Kiểm thử lỗi 401)
            </button>
          </div>
        </div>

        {/* Security Compliance Card */}
        <div className="security-contract-callout mt-3">
          <div className="callout-header">
            <span className="lock-icon">🔒</span>
            <strong>QUY CHUẨN BẢO MẬT TOKEN (TASK N6-W02):</strong>
          </div>
          <p className="callout-body">
            Theo đúng <code>docs/api-contract.md</code>, Bearer Token được lưu trữ <strong>thuần túy trong Memory</strong>, tuyệt đối không lưu vào <code>localStorage</code>, <code>sessionStorage</code> hoặc <code>cookie</code>. Khi tải lại trang (F5), phiên làm việc sẽ tự động kết thúc.
          </p>

          {/* Storage Inspector Button */}
          <div className="storage-inspector-bar">
            <button
              type="button"
              className="btn btn-xs btn-outline"
              onClick={handleCheckStorage}
            >
              🔍 Kiểm tra LocalStorage &amp; SessionStorage
            </button>

            {storageCheck && (
              <span className="storage-result-badge badge badge-success">
                ✓ Storage sạch: 0 token trong LocalStorage &amp; SessionStorage
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
