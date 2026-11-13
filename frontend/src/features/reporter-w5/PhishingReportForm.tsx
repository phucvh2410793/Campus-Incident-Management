import { useState, useId, type FormEvent } from 'react'
import './PhishingReportForm.css'
import { demoClient } from '../../api/demo-client.ts'
import { mockApi } from '../../mocks/mock-api-service.ts'
import type { PhishingAnswers } from '../../types/incident.ts'
import { validatePhishingForm, type FieldErrors } from './validate-phishing-form.ts'

const initialForm = {
  title: '',
  description: '',
  building: '',
  location_detail: '',
  observed_at: '',
  sender_text: '',
}

const initialAnswers: PhishingAnswers = {
  channel: 'email',
  interaction: 'none',
  sender_text: null,
}

function apiError(error: unknown): { message?: string; details?: Array<{ field: string; reason: string }> } {
  if (!error || typeof error !== 'object' || !('error' in error)) return {}
  const body = (error as { error?: { message?: string; details?: Array<{ field: string; reason: string }> } }).error
  return body ?? {}
}

export function PhishingReportForm() {
  const [form, setForm] = useState(initialForm)
  const [answers, setAnswers] = useState<PhishingAnswers>(initialAnswers)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const titleInputId = useId()
  const descInputId = useId()
  const buildingInputId = useId()
  const senderInputId = useId()

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors = validatePhishingForm(form)
    setErrors(nextErrors)
    setNotice(null)
    if (Object.keys(nextErrors).length) return

    const session = demoClient.currentSession()
    if (!session) {
      setNotice({ kind: 'error', text: 'Phiên đăng nhập đã hết. Hãy đăng nhập lại.' })
      return
    }

    setSubmitting(true)
    try {
      const finalAnswers: PhishingAnswers = {
        channel: answers.channel,
        interaction: answers.interaction,
        sender_text: form.sender_text.trim() || null,
      }

      await mockApi.createIncident(
        session.user,
        {
          category: 'phishing',
          title: form.title.trim(),
          description: form.description.trim(),
          building: form.building.trim(),
          location_detail: form.location_detail.trim() || null,
          observed_at: form.observed_at ? new Date(form.observed_at).toISOString() : null,
          answers: finalAnswers,
        },
        idempotencyKey
      )

      setForm(initialForm)
      setAnswers(initialAnswers)
      setErrors({})
      setIdempotencyKey(crypto.randomUUID())
      setNotice({
        kind: 'success',
        text: 'Đã gửi báo cáo lừa đảo / Phishing thành công! Sự cố đã được chuyển đến bộ phận IT / Security để phân tích tên miền và xử lý an ninh. Bạn có thể theo dõi trong mục “Báo cáo của tôi”.',
      })
    } catch (error) {
      const response = apiError(error)
      setErrors(Object.fromEntries((response.details ?? []).map(({ field, reason }) => [field, reason])))
      setNotice({
        kind: 'error',
        text: response.message ?? (error instanceof Error ? error.message : 'Không gửi được báo cáo. Hãy thử lại.'),
      })
    } finally {
      setSubmitting(false)
    }
  }

  const fieldError = (name: string) =>
    errors[name] && (
      <p className="n6-field-error" id={`${name}-error`}>
        {errors[name]}
      </p>
    )

  return (
    <section className="w2-panel n6-phishing-page" aria-labelledby="phishing-form-heading">
      <p className="w2-kicker">Người báo cáo</p>
      <h1 id="phishing-form-heading">Báo cáo thư / tin nhắn lừa đảo (Phishing)</h1>
      <p>
        Khai báo các sự vụ nghi ngờ giả mạo danh tính, email mạo danh trường hoặc tin nhắn độc hại.
        Đội ngũ An toàn thông tin (IT / Security) sẽ tiến hành kiểm tra, phân tích tên miền và cảnh báo toàn trường.
      </p>

      {/* CẢNH BÁO BẢO MẬT: CHẶN NHẬP SECRET / PASSWORD / OTP */}
      <aside className="n6-security-warning" role="note">
        <strong>🛡️ KHUYẾN CÁO AN NINH BẢO MẬT (KHÔNG GỬI / LƯU SECRET):</strong>
        Tuyệt đối <em>KHÔNG</em> nhập mật khẩu, mã xác thực OTP hoặc thông tin thẻ/tài khoản vào biểu mẫu này.
        Nếu bạn đã lỡ nhập thông tin trên trang web giả mạo, hãy đánh dấu mức tương tác “Đã nhập thông tin” bên dưới và
        khẩn trương đổi mật khẩu tài khoản trường qua cổng xác thực chính thức!
      </aside>

      {/* CẢNH BÁO TỨC THỜI NẾU ĐÃ LỠ NHẬP THÔNG TIN VÀO TRANG GIẢ MẠO (P1) */}
      {answers.interaction === 'entered_information' && (
        <aside className="n6-security-warning" style={{ backgroundColor: '#fef2f2', borderColor: '#ef4444', color: '#991b1b', marginTop: '10px' }} role="alert">
          <strong style={{ color: '#7f1d1d' }}>🚨 CẢNH BÁO NGUY CƠ RÒ RỈ TÀI KHOẢN (ƯU TIÊN P1 KHẨN CẤP):</strong>
          Bạn đã ghi nhận nhập thông tin tài khoản vào trang giả mạo. Hãy lập tức truy cập cổng chính thức để đổi mật khẩu và liên hệ Hotline IT/Security USTH (024 3791 8618) để khóa tạm thời phiên đăng nhập của bạn!
        </aside>
      )}

      <form className="n6-phishing-form" onSubmit={submit} noValidate>
        {/* ================================================================= */}
        {/* BA TRẠNG THÁI TƯƠNG TÁC PHÂN BIỆT RÕ                              */}
        {/* ================================================================= */}
        <div className="n6-interaction-section">
          <label className="n6-interaction-title" id="interaction-group-label">
            Mức độ tương tác với thư / liên kết nghi vấn (*)
          </label>
          <div className="n6-interaction-grid" role="radiogroup" aria-labelledby="interaction-group-label">
            {/* 1. Chưa tương tác (None) */}
            <label className={`interaction-card card-none ${answers.interaction === 'none' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="interaction"
                value="none"
                checked={answers.interaction === 'none'}
                onChange={() => setAnswers({ ...answers, interaction: 'none' })}
              />
              <div className="interaction-header">
                <span className="interaction-icon">🟢</span>
                <span className="interaction-name">Chưa tương tác</span>
              </div>
              <span className="interaction-badge">Rủi ro thấp · Ưu tiên P3</span>
              <p className="interaction-desc">
                Chỉ mới nhận được thư/tin nhắn, chưa bấm bất kỳ liên kết nào và chưa tải tệp đính kèm.
              </p>
              <span className="interaction-action-guide">✓ Hướng dẫn: Không bấm link, chuyển tiếp mẫu thư cho IT.</span>
            </label>

            {/* 2. Đã bấm vào liên kết (Clicked Link) */}
            <label className={`interaction-card card-clicked ${answers.interaction === 'clicked_link' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="interaction"
                value="clicked_link"
                checked={answers.interaction === 'clicked_link'}
                onChange={() => setAnswers({ ...answers, interaction: 'clicked_link' })}
              />
              <div className="interaction-header">
                <span className="interaction-icon">🟡</span>
                <span className="interaction-name">Đã bấm liên kết</span>
              </div>
              <span className="interaction-badge">Rủi ro trung bình · Ưu tiên P2</span>
              <p className="interaction-desc">
                Đã click mở link hoặc mở tệp đính kèm, nhưng CHƯA điền bất kỳ tài khoản/mật khẩu nào.
              </p>
              <span className="interaction-action-guide">⚠️ Hướng dẫn: Đóng tab, chuẩn bị thiết bị để IT quét mã độc.</span>
            </label>

            {/* 3. Đã nhập thông tin (Entered Information) */}
            <label className={`interaction-card card-entered ${answers.interaction === 'entered_information' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="interaction"
                value="entered_information"
                checked={answers.interaction === 'entered_information'}
                onChange={() => setAnswers({ ...answers, interaction: 'entered_information' })}
              />
              <div className="interaction-header">
                <span className="interaction-icon">🔴</span>
                <span className="interaction-name">Đã nhập thông tin</span>
              </div>
              <span className="interaction-badge">Nguy cấp · Ưu tiên P1</span>
              <p className="interaction-desc">
                Đã điền tài khoản, mật khẩu, mã OTP hoặc thông tin cá nhân lên trang web giả mạo.
              </p>
              <span className="interaction-action-guide">🚨 Khẩn cấp: Đổi mật khẩu ngay, yêu cầu IT khóa phiên.</span>
            </label>
          </div>

          {/* Tùy chọn Chưa rõ (Unknown) */}
          <div className="interaction-unknown-wrap">
            <label className="interaction-unknown-label">
              <input
                type="radio"
                name="interaction"
                value="unknown"
                checked={answers.interaction === 'unknown'}
                onChange={() => setAnswers({ ...answers, interaction: 'unknown' })}
              />
              <span>⚪ Không chắc chắn / Chưa rõ mức độ tương tác (Chuyển Hàng đợi Triage phân loại thủ công)</span>
            </label>
          </div>
        </div>

        {/* ================================================================= */}
        {/* GRID THÔNG TIN CHI TIẾT SỰ CỐ                                      */}
        {/* ================================================================= */}
        <div className="n6-phishing-grid">
          <label>
            Tiêu đề báo cáo (*)
            <input
              id={titleInputId}
              value={form.title}
              maxLength={120}
              placeholder="VD: Email giả mạo thông báo đóng học phí học kỳ 1"
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'title-error' : undefined}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            {fieldError('title')}
          </label>

          <label>
            Kênh nhận thư / tin nhắn (*)
            <select
              value={answers.channel}
              onChange={(e) => setAnswers({ ...answers, channel: e.target.value as PhishingAnswers['channel'] })}
            >
              <option value="email">Email (Hòm thư trường / cá nhân)</option>
              <option value="message">Tin nhắn (SMS, Zalo, Teams, Messenger)</option>
              <option value="other">Kênh khác (Mạng xã hội, cuộc gọi, mã QR)</option>
            </select>
          </label>

          <label className="n6-form-wide">
            Địa chỉ người gửi / Tên miền trang web nghi vấn (tối đa 254 ký tự)
            <input
              id={senderInputId}
              value={form.sender_text}
              maxLength={254}
              placeholder="VD: noreply-usth@gmail.com hoặc http://portal-usth-login.fake-site.com"
              aria-invalid={Boolean(errors.sender_text)}
              aria-describedby={errors.sender_text ? 'sender_text-error' : undefined}
              onChange={(e) => setForm({ ...form, sender_text: e.target.value })}
            />
            {fieldError('sender_text')}
          </label>

          <label className="n6-form-wide">
            Mô tả chi tiết nội dung lừa đảo (*)
            <textarea
              id={descInputId}
              value={form.description}
              rows={4}
              maxLength={2000}
              placeholder="Mô tả cụ thể: Kẻ xấu xưng danh ai, yêu cầu làm gì, có đính kèm file gì? (Lưu ý: Tuyệt đối KHÔNG gõ mật khẩu hay mã OTP vào đây)"
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? 'description-error' : undefined}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            {fieldError('description')}
          </label>

          <label>
            Tòa nhà hoặc khu vực nhận tin (*)
            <input
              id={buildingInputId}
              value={form.building}
              maxLength={120}
              placeholder="VD: Tòa B, Thư viện, Ký túc xá..."
              aria-invalid={Boolean(errors.building)}
              aria-describedby={errors.building ? 'building-error' : undefined}
              onChange={(e) => setForm({ ...form, building: e.target.value })}
            />
            {fieldError('building')}
          </label>

          <label>
            Vị trí chi tiết (không bắt buộc)
            <input
              value={form.location_detail}
              maxLength={200}
              placeholder="VD: Phòng Lab 304, Khu tự học..."
              aria-invalid={Boolean(errors.location_detail)}
              aria-describedby={errors.location_detail ? 'location_detail-error' : undefined}
              onChange={(e) => setForm({ ...form, location_detail: e.target.value })}
            />
            {fieldError('location_detail')}
          </label>

          <label>
            Thời điểm nhận / phát hiện (không bắt buộc)
            <input
              type="datetime-local"
              value={form.observed_at}
              aria-invalid={Boolean(errors.observed_at)}
              aria-describedby={errors.observed_at ? 'observed_at-error' : undefined}
              onChange={(e) => setForm({ ...form, observed_at: e.target.value })}
            />
            {fieldError('observed_at')}
          </label>
        </div>

        {notice && (
          <p
            className={`n6-form-notice ${notice.kind}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            {notice.text}
          </p>
        )}

        <div>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Đang gửi…' : '🛡️ Gửi báo cáo Phishing'}
          </button>
        </div>
      </form>
    </section>
  )
}
