export interface PhishingFormValues {
  title: string
  description: string
  building: string
  location_detail: string
  observed_at: string
  sender_text: string
}

export type FieldErrors = Record<string, string>

/**
 * Kiểm tra xem chuỗi văn bản có chứa mật khẩu, mã OTP hoặc thông tin bí mật không.
 * Tiêu chí hoàn thành cốt lõi: "Không gửi/lưu secret".
 */
export function detectSecretLeak(text: string): { hasSecret: boolean; reason?: string } {
  if (!text) return { hasSecret: false }

  // 1. Nhận diện từ khóa mật khẩu / password kèm giá trị
  // VD: "password: 123", "pass: abc", "mật khẩu là xyz", "pwd: ..."
  const passwordPattern = /\b(password|passwd|pass|pwd|mat khau|mật khẩu)\b\s*[:=]\s*(\S+)/i
  if (passwordPattern.test(text)) {
    return {
      hasSecret: true,
      reason: 'Phát hiện mật khẩu trong nội dung. Tuyệt đối không nhập mật khẩu vào biểu mẫu báo cáo!',
    }
  }

  // 2. Nhận diện mã OTP (One-Time Password)
  // VD: "otp: 123456", "mã otp là 123456", "otp code 987654", "ma otp: 456789"
  const otpPattern = /\b(otp|one time password|ma xac thuc|mã xác thực|ma otp|mã otp)\b(\s*(code|is|la|là|:|=)?\s*)\d{4,8}\b/i
  if (otpPattern.test(text)) {
    return {
      hasSecret: true,
      reason: 'Phát hiện mã xác thực OTP trong nội dung. Tuyệt đối không chia sẻ mã OTP vào biểu mẫu báo cáo!',
    }
  }

  // 3. Nhận diện token bí mật / secret keys
  const secretKeyPattern = /\b(secret_key|private_key|auth_token|bearer\s+[a-zA-Z0-9_\-.]+)\b/i
  if (secretKeyPattern.test(text)) {
    return {
      hasSecret: true,
      reason: 'Phát hiện token hoặc khóa bí mật trong nội dung.',
    }
  }

  return { hasSecret: false }
}

export function validatePhishingForm(form: PhishingFormValues): FieldErrors {
  const errors: FieldErrors = {}

  // 1. Kiểm tra tiêu đề (5 - 120 ký tự)
  if (form.title.trim().length < 5 || form.title.trim().length > 120) {
    errors.title = 'Nhập tiêu đề từ 5 đến 120 ký tự.'
  } else {
    const leak = detectSecretLeak(form.title)
    if (leak.hasSecret) {
      errors.title = leak.reason || 'Tiêu đề không được chứa thông tin bí mật hoặc mật khẩu/OTP.'
    }
  }

  // 2. Kiểm tra mô tả (20 - 2000 ký tự)
  if (form.description.trim().length < 20 || form.description.trim().length > 2000) {
    errors.description = 'Nhập mô tả từ 20 đến 2000 ký tự.'
  } else {
    const leak = detectSecretLeak(form.description)
    if (leak.hasSecret) {
      errors.description = leak.reason || 'Mô tả không được chứa thông tin bí mật hoặc mật khẩu/OTP.'
    }
  }

  // 3. Tòa nhà hoặc khu vực (1 - 120 ký tự)
  if (!form.building.trim() || form.building.trim().length > 120) {
    errors.building = 'Nhập tòa nhà hoặc khu vực, tối đa 120 ký tự.'
  }

  // 4. Vị trí chi tiết (tối đa 200 ký tự)
  if (form.location_detail.length > 200) {
    errors.location_detail = 'Vị trí chi tiết tối đa 200 ký tự.'
  }

  // 5. Người gửi / tên miền / đường link (tối đa 254 ký tự)
  if (form.sender_text.length > 254) {
    errors.sender_text = 'Địa chỉ người gửi hoặc tên miền tối đa 254 ký tự.'
  } else if (form.sender_text.trim()) {
    const leak = detectSecretLeak(form.sender_text)
    if (leak.hasSecret) {
      errors.sender_text = leak.reason || 'Thông tin người gửi không được chứa mật khẩu/OTP.'
    }
  }

  // 6. Thời điểm quan sát (không được ở tương lai)
  const observedAt = form.observed_at ? new Date(form.observed_at).getTime() : null
  if (observedAt !== null && (!Number.isFinite(observedAt) || observedAt > Date.now())) {
    errors.observed_at = 'Thời điểm quan sát phải hợp lệ và không ở tương lai.'
  }

  return errors
}
