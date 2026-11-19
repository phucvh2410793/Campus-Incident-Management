export interface WaterLeakFormValues {
  title: string
  description: string
  building: string
  location_detail: string
  observed_at: string
}

export type FieldErrors = Record<string, string>

export function validateWaterLeakForm(form: WaterLeakFormValues): FieldErrors {
  const errors: FieldErrors = {}
  if (form.title.trim().length < 5 || form.title.trim().length > 120) errors.title = 'Nhập tiêu đề từ 5 đến 120 ký tự.'
  if (form.description.trim().length < 20 || form.description.trim().length > 2000) errors.description = 'Nhập mô tả từ 20 đến 2000 ký tự.'
  if (!form.building.trim() || form.building.trim().length > 120) errors.building = 'Nhập tòa nhà hoặc khu vực, tối đa 120 ký tự.'
  if (form.location_detail.length > 200) errors.location_detail = 'Vị trí chi tiết tối đa 200 ký tự.'
  const observedAt = form.observed_at ? new Date(form.observed_at).getTime() : null
  if (observedAt !== null && (!Number.isFinite(observedAt) || observedAt > Date.now())) errors.observed_at = 'Thời điểm quan sát phải hợp lệ và không ở tương lai.'
  return errors
}
