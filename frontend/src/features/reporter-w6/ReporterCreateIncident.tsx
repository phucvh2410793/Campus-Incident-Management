import { useState, useRef, useId } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { demoClient } from '../../api/demo-client.ts'
import type { Category, FormAnswers, IncidentResponse, AttachmentSummary } from '../../types/incident.ts'
import './ReporterCreateIncident.css'

export interface SelectedFileItem {
  id: string
  file?: File
  name: string
  sizeBytes: number
  mimeType: string
  signature?: number[]
  simulateError?: 'too_large' | 'bad_mime' | 'none'
}

export interface UploadProgressItem {
  id: string
  name: string
  sizeBytes: number
  mimeType: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  errorReason?: string
  errorCode?: string
  attachment?: AttachmentSummary
}

interface ReporterCreateIncidentProps {
  onIncidentCreated?: (incident: IncidentResponse) => void
  onCancel?: () => void
}

export function ReporterCreateIncident({ onIncidentCreated, onCancel }: ReporterCreateIncidentProps) {
  // --- Form State ---
  const [category, setCategory] = useState<Category>('water_leak')
  const [title, setTitle] = useState('')
  const [building, setBuilding] = useState('Tòa A')
  const [locationDetail, setLocationDetail] = useState('')
  const [observedAt, setObservedAt] = useState(() => {
    const now = new Date()
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
    return now.toISOString().slice(0, 16)
  })
  const [description, setDescription] = useState('')

  // Answers State
  const [waterLeakAmount, setWaterLeakAmount] = useState<'small' | 'large' | 'unknown'>('small')
  const [waterNearElec, setWaterNearElec] = useState<'yes' | 'no' | 'unknown'>('no')
  const [waterSlipRisk, setWaterSlipRisk] = useState(true)

  const [elecExposedWire, setElecExposedWire] = useState<'yes' | 'no' | 'unknown'>('no')
  const [elecSmokeSparks, setElecSmokeSparks] = useState<'yes' | 'no' | 'unknown'>('no')
  const [elecEquipment, setElecEquipment] = useState('')

  const [phishInteraction, setPhishInteraction] = useState<'none' | 'clicked_link' | 'entered_information' | 'unknown'>('none')
  const [phishChannel, setPhishChannel] = useState<'email' | 'message' | 'other'>('email')
  const [phishSenderText, setPhishSenderText] = useState('')

  // Anti-duplicate Idempotency Key
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID())
  const [allowReuseKey, setAllowReuseKey] = useState(false)

  // Attachments State
  const [selectedFiles, setSelectedFiles] = useState<SelectedFileItem[]>([])

  // Submission & Upload Progression State
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSubmittingRef = useRef(false)
  const [submitStage, setSubmitStage] = useState<'idle' | 'creating_incident' | 'uploading_files' | 'completed'>('idle')
  const [createdIncident, setCreatedIncident] = useState<IncidentResponse | null>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadProgressItem[]>([])
  const [incidentError, setIncidentError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isRetryingFileId, setIsRetryingFileId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const titleFieldId = useId()
  const buildingFieldId = useId()
  const locationFieldId = useId()
  const observedFieldId = useId()
  const descriptionFieldId = useId()
  const waterLeakAmountId = useId()
  const waterNearElecId = useId()
  const waterSlipRiskId = useId()
  const elecExposedWireId = useId()
  const elecSmokeSparksId = useId()
  const elecEquipmentId = useId()
  const phishInteractionId = useId()
  const phishChannelId = useId()
  const phishSenderTextId = useId()
  const filePickerInputId = useId()

  // Format bytes helper
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  // Generate new Idempotency Key
  const handleRegenerateKey = () => {
    setIdempotencyKey(crypto.randomUUID())
  }

  // Handle adding files
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    const incoming = Array.from(e.target.files)
    if (selectedFiles.length + incoming.length > 5) {
      alert('Tối đa 5 tệp đính kèm cho mỗi báo cáo sự cố theo quy định.')
    }

    const validNewFiles: SelectedFileItem[] = incoming
      .slice(0, 5 - selectedFiles.length)
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        sizeBytes: file.size,
        mimeType: file.type || 'image/png',
        signature: file.type === 'application/pdf' ? [37, 80, 68, 70, 45] :
                   file.type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255],
        simulateError: 'none',
      }))

    setSelectedFiles((prev) => [...prev, ...validNewFiles])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Add demo test file directly
  const handleAddDemoFile = (type: 'valid_pdf' | 'oversized_11mb' | 'invalid_exe') => {
    if (selectedFiles.length >= 5) {
      alert('Đã đạt giới hạn tối đa 5 tệp.')
      return
    }

    if (type === 'valid_pdf') {
      setSelectedFiles((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          name: `bang_chung_hop_le_${Date.now().toString().slice(-4)}.pdf`,
          sizeBytes: 1.2 * 1024 * 1024,
          mimeType: 'application/pdf',
          signature: [37, 80, 68, 70, 45],
          simulateError: 'none',
        },
      ])
    } else if (type === 'oversized_11mb') {
      setSelectedFiles((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          name: `video_hien_truong_qua_10mb_${Date.now().toString().slice(-4)}.pdf`,
          sizeBytes: 11.5 * 1024 * 1024, // 11.5 MB (>10MB limit)
          mimeType: 'application/pdf',
          signature: [37, 80, 68, 70, 45],
          simulateError: 'too_large',
        },
      ])
    } else if (type === 'invalid_exe') {
      setSelectedFiles((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          name: `script_chay_thu_${Date.now().toString().slice(-4)}.exe`,
          sizeBytes: 500 * 1024,
          mimeType: 'application/x-msdownload',
          signature: [77, 90], // MZ
          simulateError: 'bad_mime',
        },
      ])
    }
  }

  const handleRemoveFile = (id: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id))
  }

  // Client validation
  const validateForm = (): boolean => {
    const errs: Record<string, string> = {}
    if (!title.trim() || title.trim().length < 5 || title.trim().length > 120) {
      errs.title = 'Tiêu đề bắt buộc từ 5 đến 120 ký tự.'
    }
    if (!building.trim()) {
      errs.building = 'Vui lòng chọn tòa nhà / khu vực.'
    }
    if (!description.trim() || description.trim().length < 20 || description.trim().length > 2000) {
      errs.description = 'Mô tả bắt buộc từ 20 đến 2000 ký tự (Hiện tại: ' + description.trim().length + ' ký tự).'
    }
    if (observedAt) {
      const parsedTime = new Date(observedAt).getTime()
      if (parsedTime > Date.now() + 60000) {
        errs.observedAt = 'Thời điểm quan sát không được ở tương lai.'
      }
    }
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  // Build Answers Payload per contract
  const buildAnswersPayload = (): FormAnswers => {
    if (category === 'water_leak') {
      return {
        leak_amount: waterLeakAmount,
        near_electricity: waterNearElec,
        slip_risk: waterSlipRisk,
      }
    } else if (category === 'electrical_hazard') {
      return {
        exposed_wire: elecExposedWire,
        smoke_or_sparks: elecSmokeSparks,
        equipment: elecEquipment.trim() || null,
      }
    } else {
      return {
        interaction: phishInteraction,
        channel: phishChannel,
        sender_text: phishSenderText.trim() || null,
      }
    }
  }

  // --- SUBMIT WORKFLOW (Anti-Duplicate + Sequential Upload) ---
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    // Anti-duplicate protection: prevent double submission
    if (isSubmittingRef.current || isSubmitting) {
      return
    }

    if (!validateForm()) {
      return
    }

    isSubmittingRef.current = true
    setIsSubmitting(true)
    setSubmitStage('creating_incident')
    setIncidentError(null)

    let incident: IncidentResponse | null = null

    try {
      const answers = buildAnswersPayload()
      const utcObserved = observedAt ? new Date(observedAt).toISOString() : new Date().toISOString()

      // BƯỚC 1: Tạo incident với Idempotency-Key
      const response = await demoClient.createIncident(
        {
          category,
          title: title.trim(),
          description: description.trim(),
          building: building.trim(),
          location_detail: locationDetail.trim() || null,
          observed_at: utcObserved,
          answers,
        },
        idempotencyKey
      )

      incident = response.data
      setCreatedIncident(incident)

      // Nếu không cho phép dùng lại cùng key, chuẩn bị key mới cho lần sau
      if (!allowReuseKey) {
        setIdempotencyKey(crypto.randomUUID())
      }
    } catch (err: unknown) {
      const contractErr = err as { error?: { message?: string; details?: Array<{ field: string; reason: string }> } }
      const msg = contractErr?.error?.message || 'Không thể tạo sự cố. Vui lòng kiểm tra lại.'
      setIncidentError(msg)
      if (contractErr?.error?.details) {
        const mapped: Record<string, string> = {}
        contractErr.error.details.forEach((d) => {
          mapped[d.field] = d.reason
        })
        setFieldErrors(mapped)
      }
      setIsSubmitting(false)
      isSubmittingRef.current = false
      setSubmitStage('idle')
      return
    }

    // BƯỚC 2: Tải lên từng tệp bằng chứng theo tuần tự
    setSubmitStage('uploading_files')
    let currentVersion = incident.version

    const initialProgress: UploadProgressItem[] = selectedFiles.map((file) => ({
      id: file.id,
      name: file.name,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      status: 'pending',
    }))
    setUploadProgress(initialProgress)

    // Duyệt và upload từng file một cách tuần tự (đảm bảo expected_version tăng dần đúng contract)
    for (let i = 0; i < selectedFiles.length; i++) {
      const fileItem = selectedFiles[i]

      // Đánh dấu file đang upload
      setUploadProgress((prev) =>
        prev.map((item, idx) => (idx === i ? { ...item, status: 'uploading' } : item))
      )

      try {
        const att = await demoClient.uploadAttachment(
          incident.id,
          {
            filename: fileItem.name,
            sizeBytes: fileItem.sizeBytes,
            mimeType: fileItem.mimeType,
            signature: fileItem.signature,
          },
          currentVersion
        )

        // Upload thành công file này: cập nhật phiên bản sự cố
        currentVersion = att.incident_version

        setUploadProgress((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: 'success', attachment: att } : item
          )
        )
      } catch (err: unknown) {
        // Upload thất bại file này: ghi nhận lỗi riêng của file mà KHÔNG xóa incident!
        const contractErr = err as {
          error?: {
            code?: string
            message?: string
            details?: Array<{ field: string; reason: string }>
          }
        }
        const reason =
          contractErr?.error?.details?.[0]?.reason ||
          contractErr?.error?.message ||
          'Tệp bị từ chối bởi hệ thống kiểm soát.'

        setUploadProgress((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? {
                  ...item,
                  status: 'error',
                  errorCode: contractErr?.error?.code || 'upload_failed',
                  errorReason: reason,
                }
              : item
          )
        )
      }
    }

    // Cập nhật version mới nhất cho incident lưu trong state
    setCreatedIncident({ ...incident, version: currentVersion })
    setSubmitStage('completed')
    setIsSubmitting(false)
    isSubmittingRef.current = false

    if (onIncidentCreated) {
      onIncidentCreated({ ...incident, version: currentVersion })
    }
  }

  // --- RETRY FAILED FILE INDIVIDUALLY ---
  const handleRetryFile = async (item: UploadProgressItem) => {
    if (!createdIncident || isRetryingFileId) return

    setIsRetryingFileId(item.id)
    setUploadProgress((prev) =>
      prev.map((p) => (p.id === item.id ? { ...p, status: 'uploading', errorReason: undefined } : p))
    )

    try {
      // Giả sử retry với kích thước chuẩn 1MB nếu trước đó giả lập quá dung lượng
      const adjustedSize = item.sizeBytes > 10 * 1024 * 1024 ? 1.5 * 1024 * 1024 : item.sizeBytes
      const adjustedMime = item.mimeType.includes('msdownload') ? 'application/pdf' : item.mimeType
      const adjustedSig = adjustedMime === 'application/pdf' ? [37, 80, 68, 70, 45] : [255, 216, 255]

      const att = await demoClient.uploadAttachment(
        createdIncident.id,
        {
          filename: item.name.replace(/\.exe$/, '.pdf'),
          sizeBytes: adjustedSize,
          mimeType: adjustedMime,
          signature: adjustedSig,
        },
        createdIncident.version
      )

      setCreatedIncident((prev) => (prev ? { ...prev, version: att.incident_version } : prev))

      setUploadProgress((prev) =>
        prev.map((p) =>
          p.id === item.id
            ? {
                ...p,
                status: 'success',
                sizeBytes: adjustedSize,
                mimeType: adjustedMime,
                attachment: att,
                errorReason: undefined,
              }
            : p
        )
      )
    } catch (err: unknown) {
      const contractErr = err as { error?: { message?: string; details?: Array<{ field: string; reason: string }> } }
      const reason =
        contractErr?.error?.details?.[0]?.reason ||
        contractErr?.error?.message ||
        'Tải lại thất bại.'

      setUploadProgress((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, status: 'error', errorReason: reason } : p))
      )
    } finally {
      setIsRetryingFileId(null)
    }
  }

  // Đếm số lượng file lỗi và file thành công
  const failedFileCount = uploadProgress.filter((p) => p.status === 'error').length
  const successFileCount = uploadProgress.filter((p) => p.status === 'success').length
  const totalFiles = uploadProgress.length

  // ==========================================
  // RENDER COMPLETION STATE
  // ==========================================
  if (submitStage === 'completed' && createdIncident) {
    const hasFiles = totalFiles > 0
    const hasFailedFiles = failedFileCount > 0

    return (
      <section className="reporter-create-container gui-fade-transition" aria-labelledby="create-result-heading">
        <div className="result-screen-card">
          {/* BANNER 1: THÀNH CÔNG MỘT PHẦN (CÓ FILE LỖI - ĐÚNG TIÊU CHÍ HOÀN THÀNH) */}
          {hasFailedFiles ? (
            <div className="result-banner banner-partial-success" role="alert">
              <span className="result-banner-icon">⚠️</span>
              <div className="result-banner-content">
                <h3 id="create-result-heading">Sự cố đã tạo thành công, nhưng có {failedFileCount}/{totalFiles} tệp đính kèm bị lỗi tải lên</h3>
                <p>
                  <strong>KHÔNG THÀNH CÔNG TOÀN BỘ:</strong> Báo cáo sự cố đã được ghi nhận vào hệ thống với mã{' '}
                  <code>{createdIncident.id}</code> (Phiên bản v{createdIncident.version}). Tuy nhiên, một số tệp đính kèm đã bị từ chối
                  theo hợp đồng kiểm soát dữ liệu. Vui lòng kiểm tra lý do lỗi cụ thể bên dưới hoặc nhấn nút thử tải lại.
                </p>
              </div>
            </div>
          ) : (
            /* BANNER 2: THÀNH CÔNG TOÀN BỘ (KHI TẤT CẢ FILE ĐỀU ĐẠT) */
            <div className="result-banner banner-all-success" role="status">
              <span className="result-banner-icon">✓</span>
              <div className="result-banner-content">
                <h3 id="create-result-heading">Báo cáo sự cố và toàn bộ tệp đính kèm đã được gửi thành công!</h3>
                <p>
                  Sự cố đã được lưu thành công với mã <code>{createdIncident.id}</code> (Phiên bản v{createdIncident.version}).
                  {hasFiles ? ` Đã tải lên đủ ${successFileCount}/${totalFiles} tệp bằng chứng.` : ' Không có tệp đính kèm nào.'}
                </p>
              </div>
            </div>
          )}

          {/* Incident Summary Card */}
          <div className="form-section-card">
            <div className="section-legend">
              <span>Chi tiết sự cố vừa ghi nhận</span>
              <span className="status-chip success">Đã tạo trên hệ thống</span>
            </div>
            <div className="form-grid-2">
              <div><strong>Mã sự cố:</strong> <code style={{ fontSize: '0.85rem' }}>{createdIncident.id}</code></div>
              <div><strong>Tiêu đề:</strong> {createdIncident.title}</div>
              <div><strong>Khu vực:</strong> {createdIncident.building} {createdIncident.location_detail ? `(${createdIncident.location_detail})` : ''}</div>
              <div><strong>Loại sự cố:</strong> {createdIncident.category === 'water_leak' ? '💧 Rò nước' : createdIncident.category === 'electrical_hazard' ? '⚡ Nguy hiểm điện' : '🎣 Phishing'}</div>
              <div><strong>Thời gian báo:</strong> {new Date(createdIncident.reported_at).toLocaleString('vi-VN')}</div>
              <div><strong>Phiên bản hiện tại:</strong> v{createdIncident.version}</div>
            </div>
          </div>

          {/* Sequential Files Upload Progression & Individual Error Table */}
          {hasFiles && (
            <div className="form-section-card">
              <div className="section-legend">
                <span>Tình trạng tải lên từng tệp bằng chứng</span>
                <span className="status-chip pending">
                  Thành công: {successFileCount}/{totalFiles} | Lỗi: {failedFileCount}/{totalFiles}
                </span>
              </div>

              <table className="sequential-upload-table" aria-label="Bảng trạng thái tệp đính kèm">
                <thead>
                  <tr>
                    <th>Tên tệp</th>
                    <th>Dung lượng</th>
                    <th>Định dạng</th>
                    <th>Trạng thái &amp; Lỗi chi tiết</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadProgress.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                      </td>
                      <td>{formatSize(item.sizeBytes)}</td>
                      <td>{item.mimeType}</td>
                      <td>
                        {item.status === 'success' && (
                          <span className="status-chip success">✓ Tải lên thành công</span>
                        )}
                        {item.status === 'error' && (
                          <div>
                            <span className="status-chip error">✗ Thất bại</span>
                            <div className="file-error-detail">
                              <span>⚠️ {item.errorReason || 'Lỗi không xác định'}</span>
                              {item.errorCode && <code>({item.errorCode})</code>}
                            </div>
                          </div>
                        )}
                        {item.status === 'uploading' && (
                          <span className="status-chip uploading">⏳ Đang tải lên...</span>
                        )}
                        {item.status === 'pending' && (
                          <span className="status-chip pending">Chờ lượt</span>
                        )}
                      </td>
                      <td>
                        {item.status === 'error' && (
                          <button
                            type="button"
                            className="btn-retry-file"
                            disabled={isRetryingFileId === item.id}
                            onClick={() => handleRetryFile(item)}
                          >
                            {isRetryingFileId === item.id ? 'Đang thử lại…' : '🔄 Thử tải lại'}
                          </button>
                        )}
                        {item.status === 'success' && (
                          <span style={{ color: 'var(--success)', fontSize: '0.85rem' }}>✓ Đã lưu</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Actions Footer */}
          <div className="result-footer-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (onCancel) onCancel()
              }}
            >
              📋 Xem danh sách báo cáo của tôi
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setSubmitStage('idle')
                setCreatedIncident(null)
                setSelectedFiles([])
                setUploadProgress([])
                setTitle('')
                setDescription('')
                setLocationDetail('')
                setIdempotencyKey(crypto.randomUUID())
              }}
            >
              ✍️ Gửi thêm báo cáo sự cố khác
            </button>
          </div>
        </div>
      </section>
    )
  }

  // ==========================================
  // RENDER FORM (CREATE INCIDENT & ATTACH FILES)
  // ==========================================
  return (
    <section className="reporter-create-container gui-fade-transition" aria-labelledby="form-create-heading">
      <div className="create-header-card">
        <div className="create-header-top">
          <div>
            <p className="w2-kicker">Nghiệp vụ N6-W06 · Người báo cáo</p>
            <h1 id="form-create-heading" className="create-title">Gửi Báo Cáo Sự Cố Mới</h1>
          </div>
          <div className="idempotency-badge" title="Mã UUID chống gửi lặp tự động gắn vào Header Idempotency-Key">
            <span>🔑 Key:</span>
            <span>{idempotencyKey.slice(0, 8)}…{idempotencyKey.slice(-4)}</span>
            <button
              type="button"
              onClick={handleRegenerateKey}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
              title="Đổi khóa Idempotency mới"
            >
              🔄
            </button>
          </div>
        </div>
        <p className="create-subtitle">
          Báo cáo sự cố khuôn viên trường USTH. Hệ thống tích hợp cơ chế <strong>chống gửi lặp (Idempotency)</strong>{' '}
          và <strong>tải lên từng tệp bằng chứng độc lập</strong> theo đúng hợp đồng API.
        </p>

        {/* 1. Lựa chọn loại sự cố */}
        <div className="category-select-grid" role="radiogroup" aria-label="Chọn loại sự cố">
          <div
            className={`category-card ${category === 'water_leak' ? 'active' : ''}`}
            onClick={() => setCategory('water_leak')}
            role="radio"
            aria-checked={category === 'water_leak'}
            tabIndex={0}
          >
            <div className="cat-header">
              <span className="cat-icon-title">💧 Rò rỉ nước</span>
              <input type="radio" name="cat" checked={category === 'water_leak'} onChange={() => setCategory('water_leak')} />
            </div>
            <p className="cat-desc">Rò rỉ đường ống nước, ngấm trần, sàn nhà ướt gây trơn trượt.</p>
          </div>

          <div
            className={`category-card ${category === 'electrical_hazard' ? 'active' : ''}`}
            onClick={() => setCategory('electrical_hazard')}
            role="radio"
            aria-checked={category === 'electrical_hazard'}
            tabIndex={0}
          >
            <div className="cat-header">
              <span className="cat-icon-title">⚡ Nguy hiểm điện</span>
              <input type="radio" name="cat" checked={category === 'electrical_hazard'} onChange={() => setCategory('electrical_hazard')} />
            </div>
            <p className="cat-desc">Dây hở, khói, tia lửa điện, ổ cắm hỏng hoặc có mùi khét.</p>
          </div>

          <div
            className={`category-card ${category === 'phishing' ? 'active' : ''}`}
            onClick={() => setCategory('phishing')}
            role="radio"
            aria-checked={category === 'phishing'}
            tabIndex={0}
          >
            <div className="cat-header">
              <span className="cat-icon-title">🎣 Lừa đảo Phishing</span>
              <input type="radio" name="cat" checked={category === 'phishing'} onChange={() => setCategory('phishing')} />
            </div>
            <p className="cat-desc">Email/tin nhắn giả mạo nhà trường nhằm đánh cắp thông tin tài khoản.</p>
          </div>
        </div>
      </div>

      {/* Safety Alert Guidance Callout */}
      {category === 'water_leak' && (
        <div className="safety-alert safety-alert-water" role="note">
          <span className="safety-icon">⚠️</span>
          <div>
            <strong>HƯỚNG DẪN AN TOÀN KHI GẦN ĐIỆN:</strong> Nếu nước chảy gần khu vực bảng điện, ổ cắm hoặc thiết bị điện,
            hãy di chuyển ra xa và gọi ngay đầu mối khẩn cấp trường (Hotline: 024 3791 8618). Ứng dụng không thay thế cuộc gọi khẩn cấp.
          </div>
        </div>
      )}

      {category === 'electrical_hazard' && (
        <div className="safety-alert safety-alert-elec" role="alert">
          <span className="safety-icon">🚨</span>
          <div>
            <strong>CẢNH BÁO NGUY HIỂM TỨC THỜI:</strong> Khu vực có khói, tia lửa hoặc dây hở có nguy cơ phóng điện và cháy nổ.
            Giữ khoảng cách an toàn tối thiểu 5 mét, không chạm vào vật dẫn điện và báo cho mọi người xung quanh.
          </div>
        </div>
      )}

      {category === 'phishing' && (
        <div className="safety-alert safety-alert-phishing" role="note">
          <span className="safety-icon">🔒</span>
          <div>
            <strong>LƯU Ý BẢO MẬT TÀI KHOẢN:</strong> Tuyệt đối KHÔNG nhập mật khẩu, mã OTP, số thẻ ngân hàng vào biểu mẫu này.
            Nếu bạn đã lỡ nhập mật khẩu trên trang lạ, hãy liên hệ IT ngay để đổi mật khẩu và bảo vệ tài khoản trường.
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Incident Failure Banner */}
        {incidentError && (
          <div className="result-banner banner-incident-failed" role="alert">
            <span className="result-banner-icon">❌</span>
            <div className="result-banner-content">
              <h3>Không thể gửi báo cáo sự cố</h3>
              <p>{incidentError}</p>
            </div>
          </div>
        )}

        {/* 2. Thông tin chung theo API Contract */}
        <div className="form-section-card">
          <div className="section-legend">
            <span>1. Thông tin chung sự cố</span>
            <small style={{ color: 'var(--text-muted)' }}>(Quy chuẩn API Contract)</small>
          </div>

          <div className="form-grid-2">
            <div className="form-field form-field-full">
              <label htmlFor={titleFieldId}>
                <span>Tiêu đề sự cố (*)</span>
                <span className="char-counter">{title.length}/120 ký tự (tối thiểu 5)</span>
              </label>
              <input
                id={titleFieldId}
                type="text"
                placeholder="VD: Rò rỉ nước ở trần hành lang tầng 2 gần phòng 205"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                required
              />
              {fieldErrors.title && <span className="field-error-msg">{fieldErrors.title}</span>}
            </div>

            <div className="form-field">
              <label htmlFor={buildingFieldId}>Tòa nhà / Khu vực (*)</label>
              <select id={buildingFieldId} value={building} onChange={(e) => setBuilding(e.target.value)} required>
                <option value="Tòa A">Tòa A</option>
                <option value="Tòa B">Tòa B</option>
                <option value="Tòa C">Tòa C</option>
                <option value="Thư viện">Thư viện</option>
                <option value="Ký túc xá">Ký túc xá</option>
                <option value="Khu liên hợp thể thao">Khu liên hợp thể thao</option>
                <option value="Khu vực ngoài trời">Khu vực ngoài trời</option>
              </select>
              {fieldErrors.building && <span className="field-error-msg">{fieldErrors.building}</span>}
            </div>

            <div className="form-field">
              <label htmlFor={locationFieldId}>
                <span>Vị trí chi tiết</span>
                <span className="char-counter">{locationDetail.length}/200</span>
              </label>
              <input
                id={locationFieldId}
                type="text"
                placeholder="VD: Tầng 3, trước cửa phòng Lab 302"
                value={locationDetail}
                onChange={(e) => setLocationDetail(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="form-field form-field-full">
              <label htmlFor={observedFieldId}>Thời điểm quan sát (Không được ở tương lai)</label>
              <input
                id={observedFieldId}
                type="datetime-local"
                value={observedAt}
                onChange={(e) => setObservedAt(e.target.value)}
              />
              {fieldErrors.observedAt && <span className="field-error-msg">{fieldErrors.observedAt}</span>}
            </div>

            <div className="form-field form-field-full">
              <label htmlFor={descriptionFieldId}>
                <span>Mô tả chi tiết sự cố (*)</span>
                <span className="char-counter">{description.length}/2000 ký tự (tối thiểu 20)</span>
              </label>
              <textarea
                id={descriptionFieldId}
                placeholder="Mô tả cụ thể hiện trạng, mức độ nghiêm trọng, những ai bị ảnh hưởng..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                required
              />
              {fieldErrors.description && <span className="field-error-msg">{fieldErrors.description}</span>}
            </div>
          </div>
        </div>

        {/* 3. Câu hỏi đặc thù theo loại sự cố (FormAnswers) */}
        <div className="form-section-card">
          <div className="section-legend">
            <span>2. Câu hỏi đặc thù theo danh mục</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--primary)' }}>
              {category === 'water_leak' ? '💧 Rò nước' : category === 'electrical_hazard' ? '⚡ Nguy hiểm điện' : '🎣 Phishing'}
            </span>
          </div>

          {/* Water Leak Fields */}
          {category === 'water_leak' && (
            <div className="form-grid-2">
              <div className="form-field">
                <label htmlFor={waterLeakAmountId}>Mức độ rò rỉ (*)</label>
                <select id={waterLeakAmountId} value={waterLeakAmount} onChange={(e) => setWaterLeakAmount(e.target.value as 'small' | 'large' | 'unknown')}>
                  <option value="small">Ít (Nhỏ giọt)</option>
                  <option value="large">Nhiều (Thành dòng chảy mạnh)</option>
                  <option value="unknown">Không rõ mức độ</option>
                </select>
              </div>

              <div className="form-field">
                <label htmlFor={waterNearElecId}>Có gần thiết bị điện / ổ cắm không? (*)</label>
                <select id={waterNearElecId} value={waterNearElec} onChange={(e) => setWaterNearElec(e.target.value as 'yes' | 'no' | 'unknown')}>
                  <option value="no">Không gần nguồn điện</option>
                  <option value="yes">Có gần nguồn điện (Ưu tiên khẩn cấp P1)</option>
                  <option value="unknown">Không rõ</option>
                </select>
              </div>

              <div className="form-field form-field-full">
                <label htmlFor={waterSlipRiskId} className="form-checkbox-label">
                  <input
                    id={waterSlipRiskId}
                    type="checkbox"
                    checked={waterSlipRisk}
                    onChange={(e) => setWaterSlipRisk(e.target.checked)}
                  />
                  <span>Có nguy cơ gây trơn trượt ngã cho người qua lại (<code>slip_risk</code>)</span>
                </label>
              </div>
            </div>
          )}

          {/* Electrical Hazard Fields */}
          {category === 'electrical_hazard' && (
            <div className="form-grid-2">
              <div className="form-field">
                <label htmlFor={elecExposedWireId}>Có dây điện hở / lộ lõi đồng? (*)</label>
                <select id={elecExposedWireId} value={elecExposedWire} onChange={(e) => setElecExposedWire(e.target.value as 'yes' | 'no' | 'unknown')}>
                  <option value="no">Không có dây hở</option>
                  <option value="yes">Có dây hở lộ ra ngoài (Ưu tiên P1)</option>
                  <option value="unknown">Không rõ</option>
                </select>
              </div>

              <div className="form-field">
                <label htmlFor={elecSmokeSparksId}>Có khói, mùi khét hoặc tia lửa? (*)</label>
                <select id={elecSmokeSparksId} value={elecSmokeSparks} onChange={(e) => setElecSmokeSparks(e.target.value as 'yes' | 'no' | 'unknown')}>
                  <option value="no">Không có khói/tia lửa</option>
                  <option value="yes">Có khói hoặc tia lửa (Khẩn cấp Critical P1)</option>
                  <option value="unknown">Không rõ</option>
                </select>
              </div>

              <div className="form-field form-field-full">
                <label htmlFor={elecEquipmentId}>Thiết bị liên quan (Tùy chọn, tối đa 200 ký tự)</label>
                <input
                  id={elecEquipmentId}
                  type="text"
                  placeholder="VD: Ổ cắm âm sàn, máy lạnh, máy chiếu hội trường..."
                  value={elecEquipment}
                  onChange={(e) => setElecEquipment(e.target.value)}
                  maxLength={200}
                />
              </div>
            </div>
          )}

          {/* Phishing Fields */}
          {category === 'phishing' && (
            <div className="form-grid-2">
              <div className="form-field">
                <label htmlFor={phishInteractionId}>Mức độ tương tác (*)</label>
                <select id={phishInteractionId} value={phishInteraction} onChange={(e) => setPhishInteraction(e.target.value as 'none' | 'clicked_link' | 'entered_information' | 'unknown')}>
                  <option value="none">Chưa tương tác gì</option>
                  <option value="clicked_link">Đã bấm vào liên kết</option>
                  <option value="entered_information">ĐÃ NHẬP THÔNG TIN / MẬT KHẨU (Khẩn cấp P1)</option>
                  <option value="unknown">Không rõ</option>
                </select>
              </div>

              <div className="form-field">
                <label htmlFor={phishChannelId}>Kênh nhận thông tin (*)</label>
                <select id={phishChannelId} value={phishChannel} onChange={(e) => setPhishChannel(e.target.value as 'email' | 'message' | 'other')}>
                  <option value="email">Email trường (@usth.edu.vn)</option>
                  <option value="message">Tin nhắn SMS / Zalo</option>
                  <option value="other">Kênh mạng xã hội khác</option>
                </select>
              </div>

              <div className="form-field form-field-full">
                <label htmlFor={phishSenderTextId}>Địa chỉ người gửi / Tên miền khả nghi (Văn bản thuần, max 254 ký tự)</label>
                <input
                  id={phishSenderTextId}
                  type="text"
                  placeholder="VD: daotao-usth-online.com hoặc noreply@support-usth.net"
                  value={phishSenderText}
                  onChange={(e) => setPhishSenderText(e.target.value)}
                  maxLength={254}
                />
              </div>
            </div>
          )}
        </div>

        {/* 4. Tệp bằng chứng đính kèm (POST /attachments) */}
        <div className="form-section-card">
          <div className="section-legend">
            <span>3. Tệp bằng chứng đính kèm (Tối đa 5 tệp, $\le$ 10 MiB/tệp)</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Đã chọn: {selectedFiles.length}/5 tệp
            </span>
          </div>

          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: 0 }}>
            Hệ thống sẽ <strong>tạo báo cáo sự cố trước</strong>, sau đó <strong>tải lên từng tệp độc lập</strong> kèm theo{' '}
            <code>expected_version</code>. Nếu có tệp lỗi (quá dung lượng hoặc sai định dạng), sự cố vẫn được bảo toàn và tệp lỗi sẽ hiển thị lý do riêng.
          </p>

          {/* Upload Dropzone */}
          <div
            className="upload-dropzone"
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <span className="upload-icon">📎</span>
            <div className="upload-prompt">+ Chọn tệp từ máy tính (PDF, PNG, JPG)</div>
            <div className="upload-hint">Hỗ trợ tối đa 5 tệp, dung lượng mỗi tệp không quá 10 MB</div>
            <label htmlFor={filePickerInputId} style={{ display: 'none' }}>Chọn tệp từ máy tính</label>
            <input
              id={filePickerInputId}
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              disabled={selectedFiles.length >= 5}
            />
          </div>

          {/* Testing helper buttons for graders/demonstration */}
          <div className="simulation-panel">
            <div className="sim-title">
              <span>🧪 Bộ nút thử nghiệm tiêu chí chấm điểm nhanh:</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                onClick={() => handleAddDemoFile('valid_pdf')}
              >
                + Thêm tệp hợp lệ (1.2MB PDF)
              </button>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem', borderColor: 'var(--danger)', color: 'var(--danger)' }}
                onClick={() => handleAddDemoFile('oversized_11mb')}
              >
                + Thêm tệp lỗi quá 10MB (11.5MB PDF)
              </button>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem', borderColor: 'var(--warning)', color: 'var(--warning)' }}
                onClick={() => handleAddDemoFile('invalid_exe')}
              >
                + Thêm tệp lỗi sai MIME (.exe)
              </button>
            </div>
            <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '0.35rem' }}>
              Dùng để kiểm thử tiêu chí: <em>"Incident thành công nhưng file lỗi được báo đúng, không nói thành công toàn bộ."</em>
            </small>
          </div>

          {/* Selected File List */}
          {selectedFiles.length > 0 && (
            <div className="attachment-file-list">
              {selectedFiles.map((f, idx) => (
                <div key={f.id} className="file-item-card">
                  <div className="file-info-group">
                    <span className="file-ext-icon">
                      {f.mimeType === 'application/pdf' ? '📄' : f.mimeType.startsWith('image/') ? '🖼️' : '⚠️'}
                    </span>
                    <div className="file-name-size">
                      <span className="file-name">#{idx + 1}. {f.name}</span>
                      <span className="file-size-type">{formatSize(f.sizeBytes)} · {f.mimeType}</span>
                    </div>
                  </div>
                  <div className="file-actions">
                    {f.sizeBytes > 10 * 1024 * 1024 && (
                      <span className="file-sim-tag large">⚠️ &gt; 10 MB (Sẽ bị từ chối)</span>
                    )}
                    {!['image/png', 'image/jpeg', 'application/pdf'].includes(f.mimeType) && (
                      <span className="file-sim-tag mime">⚠️ Sai MIME (Sẽ bị từ chối)</span>
                    )}
                    <button
                      type="button"
                      className="btn-remove-file"
                      onClick={() => handleRemoveFile(f.id)}
                    >
                      ✕ Bỏ tệp
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 5. Submit Action Bar with Anti-Duplicate Protection */}
        <div className="submit-action-bar">
          <div>
            <label className="form-checkbox-label" style={{ fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={allowReuseKey}
                onChange={(e) => setAllowReuseKey(e.target.checked)}
              />
              <span>Giữ nguyên Idempotency-Key (Kiểm tra trả 200 bản ghi cũ khi bấm lại)</span>
            </label>
          </div>

          <div className="submit-btn-group">
            {onCancel && (
              <button
                type="button"
                className="btn btn-outline"
                disabled={isSubmitting}
                onClick={onCancel}
              >
                Hủy bỏ
              </button>
            )}
            <button
              type="submit"
              className="btn-submit-incident"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner" style={{ width: '1rem', height: '1rem', borderWidth: '2px' }}></span>
                  <span>Đang gửi báo cáo (Chống gửi lặp kích hoạt)...</span>
                </>
              ) : (
                <span>🚀 Gửi Báo Cáo Sự Cố ({selectedFiles.length} tệp kèm)</span>
              )}
            </button>
          </div>
        </div>
      </form>
    </section>
  )
}
