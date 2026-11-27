import { useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, Clock3, Droplets, FileText, Inbox, MapPin, Plus, RefreshCw, Search, ShieldCheck, UploadCloud, X, Zap } from 'lucide-react'
import { demoClient } from '../api/demo-client.ts'
import type { Category, FormAnswers, IncidentResponse, IncidentSummary, Status, HistoryItem, AttachmentSummary } from '../types/incident.ts'
import { errorText } from '../App.tsx'

export const categoryInfo: Record<Category, { label: string; icon: typeof Droplets; description: string }> = {
  water_leak: { label: 'Rò rỉ nước', icon: Droplets, description: 'Đường ống, ngập nước, khu vực trơn trượt' },
  electrical_hazard: { label: 'Nguy hiểm điện', icon: Zap, description: 'Dây điện, ổ cắm, khói hoặc tia lửa' },
  phishing: { label: 'Lừa đảo trực tuyến', icon: ShieldCheck, description: 'Email, tin nhắn hoặc đường dẫn giả mạo' },
}
export const statusInfo: Record<Status, string> = { reported: 'Mới tiếp nhận', assigned: 'Đã phân công', in_progress: 'Đang xử lý', resolved: 'Đã giải quyết', closed: 'Đã đóng' }
export const formatDate = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'
export function CategoryIcon({ category }: { category: Category }) { const Icon = categoryInfo[category].icon; return <span className={`m-category-icon ${category}`}><Icon size={21} strokeWidth={1.8} /></span> }
export function StatusPill({ status }: { status: Status }) { return <span className={`m-status ${status}`}><i />{statusInfo[status]}</span> }
export const priorityLabels: Record<'p1' | 'p2' | 'p3', { text: string; sla: string }> = {
  p1: { text: 'P1 - Khẩn cấp', sla: '15 phút' },
  p2: { text: 'P2 - Cao', sla: '2 giờ' },
  p3: { text: 'P3 - Tiêu chuẩn', sla: '8 giờ' },
}
export function PriorityPill({ priority, triage, showSla = true }: { priority: IncidentSummary['priority']; triage: boolean; showSla?: boolean }) {
  if (triage) {
    return <span className="m-priority triage" aria-label="Cần phân loại thủ công (SLA 30 phút)">Cần phân loại{showSla && <small> · SLA 30p</small>}</span>
  }
  if (!priority) {
    return <span className="m-priority none">Chưa xác định</span>
  }
  const meta = priorityLabels[priority] || { text: priority.toUpperCase(), sla: '' }
  return (
    <span
      className={`m-priority ${priority}`}
      aria-label={`${meta.text} (SLA tiếp nhận: ${meta.sla})`}
    >
      {meta.text}
      {showSla && meta.sla && <small> · {meta.sla}</small>}
    </span>
  )
}
export function IncidentRow({ item, onClick }: { item: IncidentSummary | IncidentResponse; onClick: () => void }) {
  return (
    <button
      className="m-incident-row"
      onClick={onClick}
      tabIndex={0}
      role="row"
      aria-label={`Sự cố ${item.title}, mã ${item.id.slice(0, 8)}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <CategoryIcon category={item.category} />
      <span className="m-incident-body">
        <strong>{item.title}</strong>
        <small>#{item.id.slice(0, 8)} <span>·</span> {formatDate(item.reported_at)}</small>
      </span>
      <span className="m-incident-tags">
        <PriorityPill priority={item.priority} triage={item.triage_required} />
        <StatusPill status={item.status} />
      </span>
      <ChevronRight className="m-row-chevron" size={19} />
    </button>
  )
}
export function Metric({ label, value, note, icon: Icon }: { label: string; value: number; note: string; icon: typeof FileText }) { return <div className="m-metric"><span className="m-metric-icon"><Icon size={20} /></span><b>{value}</b><strong>{label}</strong><small>{note}</small></div> }
export function Loading() { return <div className="m-loading" role="status"><span /><span /><span />Đang tải dữ liệu…</div> }
export function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="m-empty"><AlertCircle size={31} /><h3>Chưa tải được dữ liệu</h3><p>{message}</p><button className="m-button secondary" onClick={retry}><RefreshCw size={17} /> Thử lại</button></div> }

export function ReporterWorkspace({ page, onCreate, onBack }: { page: 'reports' | 'create'; onCreate: () => void; onBack: () => void }) {
  const [selected, setSelected] = useState<IncidentSummary | null>(null)
  const [revision, setRevision] = useState(0)
  return page === 'create' ? <CreateReport onCancel={onBack} onDone={() => { setRevision(value => value + 1); onBack() }} /> : <><ReporterHome revision={revision} onRefresh={() => setRevision(value => value + 1)} onCreate={onCreate} onSelect={setSelected} />{selected && <ReporterDetail item={selected} onClose={() => setSelected(null)} onUpdated={() => setRevision(value => value + 1)} />}</>
}

function ReporterHome({ revision, onRefresh, onCreate, onSelect }: { revision: number; onRefresh: () => void; onCreate: () => void; onSelect: (item: IncidentSummary) => void }) {
  const [items, setItems] = useState<IncidentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Status | 'all'>('all')
  useEffect(() => { let active = true; setLoading(true); demoClient.getMyIncidents({ limit: 100 }).then(result => { if (active) { setItems(result.items); setError('') } }).catch(err => { if (active) setError(errorText(err)) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [revision])
  const visible = items.filter(item => (status === 'all' || status === item.status) && `${item.title} ${item.id}`.toLowerCase().includes(search.toLowerCase()))
  const active = items.filter(item => !['resolved', 'closed'].includes(item.status)).length
  return <><section className="m-page-heading"><div><span className="m-eyebrow">DÀNH CHO NGƯỜI BÁO CÁO</span><h1>Theo dõi sự cố của bạn</h1><p>Mọi báo cáo và cập nhật được tập trung tại đây.</p></div><button className="m-button primary" onClick={onCreate}><Plus size={18} /> Báo cáo sự cố</button></section><section className="m-hero"><div><span>GIỮ KHUÔN VIÊN AN TOÀN</span><h2>Nhìn thấy sự cố?<br />Hãy cho chúng tôi biết.</h2><p>Mô tả vị trí và tình huống. Bộ phận phụ trách sẽ theo dõi báo cáo của bạn.</p><button className="m-button light" onClick={onCreate}>Tạo báo cáo mới <ArrowRight size={18} /></button></div><div className="m-hero-art" aria-hidden="true"><span /><span /><span /></div></section><section className="m-metrics three"><Metric label="Tổng báo cáo" value={items.length} icon={FileText} note="Đã ghi nhận" /><Metric label="Đang theo dõi" value={active} icon={Clock3} note="Chưa hoàn tất" /><Metric label="Đã hoàn tất" value={items.length - active} icon={CheckCircle2} note="Đã giải quyết hoặc đóng" /></section><section className="m-section"><div className="m-section-heading"><div><h2>Danh sách báo cáo</h2><p>Chọn một báo cáo để xem tiến độ và cập nhật.</p></div><button className="m-icon-button" aria-label="Làm mới danh sách" onClick={onRefresh}><RefreshCw size={18} /></button></div><div className="m-toolbar"><label className="m-search"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm theo tên hoặc mã báo cáo" /></label><select aria-label="Lọc trạng thái" value={status} onChange={event => setStatus(event.target.value as Status | 'all')}><option value="all">Tất cả trạng thái</option>{Object.entries(statusInfo).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div>{loading ? <Loading /> : error ? <ErrorState message={error} retry={onRefresh} /> : visible.length ? <div className="m-incident-list">{visible.map(item => <IncidentRow item={item} key={item.id} onClick={() => onSelect(item)} />)}</div> : <div className="m-empty"><Inbox size={31} /><h3>{items.length ? 'Không tìm thấy báo cáo phù hợp' : 'Bạn chưa có báo cáo nào'}</h3><p>{items.length ? 'Thử đổi từ khóa hoặc bộ lọc.' : 'Gửi báo cáo đầu tiên khi bạn phát hiện sự cố.'}</p>{!items.length && <button className="m-button primary" onClick={onCreate}>Tạo báo cáo</button>}</div>}</section></>
}

function CreateReport({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [step, setStep] = useState(1)
  const [category, setCategory] = useState<Category>('water_leak')
  const [title, setTitle] = useState('')
  const [building, setBuilding] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [observed, setObserved] = useState('')
  const [leakAmount, setLeakAmount] = useState<'small' | 'large' | 'unknown'>('unknown')
  const [nearElectricity, setNearElectricity] = useState<'yes' | 'no' | 'unknown'>('unknown')
  const [slipRisk, setSlipRisk] = useState(false)
  const [wire, setWire] = useState<'yes' | 'no' | 'unknown'>('unknown')
  const [smoke, setSmoke] = useState<'yes' | 'no' | 'unknown'>('unknown')
  const [equipment, setEquipment] = useState('')
  const [interaction, setInteraction] = useState<'none' | 'clicked_link' | 'entered_information' | 'unknown'>('unknown')
  const [channel, setChannel] = useState<'email' | 'message' | 'other'>('email')
  const [sender, setSender] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState(false)
  const [error, setError] = useState('')
  const valid = title.trim().length >= 5 && building.trim().length > 0 && description.trim().length >= 20
  const answers: FormAnswers = category === 'water_leak' ? { leak_amount: leakAmount, near_electricity: nearElectricity, slip_risk: slipRisk } : category === 'electrical_hazard' ? { exposed_wire: wire, smoke_or_sparks: smoke, equipment: equipment.trim() } : { interaction, channel, sender_text: sender.trim() }
  const submit = async () => { if (!valid || saving || created) return; setSaving(true); setError(''); try { const result = await demoClient.createIncident({ category, title: title.trim(), building: building.trim(), location_detail: location.trim() || null, description: description.trim(), observed_at: observed ? new Date(observed).toISOString() : null, answers }, crypto.randomUUID()); let version = result.data.version; const failed: string[] = []; for (const file of files) { try { const signature = Array.from(new Uint8Array(await file.slice(0, 8).arrayBuffer())); await demoClient.uploadAttachment(result.data.id, { filename: file.name, sizeBytes: file.size, mimeType: file.type, signature }, version); version++ } catch { failed.push(file.name) } } if (failed.length) { setError(`Báo cáo đã được tạo, nhưng chưa tải được: ${failed.join(', ')}. Hãy mở báo cáo để bổ sung tệp.`); setCreated(true) } else onDone() } catch (err) { setError(errorText(err)) } finally { setSaving(false) } }
  return <><div className="m-create-top"><button className="m-text-button" onClick={onCancel}><ArrowLeft size={17} /> Quay lại báo cáo</button><span>BÁO CÁO SỰ CỐ</span></div><div className="m-create-heading"><h1>Gửi báo cáo mới</h1><p>Thông tin rõ ràng giúp bộ phận phụ trách xác định vị trí và xử lý nhanh hơn.</p></div><div className="m-stepper"><div className={step >= 1 ? 'active' : ''}><span>1</span> Chọn loại sự cố</div><div className={step >= 2 ? 'active' : ''}><span>2</span> Mô tả tình huống</div><div className={step >= 3 ? 'active' : ''}><span>3</span> Kiểm tra & gửi</div></div><div className="m-create-layout"><div className="m-create-card">{step === 1 ? <><span className="m-eyebrow">BƯỚC 01 / 03</span><h2>Bạn muốn báo cáo điều gì?</h2><p className="m-card-intro">Chọn loại gần nhất với tình huống bạn gặp.</p><div className="m-category-grid">{(Object.keys(categoryInfo) as Category[]).map(key => <button key={key} className={`m-category-choice ${category === key ? 'selected' : ''}`} onClick={() => setCategory(key)}><CategoryIcon category={key} /><strong>{categoryInfo[key].label}</strong><small>{categoryInfo[key].description}</small><span className="m-choice-check">{category === key && <Check size={14} />}</span></button>)}</div><div className="m-form-actions"><button className="m-button primary" onClick={() => setStep(2)}>Tiếp tục <ArrowRight size={18} /></button></div></> : step === 2 ? <><span className="m-eyebrow">BƯỚC 02 / 03</span><h2>Mô tả sự cố</h2><p className="m-card-intro">Cho biết chuyện gì đã xảy ra và vị trí cụ thể.</p><div className="m-form-grid"><label className="m-field full">Tiêu đề sự cố <b>*</b><input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} placeholder="Ví dụ: Nước rò tại hành lang tầng 2" /><small>Ít nhất 5 ký tự</small></label><label className="m-field">Tòa nhà / khu vực <b>*</b><input value={building} onChange={event => setBuilding(event.target.value)} maxLength={120} placeholder="Ví dụ: Tòa A" /></label><label className="m-field">Vị trí cụ thể<input value={location} onChange={event => setLocation(event.target.value)} maxLength={200} placeholder="Tầng, phòng, khu vực…" /></label><label className="m-field full">Mô tả chi tiết <b>*</b><textarea value={description} onChange={event => setDescription(event.target.value)} rows={5} maxLength={2000} placeholder="Mô tả dấu hiệu, mức độ ảnh hưởng và điều bạn đã quan sát được…" /><small>Ít nhất 20 ký tự</small></label><label className="m-field full">Thời điểm quan sát<input type="datetime-local" value={observed} max={new Date().toISOString().slice(0, 16)} onChange={event => setObserved(event.target.value)} /></label></div><div className="m-subform"><h3>Thông tin bổ sung · {categoryInfo[category].label}</h3>{category === 'water_leak' ? <div className="m-form-grid"><label className="m-field">Mức độ rò rỉ<select value={leakAmount} onChange={event => setLeakAmount(event.target.value as typeof leakAmount)}><option value="unknown">Chưa rõ</option><option value="small">Ít / nhỏ giọt</option><option value="large">Nhiều / chảy mạnh</option></select></label><label className="m-field">Có gần nguồn điện?<select value={nearElectricity} onChange={event => setNearElectricity(event.target.value as typeof nearElectricity)}><option value="unknown">Chưa rõ</option><option value="yes">Có</option><option value="no">Không</option></select></label><label className="m-check"><input type="checkbox" checked={slipRisk} onChange={event => setSlipRisk(event.target.checked)} /> Khu vực có nguy cơ trơn trượt</label></div> : category === 'electrical_hazard' ? <div className="m-form-grid"><label className="m-field">Có dây điện hở?<select value={wire} onChange={event => setWire(event.target.value as typeof wire)}><option value="unknown">Chưa rõ</option><option value="yes">Có</option><option value="no">Không</option></select></label><label className="m-field">Có khói hoặc tia lửa?<select value={smoke} onChange={event => setSmoke(event.target.value as typeof smoke)}><option value="unknown">Chưa rõ</option><option value="yes">Có</option><option value="no">Không</option></select></label><label className="m-field full">Thiết bị liên quan<input value={equipment} onChange={event => setEquipment(event.target.value)} maxLength={200} placeholder="Nếu bạn biết tên thiết bị" /></label></div> : <div className="m-form-grid"><label className="m-field">Bạn đã tương tác thế nào?<select value={interaction} onChange={event => setInteraction(event.target.value as typeof interaction)}><option value="unknown">Chưa rõ</option><option value="none">Chưa tương tác</option><option value="clicked_link">Đã bấm liên kết</option><option value="entered_information">Đã nhập thông tin</option></select></label><label className="m-field">Kênh nhận<select value={channel} onChange={event => setChannel(event.target.value as typeof channel)}><option value="email">Email</option><option value="message">Tin nhắn</option><option value="other">Khác</option></select></label><label className="m-field full">Tên người gửi hiển thị<input value={sender} onChange={event => setSender(event.target.value)} maxLength={254} placeholder="Chỉ nhập tên hoặc địa chỉ hiển thị" /></label></div>}</div><div className="m-safety"><AlertCircle size={19} /><span>{category === 'phishing' ? 'Không nhập mật khẩu, mã OTP hoặc thông tin bí mật. Nếu đã nhập trên trang nghi giả mạo, hãy liên hệ IT/Security qua kênh chính thức.' : 'Nếu có nguy hiểm tức thời, hãy rời khỏi khu vực và liên hệ đầu mối khẩn cấp của trường theo hướng dẫn chính thức. Báo cáo này không thay thế cuộc gọi ứng cứu.'}</span></div><div className="m-form-actions between"><button className="m-button secondary" onClick={() => setStep(1)}><ArrowLeft size={17} /> Quay lại</button><button className="m-button primary" disabled={!valid} onClick={() => setStep(3)}>Tiếp tục <ArrowRight size={18} /></button></div></> : <><span className="m-eyebrow">BƯỚC 03 / 03</span><h2>Kiểm tra trước khi gửi</h2><p className="m-card-intro">Bạn có thể đính kèm tối đa 5 ảnh hoặc tệp PDF.</p><div className="m-review"><div><span>Loại sự cố</span><strong>{categoryInfo[category].label}</strong></div><div><span>Tiêu đề</span><strong>{title}</strong></div><div><span>Vị trí</span><strong>{building}{location && ` · ${location}`}</strong></div><div><span>Mô tả</span><strong>{description}</strong></div></div><label className="m-upload"><UploadCloud size={26} /><strong>Chọn ảnh hoặc tài liệu</strong><span>PNG, JPG, PDF · tối đa 10 MB mỗi tệp</span><input type="file" accept=".png,.jpg,.jpeg,.pdf" multiple onChange={event => { const incoming = Array.from(event.target.files || []).filter(file => file.size <= 10 * 1024 * 1024); setFiles(previous => [...previous, ...incoming].slice(0, 5)); event.target.value = '' }} /></label>{files.length > 0 && <div className="m-files">{files.map((file, index) => <div key={`${file.name}-${index}`}><FileText size={17} /><span>{file.name}</span><button aria-label={`Bỏ ${file.name}`} onClick={() => setFiles(files.filter((_, i) => i !== index))}><X size={16} /></button></div>)}</div>}{error && <p className="m-error" role="alert">{error}</p>}<div className="m-form-actions between"><button className="m-button secondary" onClick={() => setStep(2)}><ArrowLeft size={17} /> Chỉnh sửa</button><button className="m-button primary" disabled={saving} onClick={created ? onDone : submit}>{created ? 'Xem báo cáo' : saving ? 'Đang gửi…' : 'Gửi báo cáo'} <ArrowRight size={18} /></button></div></>}</div><aside className="m-create-aside"><span className="m-aside-icon"><ShieldCheck size={23} /></span><h3>Điều gì xảy ra tiếp theo?</h3><ol><li>Báo cáo được ghi nhận</li><li>Bộ phận phù hợp xem và phân công</li><li>Bạn theo dõi cập nhật tại trang báo cáo</li></ol><p>Thông tin trong bản demo dùng dữ liệu mẫu của dự án.</p></aside></div></>
}

function ReporterDetail({ item, onClose, onUpdated }: { item: IncidentSummary; onClose: () => void; onUpdated: () => void }) {
  const [detail, setDetail] = useState<IncidentResponse | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [files, setFiles] = useState<AttachmentSummary[]>([])
  const [newFile, setNewFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'info' | 'updates'>('info')
  const [revision, setRevision] = useState(0)
  useEffect(() => { let active = true; Promise.all([demoClient.getReporterIncidentDetail(item.id), demoClient.getPublicHistory(item.id), demoClient.getReporterAttachments(item.id)]).then(([d, h, f]) => { if (active) { setDetail(d); setHistory(h); setFiles(f) } }).catch(err => { if (active) setError(errorText(err)) }); return () => { active = false } }, [item.id, revision])
  const supplement = async () => { if (!detail || !text.trim()) return; setBusy(true); setError(''); try { await demoClient.supplementIncident(detail.id, { expected_version: detail.version, text: text.trim() }); setText(''); setRevision(value => value + 1); onUpdated() } catch (err) { setError(errorText(err)) } finally { setBusy(false) } }
  const upload = async () => { if (!detail || !newFile) return; setBusy(true); setError(''); try { const signature = Array.from(new Uint8Array(await newFile.slice(0, 8).arrayBuffer())); await demoClient.uploadAttachment(detail.id, { filename: newFile.name, sizeBytes: newFile.size, mimeType: newFile.type, signature }, detail.version); setNewFile(null); setRevision(value => value + 1); onUpdated() } catch (err) { setError(errorText(err)) } finally { setBusy(false) } }
  return <div className="m-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><aside className="m-detail-panel" role="dialog" aria-modal="true" aria-label="Chi tiết báo cáo"><div className="m-panel-top"><span>CHI TIẾT BÁO CÁO · #{item.id.slice(0, 8)}</span><button onClick={onClose} aria-label="Đóng"><X size={21} /></button></div><div className="m-panel-heading"><CategoryIcon category={item.category} /><h2>{item.title}</h2><div><StatusPill status={item.status} /><PriorityPill priority={item.priority} triage={item.triage_required} /></div></div><div className="m-panel-tabs"><button className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>Thông tin</button><button className={tab === 'updates' ? 'active' : ''} onClick={() => setTab('updates')}>Cập nhật</button></div><div className="m-panel-scroll">{error && <p className="m-error" role="alert">{error}</p>}{!detail ? <Loading /> : tab === 'info' ? <><div className="m-detail-grid"><div><span>Vị trí</span><strong><MapPin size={16} /> {detail.building}{detail.location_detail && ` · ${detail.location_detail}`}</strong></div><div><span>Ngày báo cáo</span><strong>{formatDate(detail.reported_at)}</strong></div></div><h3>Mô tả</h3><p className="m-detail-text">{detail.description}</p><h3>Tệp đính kèm</h3>{files.length ? <div className="m-files">{files.map(file => <div key={file.id}><FileText size={17} />{file.original_name}</div>)}</div> : <p className="m-muted">Chưa có tệp đính kèm.</p>}{!['resolved', 'closed'].includes(detail.status) && files.length < 5 && <div className="m-add-file"><label className="m-button secondary"><UploadCloud size={16} /> {newFile ? newFile.name : 'Chọn tệp'}<input type="file" accept=".png,.jpg,.jpeg,.pdf" onChange={event => setNewFile(event.target.files?.[0] || null)} /></label>{newFile && <button className="m-button primary" disabled={busy} onClick={upload}>Tải lên</button>}</div>}</> : <><h3>Lịch sử cập nhật</h3>{history.length ? <div className="m-timeline">{history.map(entry => <div key={entry.id}><i /><strong>{entry.action.replace(/_/g, ' ')}</strong><small>{entry.actor_display_name} · {formatDate(entry.created_at)}</small></div>)}</div> : <p className="m-muted">Chưa có cập nhật.</p>}{!['resolved', 'closed'].includes(detail.status) && <div className="m-comment"><label className="m-field">Bổ sung thông tin<textarea rows={3} value={text} onChange={event => setText(event.target.value)} placeholder="Nhập thông tin bổ sung…" /></label><button className="m-button primary" disabled={busy || !text.trim()} onClick={supplement}>Gửi cập nhật</button></div>}</>}</div></aside></div>
}

