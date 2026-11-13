import { useState, type FormEvent } from 'react'
import './ElectricalHazardReportForm.css'
import { demoClient } from '../../api/demo-client.ts'
import { mockApi } from '../../mocks/mock-api-service.ts'
import type { ElectricalHazardAnswers } from '../../types/incident.ts'
import { validateElectricalHazardForm, type FieldErrors } from './validate-electrical-hazard-form.ts'

const initialForm = {
  title: '',
  description: '',
  building: '',
  location_detail: '',
  observed_at: '',
  equipment: '',
}

const initialAnswers: ElectricalHazardAnswers = {
  exposed_wire: 'unknown',
  smoke_or_sparks: 'unknown',
  equipment: null,
}

function apiError(error: unknown): { message?: string; details?: Array<{ field: string; reason: string }> } {
  if (!error || typeof error !== 'object' || !('error' in error)) return {}
  const body = (error as { error?: { message?: string; details?: Array<{ field: string; reason: string }> } }).error
  return body ?? {}
}

export function ElectricalHazardReportForm() {
  const [form, setForm] = useState(initialForm)
  const [answers, setAnswers] = useState<ElectricalHazardAnswers>(initialAnswers)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors = validateElectricalHazardForm(form)
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
      const finalAnswers: ElectricalHazardAnswers = {
        exposed_wire: answers.exposed_wire,
        smoke_or_sparks: answers.smoke_or_sparks,
        equipment: form.equipment.trim() || null,
      }

      await mockApi.createIncident(
        session.user,
        {
          category: 'electrical_hazard',
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
        text: 'Đã gửi báo cáo nguy hiểm điện thành công. Sự cố đã được tiếp nhận và chuyển đến Bộ phận Điện & An toàn xử lý. Bạn có thể theo dõi trong mục “Báo cáo của tôi”.',
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

  // Cảnh báo khi có dây hở hoặc khói/tia lửa (kể cả khi chưa rõ)
  const isHighDanger = answers.exposed_wire !== 'no' || answers.smoke_or_sparks !== 'no'

  return (
    <section className="w2-panel n6-elec-page" aria-labelledby="elec-form-heading">
      <p className="w2-kicker">Người báo cáo</p>
      <h1 id="elec-form-heading">Báo cáo nguy hiểm về điện</h1>
      <p>
        Điền thông tin sự cố điện trong khuôn viên trường. Các trường hợp dây điện hở, khói, tia lửa hoặc câu trả lời “Chưa rõ” đều được hệ thống tiếp nhận theo đúng quy chuẩn an toàn.
      </p>

      {/* CẢNH BÁO AN TOÀN NGUY HIỂM TỨC THỜI - TIÊU CHÍ: KHÔNG GIẢ ĐỊNH ĐÃ CÓ CỨU HỘ */}
      {isHighDanger && (
        <aside className="n6-danger-note" role="alert" aria-live="assertive">
          <strong>🚨 CẢNH BÁO NGUY HIỂM TỨC THỜI (KHÔNG GIẢ ĐỊNH ĐÃ CÓ CỨU HỘ):</strong>
          Khu vực có khói, tia lửa hoặc dây điện hở gây nguy cơ điện giật và cháy nổ nghiêm trọng.
          Hãy giữ khoảng cách an toàn ít nhất 5 mét và thông báo ngay cho người xung quanh!
          <strong>Tuyệt đối không giả định đã có lực lượng cứu hộ hoặc kỹ thuật viên có mặt tại hiện trường.</strong>
          Nếu tình huống đe dọa an toàn tính mạng, liên hệ ngay đầu mối khẩn cấp trường (Hotline USTH: 024 3791 8618); việc gửi biểu mẫu này phục vụ quản trị kỹ thuật và <em>không thay thế cuộc gọi ứng cứu khẩn cấp</em>.
        </aside>
      )}

      <form className="n6-elec-form" onSubmit={submit} noValidate>
        <div className="n6-elec-grid">
          <label>
            Tiêu đề (*)
            <input
              value={form.title}
              maxLength={120}
              placeholder="VD: Dây điện hở tại hành lang tầng 3 tòa B"
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'title-error' : undefined}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
            {fieldError('title')}
          </label>

          <label>
            Tòa nhà hoặc khu vực (*)
            <input
              value={form.building}
              maxLength={120}
              placeholder="VD: Tòa B, Tòa C, Thư viện..."
              aria-invalid={Boolean(errors.building)}
              aria-describedby={errors.building ? 'building-error' : undefined}
              onChange={(event) => setForm({ ...form, building: event.target.value })}
            />
            {fieldError('building')}
          </label>

          <label className="n6-form-wide">
            Mô tả chi tiết sự cố (*)
            <textarea
              value={form.description}
              rows={4}
              maxLength={2000}
              placeholder="Mô tả cụ thể hiện trạng: có mùi khét, tia lửa phát ra từ đâu, mức độ ảnh hưởng đến người xung quanh..."
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? 'description-error' : undefined}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
            {fieldError('description')}
          </label>

          <label>
            Vị trí chi tiết (không bắt buộc)
            <input
              value={form.location_detail}
              maxLength={200}
              placeholder="VD: Phòng Lab 304, cột B3-05..."
              aria-invalid={Boolean(errors.location_detail)}
              aria-describedby={errors.location_detail ? 'location_detail-error' : undefined}
              onChange={(event) => setForm({ ...form, location_detail: event.target.value })}
            />
            {fieldError('location_detail')}
          </label>

          <label>
            Thời điểm quan sát (không bắt buộc)
            <input
              type="datetime-local"
              value={form.observed_at}
              aria-invalid={Boolean(errors.observed_at)}
              aria-describedby={errors.observed_at ? 'observed_at-error' : undefined}
              onChange={(event) => setForm({ ...form, observed_at: event.target.value })}
            />
            {fieldError('observed_at')}
          </label>

          {/* CÂU HỎI ĐẶC THÙ NGUY HIỂM ĐIỆN */}
          <label>
            Có dây điện hở / lộ lõi đồng không? (*)
            <select
              value={answers.exposed_wire}
              onChange={(event) =>
                setAnswers({ ...answers, exposed_wire: event.target.value as ElectricalHazardAnswers['exposed_wire'] })
              }
            >
              <option value="unknown">Chưa rõ</option>
              <option value="yes">Có dây hở (Ưu tiên khẩn cấp P1)</option>
              <option value="no">Không có dây hở</option>
            </select>
            {fieldError('answers.exposed_wire')}
          </label>

          <label>
            Có khói, mùi khét hoặc tia lửa điện không? (*)
            <select
              value={answers.smoke_or_sparks}
              onChange={(event) =>
                setAnswers({
                  ...answers,
                  smoke_or_sparks: event.target.value as ElectricalHazardAnswers['smoke_or_sparks'],
                })
              }
            >
              <option value="unknown">Chưa rõ</option>
              <option value="yes">Có khói hoặc tia lửa (Critical P1)</option>
              <option value="no">Không có khói/tia lửa</option>
            </select>
            {fieldError('answers.smoke_or_sparks')}
          </label>

          <label className="n6-form-wide">
            Thiết bị liên quan (nếu biết, tối đa 200 ký tự)
            <input
              value={form.equipment}
              maxLength={200}
              placeholder="VD: Ổ cắm âm sàn, máy lạnh trung tâm, máy chiếu hội trường..."
              aria-invalid={Boolean(errors.equipment)}
              aria-describedby={errors.equipment ? 'equipment-error' : undefined}
              onChange={(event) => setForm({ ...form, equipment: event.target.value })}
            />
            {fieldError('equipment')}
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
            {submitting ? 'Đang gửi…' : '⚡ Gửi báo cáo nguy hiểm điện'}
          </button>
        </div>
      </form>
    </section>
  )
}
