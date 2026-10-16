import type { ContractError, ContractErrorDetail } from '../types/incident.ts'

export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'req-' + Math.random().toString(36).substring(2, 11)
}

export function createContractError(
  code: string,
  message: string,
  details?: ContractErrorDetail[],
  requestId?: string
): ContractError {
  return {
    error: {
      code,
      message,
      details,
      request_id: requestId ?? generateRequestId(),
    },
  }
}

export const ErrorPresets = {
  unauthenticated: (): ContractError =>
    createContractError(
      'unauthenticated',
      'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.'
    ),

  invalidCredentials: (): ContractError =>
    createContractError(
      'invalid_credentials',
      'Email hoặc mật khẩu không chính xác.'
    ),

  forbidden: (action?: string): ContractError =>
    createContractError(
      'forbidden',
      `Bạn không có quyền thực hiện hành động này${action ? ` (${action})` : ''}.`
    ),

  notFound: (): ContractError =>
    createContractError(
      'not_found',
      'Không tìm thấy bản ghi hoặc bạn không có quyền truy cập.'
    ),

  versionConflict: (expectedVersion: number, actualVersion: number): ContractError =>
    createContractError(
      'version_conflict',
      'Bản ghi đã thay đổi bởi thao tác khác. Hãy tải lại trước khi tiếp tục.',
      [
        {
          field: 'expected_version',
          reason: `Gửi expected_version=${expectedVersion} nhưng server hiện tại là version=${actualVersion}`,
        },
      ]
    ),

  idempotencyConflict: (): ContractError =>
    createContractError(
      'idempotency_conflict',
      'Khóa Idempotency-Key đã được sử dụng với payload khác.'
    ),

  invalidTransition: (fromStatus: string, toStatus: string): ContractError =>
    createContractError(
      'invalid_transition',
      `Không thể chuyển trạng thái từ '${fromStatus}' sang '${toStatus}'.`
    ),

  validationError: (details: ContractErrorDetail[]): ContractError =>
    createContractError(
      'validation_error',
      'Dữ liệu yêu cầu không hợp lệ theo quy tắc của hệ thống.',
      details
    ),

  fileTooLarge: (maxMb = 10): ContractError =>
    createContractError(
      'file_too_large',
      `Kích thước tệp vượt quá giới hạn tối đa cho phép (${maxMb} MiB).`
    ),

  unsupportedMediaType: (allowed = 'PDF, PNG, JPEG'): ContractError =>
    createContractError(
      'unsupported_media_type',
      `Định dạng tệp không được hỗ trợ. Chỉ chấp nhận các định dạng: ${allowed}.`
    ),

  rateLimited: (): ContractError =>
    createContractError(
      'rate_limited',
      'Đã vượt quá giới hạn số lần yêu cầu. Vui lòng thử lại sau.'
    ),

  serviceUnavailable: (): ContractError =>
    createContractError(
      'service_unavailable',
      'Dịch vụ tạm thời gián đoạn. Vui lòng kiểm tra lại sau.'
    ),
}
