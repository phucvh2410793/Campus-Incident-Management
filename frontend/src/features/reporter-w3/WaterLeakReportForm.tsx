import { useState, type FormEvent } from 'react'
import './WaterLeakReportForm.css'
import { demoClient } from '../../api/demo-client.ts'
import { mockApi } from '../../mocks/mock-api-service.ts'
import type { WaterLeakAnswers } from '../../types/incident.ts'
import { validateWaterLeakForm, type FieldErrors } from './validate-water-leak-form.ts'

const initialForm = { title: '', description: '', building: '', location_detail: '', observed_at: '' }
const initialAnswers: WaterLeakAnswers = { leak_amount: 'unknown', near_electricity: 'unknown', slip_risk: null }

function apiError(error: unknown): { message?: string; details?: Array<{ field: string; reason: string }> } {
  if (!error || typeof error !== 'object' || !('error' in error)) return {}
  const body = (error as { error?: { message?: string; details?: Array<{ field: string; reason: string }> } }).error
  return body ?? {}
}

export function WaterLeakReportForm() {
  const [form, setForm] = useState(initialForm)
  const [answers, setAnswers] = useState<WaterLeakAnswers>(initialAnswers)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors = validateWaterLeakForm(form)
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
      await mockApi.createIncident(session.user, {
        category: 'water_leak',
        title: form.title.trim(),
        description: form.description.trim(),
        building: form.building.trim(),
        location_detail: form.location_detail.trim() || null,
        observed_at: form.observed_at ? new Date(form.observed_at).toISOString() : null,
        answers,
      }, idempotencyKey)
      setForm(initialForm)
      setAnswers(initialAnswers)
      setErrors({})
      setIdempotencyKey(crypto.randomUUID())
      setNotice({ kind: 'success', text: 'Đã gửi báo cáo rò nước. Bạn có thể xem báo cáo trong mục “Báo cáo của tôi”.' })
    } catch (error) {
      const response = apiError(error)
      setErrors(Object.fromEntries((response.details ?? []).map(({ field, reason }) => [field, reason])))
      setNotice({ kind: 'error', text: response.message ?? (error instanceof Error ? error.message : 'Không gửi được báo cáo. Hãy thử lại.') })
    } finally {
      setSubmitting(false)
    }
  }

  const fieldError = (name: string) => errors[name] && <p className="n6-field-error" id={`${name}-error`}>{errors[name]}</p>
  const unsafeArea = answers.near_electricity !== 'no'

  return (
    <section className="w2-panel n6-water-page" aria-labelledby="water-form-heading">
      <p className="w2-kicker">Người báo cáo</p>
      <h1 id="water-form-heading">Báo cáo rò nước</h1>
      <p>Điền thông tin sự cố. Những câu trả lời “Chưa rõ” vẫn được chấp nhận.</p>
      <form className="n6-water-form" onSubmit={submit} noValidate>
        <div className="n6-form-grid">
          <label>Tiêu đề
            <input value={form.title} maxLength={120} aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? 'title-error' : undefined} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            {fieldError('title')}
          </label>
          <label>Tòa nhà hoặc khu vực
            <input value={form.building} maxLength={120} aria-invalid={Boolean(errors.building)} aria-describedby={errors.building ? 'building-error' : undefined} onChange={(event) => setForm({ ...form, building: event.target.value })} />
            {fieldError('building')}
          </label>
          <label className="n6-form-wide">Mô tả
            <textarea value={form.description} rows={4} maxLength={2000} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? 'description-error' : undefined} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            {fieldError('description')}
          </label>
          <label>Vị trí chi tiết (không bắt buộc)
            <input value={form.location_detail} maxLength={200} aria-invalid={Boolean(errors.location_detail)} aria-describedby={errors.location_detail ? 'location_detail-error' : undefined} onChange={(event) => setForm({ ...form, location_detail: event.target.value })} />
            {fieldError('location_detail')}
          </label>
          <label>Thời điểm quan sát (không bắt buộc)
            <input type="datetime-local" value={form.observed_at} aria-invalid={Boolean(errors.observed_at)} aria-describedby={errors.observed_at ? 'observed_at-error' : undefined} onChange={(event) => setForm({ ...form, observed_at: event.target.value })} />
            {fieldError('observed_at')}
          </label>
          <label>Lượng nước rò rỉ
            <select value={answers.leak_amount} onChange={(event) => setAnswers({ ...answers, leak_amount: event.target.value as WaterLeakAnswers['leak_amount'] })}>
              <option value="small">Ít</option><option value="large">Nhiều</option><option value="unknown">Chưa rõ</option>
            </select>
            {fieldError('answers.leak_amount')}
          </label>
          <label>Có ở gần nguồn điện không?
            <select value={answers.near_electricity} onChange={(event) => setAnswers({ ...answers, near_electricity: event.target.value as WaterLeakAnswers['near_electricity'] })}>
              <option value="unknown">Chưa rõ</option><option value="yes">Có</option><option value="no">Không</option>
            </select>
            {fieldError('answers.near_electricity')}
          </label>
          <label>Nguy cơ trơn trượt
            <select value={answers.slip_risk === null ? 'unknown' : answers.slip_risk ? 'yes' : 'no'} onChange={(event) => setAnswers({ ...answers, slip_risk: event.target.value === 'unknown' ? null : event.target.value === 'yes' })}>
              <option value="unknown">Chưa rõ</option><option value="yes">Có</option><option value="no">Không</option>
            </select>
          </label>
        </div>
        {unsafeArea && <aside className="n6-safety-note" role="note"><strong>Lưu ý an toàn:</strong> Tránh xa vùng nước có thể tiếp xúc với điện, không chạm vào thiết bị hoặc dây điện ướt và cảnh báo người xung quanh. Nếu có nguy hiểm tức thời, liên hệ bộ phận khẩn cấp của trường; không chờ phản hồi từ biểu mẫu này.</aside>}
        {notice && <p className={`n6-form-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
        <button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? 'Đang gửi…' : 'Gửi báo cáo'}</button>
      </form>
    </section>
  )
}
