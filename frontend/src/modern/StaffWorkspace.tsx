import { useEffect, useState, type KeyboardEvent } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  FileText,
  Inbox,
  MapPin,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react'
import type { UserSummary } from '../types/auth.ts'
import type {
  IncidentResponse,
  HistoryItem,
  Comment,
  AttachmentSummary,
  Status,
} from '../types/incident.ts'
import { demoClient } from '../api/demo-client.ts'
import { staffApiAdapter, type AdapterMode } from '../api/staff-api-adapter.ts'
import { DEPARTMENTS, MOCK_USERS } from '../mocks/mock-users.ts'
import { mockN7StaffRoleApi } from '../mocks/n7-role-mock-api.ts'
import { errorText } from '../App.tsx'
import {
  CategoryIcon,
  ErrorState,
  formatDate,
  IncidentRow,
  Loading,
  Metric,
  PriorityPill,
  StatusPill,
  statusInfo,
} from './ReporterWorkspace.tsx'

export function StaffWorkspace({
  page,
  user,
  onQueue,
}: {
  page: 'overview' | 'queue'
  user: UserSummary
  onQueue: () => void
}) {
  const [items, setItems] = useState<IncidentResponse[]>([])
  const [selected, setSelected] = useState<IncidentResponse | null>(null)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Status | 'all'>('all')
  const [adapterMode, setAdapterMode] = useState<AdapterMode>(() => staffApiAdapter.getMode())

  const refresh = () => setRevision((value) => value + 1)

  const toggleAdapterMode = () => {
    const nextMode: AdapterMode = adapterMode === 'real' ? 'mock' : 'real'
    staffApiAdapter.setMode(nextMode)
    setAdapterMode(nextMode)
    refresh()
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    demoClient
      .staffIncidents()
      .then((data) => {
        if (active) {
          setItems(data)
          setError('')
        }
      })
      .catch((err) => {
        if (active) setError(errorText(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [revision, user.id, adapterMode])

  const active = items.filter((item) => !['resolved', 'closed'].includes(item.status))
  const urgent = active.filter(
    (item) =>
      item.priority === 'p1' ||
      item.triage_required ||
      mockN7StaffRoleApi.getSlaStatus(item).state === 'overdue'
  )
  const working = items.filter((item) => item.status === 'in_progress')
  const visible = items.filter(
    (item) =>
      (status === 'all' || item.status === status) &&
      `${item.title} ${item.id} ${item.building}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <>
      <section className="m-page-heading">
        <div>
          <span className="m-eyebrow">KHÔNG GIAN ĐIỀU PHỐI · {user.display_name}</span>
          <h1>{page === 'overview' ? 'Tổng quan vận hành' : 'Hàng đợi sự cố'}</h1>
          <p>
            {page === 'overview'
              ? 'Nắm tình hình, giám sát hạn SLA và ưu tiên những việc khẩn cấp.'
              : 'Tìm, lọc và mở từng sự cố để xử lý theo quy trình nghiệp vụ.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            className={`m-adapter-toggle ${adapterMode === 'real' ? 'real' : 'mock'}`}
            onClick={toggleAdapterMode}
            title="Bấm để chuyển đổi giữa kết nối API Thật và Mock Adapter"
            aria-label={`Chế độ kết nối hiện tại: ${adapterMode === 'real' ? 'API Thật' : 'Mock Adapter'}`}
          >
            <Database size={15} />
            <span>Nguồn: {adapterMode === 'real' ? 'API Thật (DB)' : 'Mock Adapter'}</span>
          </button>
          <button className="m-button secondary" onClick={refresh}>
            <RefreshCw size={17} /> Làm mới
          </button>
        </div>
      </section>

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} retry={refresh} />
      ) : page === 'overview' ? (
        <>
          <section className="m-metrics four">
            <Metric
              label="Tổng sự cố"
              value={items.length}
              note="Trong phạm vi quyền hạn"
              icon={FileText}
            />
            <Metric
              label="Cần chú ý"
              value={urgent.length}
              note="Khẩn cấp, quá hạn hoặc chờ phân loại"
              icon={AlertCircle}
            />
            <Metric
              label="Đang xử lý"
              value={working.length}
              note="Đã tiếp nhận xử lý"
              icon={Clock3}
            />
            <Metric
              label="Hoàn tất"
              value={items.filter((item) => ['resolved', 'closed'].includes(item.status)).length}
              note="Đã giải quyết hoặc đóng"
              icon={CheckCircle2}
            />
          </section>

          <div className="m-overview-grid">
            <section className="m-section">
              <div className="m-section-heading">
                <div>
                  <span className="m-eyebrow">ƯU TIÊN HÔM NAY</span>
                  <h2>Cần chú ý trước</h2>
                </div>
                <button className="m-text-button" onClick={onQueue}>
                  Xem hàng đợi <ArrowRight size={17} />
                </button>
              </div>
              {urgent.length ? (
                <div className="m-incident-list">
                  {urgent.slice(0, 6).map((item) => (
                    <IncidentRow key={item.id} item={item} onClick={() => setSelected(item)} />
                  ))}
                </div>
              ) : (
                <div className="m-empty compact">
                  <CheckCircle2 size={31} />
                  <h3>Chưa có sự cố khẩn</h3>
                  <p>Các báo cáo trong phạm vi của bạn đang được theo dõi và xử lý đúng tiến độ.</p>
                </div>
              )}
            </section>

            <aside className="m-overview-side">
              <div className="m-side-card">
                <span className="m-side-icon">
                  <Activity size={22} />
                </span>
                <h3>Tiến độ xử lý</h3>
                <p>Phân bổ sự cố theo trạng thái hiện tại.</p>
                <div className="m-progress">
                  <span
                    style={{
                      width: `${items.length ? (working.length / items.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="m-progress-caption">
                  <span>Đang xử lý</span>
                  <strong>
                    {working.length} / {items.length}
                  </strong>
                </div>
              </div>

              <div className="m-side-card muted">
                <span className="m-side-icon">
                  <Bell size={22} />
                </span>
                <h3>Ưu tiên phản hồi & SLA</h3>
                <p>
                  Mở một sự cố để xem hạn tiếp nhận (P1: 15p, P2: 2h, P3: 8h), lịch sử và thao tác được
                  phép theo vai trò.
                </p>
              </div>
            </aside>
          </div>
        </>
      ) : (
        <section className="m-section">
          <div className="m-section-heading">
            <div>
              <h2>Danh sách sự cố</h2>
              <p>{visible.length} kết quả trong phạm vi của bạn</p>
            </div>
          </div>
          <div className="m-toolbar">
            <label className="m-search">
              <Search size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm tiêu đề, vị trí hoặc mã sự cố"
              />
            </label>
            <select
              aria-label="Lọc theo trạng thái"
              value={status}
              onChange={(event) => setStatus(event.target.value as Status | 'all')}
            >
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(statusInfo).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {visible.length ? (
            <div className="m-incident-list">
              {visible.map((item) => (
                <IncidentRow key={item.id} item={item} onClick={() => setSelected(item)} />
              ))}
            </div>
          ) : (
            <div className="m-empty">
              <Inbox size={31} />
              <h3>Không tìm thấy sự cố</h3>
              <p>Thử thay đổi từ khóa hoặc trạng thái lọc.</p>
            </div>
          )}
        </section>
      )}

      {selected && (
        <StaffDetail
          item={selected}
          user={user}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null)
            refresh()
          }}
        />
      )}
    </>
  )
}

type Action =
  | 'assign'
  | 'triage'
  | 'priority'
  | 'resolve'
  | 'close'
  | 'reopen'
  | 'disposition'

function ActionChoice({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="m-action-choice" onClick={onClick}>
      <FileText size={19} />
      {label}
      <ChevronRight size={17} />
    </button>
  )
}

function StaffDetail({
  item,
  user,
  onClose,
  onChanged,
}: {
  item: IncidentResponse
  user: UserSummary
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<IncidentResponse | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [attachments, setAttachments] = useState<AttachmentSummary[]>([])
  const [tab, setTab] = useState<'info' | 'updates' | 'actions'>('info')
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [conflictNotice, setConflictNotice] = useState('')
  const [forbiddenNotice, setForbiddenNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState<Action | null>(null)

  // Form states - Bảo lưu 100% dữ liệu người dùng khi gặp lỗi 403 / 409
  const [reason, setReason] = useState('')
  const [resolution, setResolution] = useState('')
  const [department, setDepartment] = useState(
    item.department_id && item.department_id !== 'dept-triage' ? item.department_id : 'dept-csvc'
  )
  const [handler, setHandler] = useState('')
  const [priority, setPriority] = useState<'p1' | 'p2' | 'p3'>(item.priority || 'p2')
  const [disposition, setDisposition] = useState<'invalid' | 'duplicate'>('invalid')
  const [duplicateId, setDuplicateId] = useState('')
  const [comment, setComment] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'internal'>('public')

  // Bàn phím: Hỗ trợ phím Escape để đóng drawer nhanh
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Chuyển Tab qua phím mũi tên trái/phải WAI-ARIA
  const tabs = ['info', 'updates', 'actions'] as const
  const handleTabKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
    currentTab: 'info' | 'updates' | 'actions'
  ) => {
    const idx = tabs.indexOf(currentTab)
    if (e.key === 'ArrowRight') {
      const nextTab = tabs[(idx + 1) % tabs.length]
      setTab(nextTab)
    } else if (e.key === 'ArrowLeft') {
      const prevTab = tabs[(idx - 1 + tabs.length) % tabs.length]
      setTab(prevTab)
    }
  }

  useEffect(() => {
    let active = true
    Promise.all([
      demoClient.getIncidentDetail(item.id),
      demoClient.getIncidentHistory(item.id),
      demoClient.getIncidentComments(item.id),
      demoClient.getIncidentAttachments(item.id),
    ])
      .then(([d, h, c, a]) => {
        if (active) {
          setDetail(d)
          setHistory(h)
          setComments(c)
          setAttachments(a)
          setError('')
        }
      })
      .catch((err) => {
        if (active) setError(errorText(err))
      })
    return () => {
      active = false
    }
  }, [item.id, revision])

  const current = detail || item
  const permissions = detail ? mockN7StaffRoleApi.getPermissionMatrix(detail, user) : null
  const manager = !!permissions && (permissions.isAdmin || permissions.isDepartmentManager)
  const handlers = Object.values(MOCK_USERS).filter(
    (person) => person.role === 'handler' && person.department_id === department
  )

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError('')
    setConflictNotice('')
    setForbiddenNotice('')
    try {
      await work()
      onChanged()
    } catch (err: unknown) {
      const errObj = err as { error?: { code?: string; message?: string }; message?: string }
      const code = errObj.error?.code
      if (code === 'version_conflict') {
        // N7-W09: Bảo lưu dữ liệu nhập và cập nhật version mới nhất
        setConflictNotice(
          'Xung đột phiên bản: Sự cố vừa được người khác cập nhật. Bản mới nhất đã được tải về, nội dung bạn vừa nhập được bảo lưu. Vui lòng bấm xác nhận lại.'
        )
        setRevision((value) => value + 1)
      } else if (code === 'forbidden') {
        // N7-W09: Bắt lỗi 403 Forbidden bảo lưu dữ liệu nhập
        setForbiddenNotice(
          'Quyền truy cập bị từ chối: Tài khoản của bạn không có quyền thực hiện thao tác này đối với sự cố hiện tại.'
        )
      } else {
        setError(errorText(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const perform = () => {
    if (!detail || !action) return
    const version = detail.version
    run(async () => {
      if (action === 'assign') {
        await demoClient.assignIncident(detail.id, {
          expected_version: version,
          department_id: department,
          handler_id: handler || null,
          reason: reason.trim(),
        })
      } else if (action === 'triage') {
        await demoClient.triageIncident(detail.id, {
          expected_version: version,
          department_id: department,
          priority,
          reason: reason.trim(),
        })
      } else if (action === 'priority') {
        await demoClient.adjustPriority(detail.id, {
          expected_version: version,
          priority,
          reason: reason.trim(),
        })
      } else if (action === 'resolve') {
        await demoClient.resolveIncident(detail.id, {
          expected_version: version,
          resolution: resolution.trim(),
        })
      } else if (action === 'close') {
        await demoClient.closeIncident(detail.id, {
          expected_version: version,
          reason: reason.trim(),
        })
      } else if (action === 'reopen') {
        await demoClient.reopenIncident(detail.id, {
          expected_version: version,
          reason: reason.trim(),
        })
      } else {
        await demoClient.dispositionIncident(detail.id, {
          expected_version: version,
          kind: disposition,
          reason: reason.trim(),
          duplicate_of_id: disposition === 'duplicate' ? duplicateId.trim() : null,
        })
      }
    })
  }

  const sendComment = () => {
    if (!detail || !comment.trim()) return
    run(async () => {
      await demoClient.addComment(detail.id, {
        body: comment.trim(),
        visibility,
        expected_version: detail.version,
      })
      setComment('')
    })
  }

  return (
    <div
      className="m-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <aside
        className="m-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Chi tiết sự cố #${item.id.slice(0, 8)}`}
      >
        <div className="m-panel-top">
          <span>
            CHI TIẾT SỰ CỐ · #{item.id.slice(0, 8)} (v{current.version})
          </span>
          <button onClick={onClose} aria-label="Đóng bảng chi tiết" className="m-close-btn">
            <X size={21} />
          </button>
        </div>

        <div className="m-panel-heading">
          <CategoryIcon category={item.category} />
          <h2>{current.title}</h2>
          <div>
            <StatusPill status={current.status} />
            <PriorityPill priority={current.priority} triage={current.triage_required} />
          </div>
        </div>

        <div className="m-panel-tabs" role="tablist" aria-label="Các mục thông tin sự cố">
          <button
            role="tab"
            aria-selected={tab === 'info'}
            tabIndex={tab === 'info' ? 0 : -1}
            className={tab === 'info' ? 'active' : ''}
            onClick={() => setTab('info')}
            onKeyDown={(e) => handleTabKeyDown(e, 'info')}
          >
            Thông tin
          </button>
          <button
            role="tab"
            aria-selected={tab === 'updates'}
            tabIndex={tab === 'updates' ? 0 : -1}
            className={tab === 'updates' ? 'active' : ''}
            onClick={() => setTab('updates')}
            onKeyDown={(e) => handleTabKeyDown(e, 'updates')}
          >
            Cập nhật ({history.length + comments.length})
          </button>
          <button
            role="tab"
            aria-selected={tab === 'actions'}
            tabIndex={tab === 'actions' ? 0 : -1}
            className={tab === 'actions' ? 'active' : ''}
            onClick={() => setTab('actions')}
            onKeyDown={(e) => handleTabKeyDown(e, 'actions')}
          >
            Xử lý quy trình
          </button>
        </div>

        <div className="m-panel-scroll">
          {error && (
            <p className="m-error" role="alert">
              {error}
            </p>
          )}

          {conflictNotice && (
            <div className="m-alert-box conflict" role="alert">
              <AlertCircle size={18} style={{ float: 'left', marginRight: '8px' }} />
              <strong>Xung đột phiên bản (OCC 409):</strong>
              <p style={{ margin: '4px 0 0' }}>{conflictNotice}</p>
            </div>
          )}

          {forbiddenNotice && (
            <div className="m-alert-box forbidden" role="alert">
              <ShieldAlert size={18} style={{ float: 'left', marginRight: '8px' }} />
              <strong>Từ chối truy cập (403 Forbidden):</strong>
              <p style={{ margin: '4px 0 0' }}>{forbiddenNotice}</p>
            </div>
          )}

          {!detail ? (
            <Loading />
          ) : tab === 'info' ? (
            <>
              <div className="m-detail-grid">
                <div>
                  <span>Vị trí sự cố</span>
                  <strong>
                    <MapPin size={16} /> {detail.building}
                    {detail.location_detail && ` · ${detail.location_detail}`}
                  </strong>
                </div>
                <div>
                  <span>Ngày báo cáo</span>
                  <strong>{formatDate(detail.reported_at)}</strong>
                </div>
                <div>
                  <span>Bộ phận phụ trách</span>
                  <strong>
                    {detail.department_name ||
                      (detail.department_id
                        ? DEPARTMENTS[detail.department_id]?.name
                        : 'Chưa phân công')}
                  </strong>
                </div>
                <div>
                  <span>Nhân viên xử lý</span>
                  <strong>{detail.assigned_handler_name || 'Chưa chỉ định'}</strong>
                </div>
                <div>
                  <span>Định mức SLA</span>
                  <strong>
                    {detail.priority === 'p1'
                      ? 'Khẩn cấp (15 phút)'
                      : detail.priority === 'p2'
                      ? 'Cao (2 giờ)'
                      : 'Tiêu chuẩn (8 giờ)'}
                  </strong>
                </div>
                <div>
                  <span>Phiên bản dữ liệu</span>
                  <strong>Phiên bản #{detail.version}</strong>
                </div>
              </div>

              <h3>Mô tả sự cố</h3>
              <p className="m-detail-text">{detail.description}</p>

              <h3>Thông tin theo loại sự cố</h3>
              <div className="m-answer-list">
                {Object.entries(detail.answers).map(([key, value]) => (
                  <div key={key}>
                    <span>
                      {(
                        {
                          leak_amount: 'Mức rò',
                          near_electricity: 'Gần điện',
                          slip_risk: 'Nguy cơ trơn trượt',
                          exposed_wire: 'Dây điện hở',
                          smoke_or_sparks: 'Khói / tia lửa',
                          equipment: 'Thiết bị',
                          interaction: 'Tương tác',
                          channel: 'Kênh nhận',
                          sender_text: 'Người gửi',
                        } as Record<string, string>
                      )[key] || key}
                    </span>
                    <strong>{String(value ?? '—')}</strong>
                  </div>
                ))}
              </div>

              <h3>Tệp đính kèm ({attachments.length})</h3>
              {attachments.length ? (
                <div className="m-files">
                  {attachments.map((file) => (
                    <div key={file.id}>
                      <FileText size={17} />
                      {file.original_name}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="m-muted">Chưa có tệp đính kèm nào được tải lên.</p>
              )}
            </>
          ) : tab === 'updates' ? (
            <>
              <h3>Lịch sử cập nhật</h3>
              {history.length ? (
                <div className="m-timeline">
                  {history.map((entry) => (
                    <div key={entry.id}>
                      <i />
                      <strong>{entry.action.replace(/_/g, ' ')}</strong>
                      <small>
                        {entry.actor_display_name} · {formatDate(entry.created_at)}
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="m-muted">Chưa có cập nhật lịch sử.</p>
              )}

              {comments.length > 0 && (
                <>
                  <h3>Trao đổi ({comments.length})</h3>
                  <div className="m-comments">
                    {comments.map((entry) => (
                      <div key={entry.id}>
                        <strong>{entry.author_name}</strong>
                        <small>
                          {formatDate(entry.created_at)} ·{' '}
                          {entry.visibility === 'internal' ? 'Ghi chú nội bộ' : 'Công khai'}
                        </small>
                        <p>{entry.body}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {permissions?.canAddPublicComments && (
                <div className="m-comment">
                  <label className="m-field">
                    Gửi cập nhật trao đổi
                    <textarea
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      rows={3}
                      placeholder="Nhập nội dung trao đổi hoặc cập nhật tiến độ…"
                    />
                  </label>
                  {permissions.canAddInternalNotes && (
                    <select
                      aria-label="Phạm vi hiển thị trao đổi"
                      value={visibility}
                      onChange={(event) =>
                        setVisibility(event.target.value as typeof visibility)
                      }
                    >
                      <option value="public">Người báo cáo có thể xem</option>
                      <option value="internal">Chỉ nhân viên nội bộ</option>
                    </select>
                  )}
                  <button
                    className="m-button primary"
                    disabled={busy || !comment.trim()}
                    onClick={sendComment}
                  >
                    Gửi cập nhật
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <h3>Thao tác với sự cố</h3>
              <p className="m-muted">
                Chỉ hiển thị các hành động phù hợp với vai trò của bạn và trạng thái hiện tại của sự
                cố.
              </p>

              <div className="m-action-list">
                {permissions?.canAcknowledge && detail.status === 'assigned' && (
                  <ActionChoice
                    label="Xác nhận tiếp nhận xử lý"
                    onClick={() =>
                      run(() => demoClient.acknowledgeIncident(detail.id, detail.version))
                    }
                  />
                )}
                {permissions?.canResolve && detail.status === 'in_progress' && (
                  <ActionChoice label="Hoàn tất xử lý sự cố" onClick={() => setAction('resolve')} />
                )}
                {permissions?.canClose && detail.status === 'resolved' && (
                  <ActionChoice label="Đóng hồ sơ sự cố" onClick={() => setAction('close')} />
                )}
                {manager && ['resolved', 'closed'].includes(detail.status) && (
                  <ActionChoice label="Mở lại sự cố (Reopen)" onClick={() => setAction('reopen')} />
                )}
                {permissions?.canAssign &&
                  ['reported', 'assigned', 'in_progress'].includes(detail.status) && (
                    <ActionChoice label="Phân công nhân viên" onClick={() => setAction('assign')} />
                  )}
                {manager && detail.triage_required && detail.status === 'reported' && (
                  <ActionChoice label="Phân loại thủ công (Triage)" onClick={() => setAction('triage')} />
                )}
                {permissions?.canAdjustPriority &&
                  ['reported', 'assigned'].includes(detail.status) &&
                  !detail.acknowledged_at &&
                  !detail.triage_required && (
                    <ActionChoice label="Điều chỉnh độ ưu tiên" onClick={() => setAction('priority')} />
                  )}
                {manager && detail.status !== 'closed' && (
                  <ActionChoice
                    label="Đánh dấu trùng / không hợp lệ (Disposition)"
                    onClick={() => setAction('disposition')}
                  />
                )}
              </div>

              {action && (
                <div className="m-action-form">
                  <div className="m-action-title">
                    <strong>
                      {
                        (
                          {
                            assign: 'Phân công nhân viên',
                            triage: 'Phân loại thủ công',
                            priority: 'Điều chỉnh ưu tiên',
                            resolve: 'Hoàn tất xử lý',
                            close: 'Đóng sự cố',
                            reopen: 'Mở lại sự cố',
                            disposition: 'Kết thúc hồ sơ (Disposition)',
                          } as Record<Action, string>
                        )[action]
                      }
                    </strong>
                    <button onClick={() => setAction(null)} aria-label="Hủy thao tác">
                      <X size={17} />
                    </button>
                  </div>

                  {['assign', 'triage'].includes(action) && (
                    <label className="m-field">
                      Bộ phận phụ trách
                      <select
                        value={department}
                        onChange={(event) => {
                          setDepartment(event.target.value)
                          setHandler('')
                        }}
                      >
                        {Object.values(DEPARTMENTS)
                          .filter((value) => value.id !== 'dept-triage')
                          .map((value) => (
                            <option key={value.id} value={value.id}>
                              {value.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}

                  {action === 'assign' && (
                    <label className="m-field">
                      Nhân viên xử lý
                      <select
                        value={handler}
                        onChange={(event) => setHandler(event.target.value)}
                      >
                        <option value="">Chưa chỉ định nhân viên</option>
                        {handlers.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.display_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {['triage', 'priority'].includes(action) && (
                    <label className="m-field">
                      Mức ưu tiên
                      <select
                        value={priority}
                        onChange={(event) =>
                          setPriority(event.target.value as typeof priority)
                        }
                      >
                        <option value="p1">P1 - Khẩn cấp (SLA tiếp nhận: 15 phút)</option>
                        <option value="p2">P2 - Cao (SLA tiếp nhận: 2 giờ)</option>
                        <option value="p3">P3 - Tiêu chuẩn (SLA tiếp nhận: 8 giờ)</option>
                      </select>
                    </label>
                  )}

                  {action === 'resolve' && (
                    <label className="m-field">
                      Kết quả giải quyết sự cố <b>*</b>
                      <textarea
                        rows={3}
                        value={resolution}
                        onChange={(event) => setResolution(event.target.value)}
                        placeholder="Mô tả công việc sửa chữa / khắc phục đã thực hiện…"
                      />
                    </label>
                  )}

                  {action === 'disposition' && (
                    <>
                      <label className="m-field">
                        Loại kết thúc hồ sơ
                        <select
                          value={disposition}
                          onChange={(event) =>
                            setDisposition(event.target.value as typeof disposition)
                          }
                        >
                          <option value="invalid">Không hợp lệ</option>
                          <option value="duplicate">Báo trùng</option>
                        </select>
                      </label>
                      {disposition === 'duplicate' && (
                        <label className="m-field">
                          Mã sự cố gốc <b>*</b>
                          <input
                            value={duplicateId}
                            onChange={(event) => setDuplicateId(event.target.value)}
                            placeholder="Nhập mã sự cố gốc bị trùng"
                          />
                        </label>
                      )}
                    </>
                  )}

                  {action !== 'resolve' && (
                    <label className="m-field">
                      Lý do thao tác {action === 'close' ? '(tùy chọn)' : '<b>*</b>'}
                      <textarea
                        rows={3}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Giải thích ngắn gọn lý do để lưu vào lịch sử kiểm toán…"
                      />
                    </label>
                  )}

                  <button
                    className="m-button primary wide"
                    onClick={perform}
                    disabled={
                      busy ||
                      (action === 'resolve'
                        ? resolution.trim().length < 5
                        : action !== 'close' && reason.trim().length < 5) ||
                      (action === 'disposition' &&
                        disposition === 'duplicate' &&
                        !duplicateId.trim())
                    }
                  >
                    {busy ? 'Đang lưu…' : 'Xác nhận thao tác'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
