import { useEffect, useState } from 'react'
import { MOCK_USERS, DEPARTMENTS } from '../../mocks/mock-users.ts'
import { mockN7StaffRoleApi } from '../../mocks/n7-role-mock-api.ts'
import type { IncidentResponse } from '../../types/incident.ts'
import { transitionGui } from '../../utils/transition.ts'

type StaffSubTab = 'queue' | 'detail' | 'timeline'

const roleLabels: Record<string, string> = {
  reporter: 'Người báo cáo',
  handler: 'Kỹ thuật viên',
  department_manager: 'Trưởng bộ phận',
  administrator: 'Quản trị viên',
}

export function StaffWireframeView() {
  const [activeTab, setActiveTab] = useState<StaffSubTab>('queue')
  const [selectedRole, setSelectedRole] = useState<string>('user-manager-csvc')
  const [queue, setQueue] = useState<IncidentResponse[]>([])
  const [queueError, setQueueError] = useState(false)

  const currentUser = MOCK_USERS[selectedRole]

  useEffect(() => {
    let live = true
    mockN7StaffRoleApi.getStaffQueue(currentUser).then((items) => {
      if (live) { setQueue(items); setQueueError(false) }
    }).catch(() => { if (live) setQueueError(true) })
    return () => { live = false }
  }, [currentUser])

  return (
    <div className="wireframe-view-container">
      <div className="wireframe-header-banner">
        <h2>Giao Diện Nhân Viên &amp; Quản Lý</h2>

        {/* Sub-nav */}
        <div className="sub-tab-nav">
          <button
            type="button"
            className={`sub-tab-btn ${activeTab === 'queue' ? 'active' : ''}`}
            onClick={() => transitionGui(() => setActiveTab('queue'))}
          >
            📋 Hàng Đợi Sự Cố &amp; SLA
          </button>
          <button
            type="button"
            className={`sub-tab-btn ${activeTab === 'detail' ? 'active' : ''}`}
            disabled={currentUser.role === 'reporter'}
            onClick={() => transitionGui(() => setActiveTab('detail'))}
          >
            🔍 Chi Tiết Sự Cố
          </button>
          <button
            type="button"
            className={`sub-tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
            disabled={currentUser.role === 'reporter'}
            onClick={() => transitionGui(() => setActiveTab('timeline'))}
          >
            📜 Dòng Thời Gian &amp; Ghi Chú
          </button>
        </div>
      </div>

      {/* TAB 1: WIREFRAME HÀNG ĐỢI & SLA */}
      {activeTab === 'queue' && (
        <div key="queue" className="wireframe-content-section gui-fade-transition">
          <div className="wireframe-control-strip">
            <span className="control-label">Đang xem theo vai trò người dùng:</span>
            <select
              value={selectedRole}
              onChange={(e) => {
                const userId = e.target.value
                transitionGui(() => { setQueue([]); setSelectedRole(userId); setActiveTab('queue') })
              }}
              className="input-select input-sm user-select"
            >
              {Object.values(MOCK_USERS).map((u) => (
                <option key={u.id} value={Object.keys(MOCK_USERS).find((k) => MOCK_USERS[k].id === u.id)}>
                  [{roleLabels[u.role] || u.role}] {u.display_name}
                </option>
              ))}
            </select>
          </div>

          <div className="wireframe-frame">
            <div className="wireframe-browser-bar">
              <span className="window-dots">🔴 🟡 🟢</span>
              <span className="window-url">https://incident.usth.edu.vn/staff/incident-queue</span>
              <span className="wireframe-tag">[MÔ PHỎNG HÀNG ĐỢI SỰ CỐ]</span>
            </div>

            <div className="wireframe-paper">
              <div className="wf-header">
                <h3>[BẢNG ĐIỀU KHIỂN HÀNG ĐỢI SỰ CỐ]</h3>
                <p className="wf-note">
                  Người dùng hiện tại: <strong>{currentUser.display_name}</strong> | Vai trò:{' '}
                  <code>{roleLabels[currentUser.role] || currentUser.role}</code> | Bộ phận:{' '}
                  <code>{currentUser.role === 'administrator' ? 'Tất cả bộ phận' : currentUser.department_id ? DEPARTMENTS[currentUser.department_id]?.name : 'Không gán'}</code>
                </p>
              </div>

              {/* Quick Tabs Wireframe */}
              <div className="wf-quick-tabs-mock">
                <span className="wf-tab active">[Tất cả sự cố]</span>
                <span className="wf-tab">[⚠️ Cần Triage ({queue.filter((inc) => inc.triage_required).length})]</span>
                <span className="wf-tab">[🚨 Quá hạn SLA ({queue.filter((inc) => mockN7StaffRoleApi.getSlaStatus(inc).state === 'overdue').length})]</span>
                <span className="wf-tab">[📥 Chờ tiếp nhận]</span>
                <span className="wf-tab">[🛠️ Đang xử lý]</span>
              </div>

              {/* Filter Toolbar Wireframe */}
              <div className="wf-filter-bar-mock">
                <span>[Bộ lọc: {currentUser.role === 'administrator' ? 'Tất cả bộ phận' : currentUser.department_id ? DEPARTMENTS[currentUser.department_id]?.name : 'Không có quyền xem'}]</span>
                <span>[Ưu tiên: Tất cả v]</span>
                <span>[Trạng thái: Tất cả v]</span>
                <span>[Tìm kiếm: Ô nhập văn bản...]</span>
              </div>

              {/* Queue Table Wireframe */}
              <div className="wf-table-box">
                <table className="queue-table">
                  <thead>
                    <tr>
                      <th>MÃ &amp; TIÊU ĐỀ</th>
                      <th>LOẠI</th>
                      <th>ƯU TIÊN</th>
                      <th>BỘ PHẬN</th>
                      <th>TRẠNG THÁI</th>
                      <th>SLA TIẾP NHẬN</th>
                      <th>THAO TÁC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueError ? (
                      <tr><td colSpan={7}>Không tải được dữ liệu mẫu. Hãy thử lại.</td></tr>
                    ) : queue.length === 0 ? (
                      <tr><td colSpan={7}>Vai trò này chưa có sự cố được phép xem.</td></tr>
                    ) : queue.map((inc) => {
                      const sla = mockN7StaffRoleApi.getSlaStatus(inc)
                      const category = inc.category === 'water_leak' ? '💧 Rò nước' : inc.category === 'electrical_hazard' ? '⚡ Nguy hiểm điện' : '🎣 Phishing'
                      return (
                        <tr key={inc.id}>
                          <td><code>#{inc.id.slice(0, 8)}</code> <strong>{inc.title}</strong> <span className="version-tag">v{inc.version}</span></td>
                          <td>{category}</td>
                          <td><span className={inc.priority === 'p1' ? 'badge badge-danger' : 'badge badge-neutral'}>{inc.priority?.toUpperCase() || 'Chưa gán'}</span></td>
                          <td>{inc.department_id ? DEPARTMENTS[inc.department_id]?.name : 'Chờ tự động hóa'}</td>
                          <td>{inc.triage_required ? 'Cần triage' : inc.status}</td>
                          <td><span className={sla.state === 'overdue' ? 'badge badge-danger' : 'badge badge-neutral'}>{sla.label}</span></td>
                          <td><button type="button" className="btn btn-xs btn-outline" onClick={() => transitionGui(() => setActiveTab('detail'))}>[ Xem wireframe ]</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Wireframe Notes */}
              <div className="wf-note-card mt-2">
                <strong>[ĐẶC TẢ SLA TIẾP NHẬN]:</strong>
                <ul>
                  <li><strong>P1:</strong> Hạn tiếp nhận là 15 phút từ `reported_at`.</li>
                  <li><strong>P2:</strong> Hạn tiếp nhận là 2 giờ từ `reported_at`.</li>
                  <li><strong>P3:</strong> Hạn tiếp nhận là 8 giờ từ `reported_at`.</li>
                  <li><strong>Dừng SLA:</strong> Khi kỹ thuật viên tiếp nhận sự cố (Acknowledge), mốc <code>acknowledged_at</code> được ghi lại và dừng SLA.</li>
                  <li><strong>Cảnh báo Quá hạn:</strong> Nếu vượt quá hạn mà chưa được tiếp nhận, hiển thị cảnh báo <code>🚨 QUÁ HẠN (OVERDUE)</code>.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: WIREFRAME CHI TIẾT SỰ CỐ */}
      {activeTab === 'detail' && (
        <div key="detail" className="wireframe-content-section gui-fade-transition">
          <p className="wf-note">Bố cục minh họa bằng một báo cáo CSVC; dữ liệu theo vai trò được kiểm tra ở tab Hàng đợi.</p>
          <div className="wireframe-frame">
            <div className="wireframe-browser-bar">
              <span className="window-dots">🔴 🟡 🟢</span>
              <span className="window-url">https://incident.usth.edu.vn/staff/incidents/2ee24992</span>
              <span className="wireframe-tag">[MÔ PHỎNG CHI TIẾT SỰ CỐ]</span>
            </div>

            <div className="wireframe-paper">
              <div className="detail-header">
                <span className="category-pill">💧 Rò nước</span>
                <span className="status-pill status-assigned">ĐÃ PHÂN CÔNG</span>
                <span className="priority-pill priority-p1">P1</span>
                <span className="badge badge-neutral">Phiên bản: v1</span>
              </div>

              <h2 className="incident-title-lg">Rò nước nghiêm trọng ở trần gần tủ điện phòng thí nghiệm</h2>

              {/* Action Bar Wireframe */}
              <div className="action-button-bar">
                <button type="button" className="btn btn-success">[ ✓ Tiếp nhận sự cố ]</button>
                <button type="button" className="btn btn-outline">[ 👤 Phân công lại ]</button>
                <button type="button" className="btn btn-outline">[ 🎯 Đổi độ ưu tiên ]</button>
                <button type="button" className="btn btn-primary">[ 🛠️ Hoàn tất xử lý ]</button>
                <button type="button" className="btn btn-outline text-danger">[ ❌ Đóng: Báo Trùng / Sai ]</button>
                <button type="button" className="btn btn-warning">[ ⚡ Kiểm tra xung đột phiên bản (409) ]</button>
              </div>

              {/* SLA Monitor Box */}
              <div className="sla-card-box sla-box-overdue">
                <h4>[GIÁM SÁT THỜI HẠN TIẾP NHẬN (SLA)]</h4>
                <div className="sla-grid">
                  <div>
                    <span className="sla-label">Thời điểm báo:</span>
                    <strong>2026-10-15T08:05:00Z</strong>
                  </div>
                  <div>
                    <span className="sla-label">Hạn chót tiếp nhận:</span>
                    <strong>2026-10-15T08:20:00Z (15 phút)</strong>
                  </div>
                  <div>
                    <span className="sla-label">Tình trạng:</span>
                    <span className="badge badge-danger badge-pulse">🚨 ĐÃ QUÁ HẠN TIẾP NHẬN (25 PHÚT)</span>
                  </div>
                </div>
              </div>

              {/* Metadata Fields Wireframe */}
              <div className="wf-box">
                <div className="wf-box-title">[THÔNG TIN ĐỊA ĐIỂM &amp; KHẢO SÁT]</div>
                <div className="info-grid-2">
                  <div><strong>Tòa nhà:</strong> Tòa A</div>
                  <div><strong>Vị trí cụ thể:</strong> Tầng 2, gần phòng Lab 205</div>
                  <div><strong>Người báo:</strong> Lê Minh Tuấn (Sinh viên)</div>
                  <div><strong>Bộ phận phụ trách:</strong> Cơ sở vật chất</div>
                  <div><strong>Người xử lý:</strong> Phạm Văn Nam (KTV Cơ sở vật chất)</div>
                  <div><strong>Khảo sát đặc thù:</strong> leak_amount=large, near_electricity=yes, slip_risk=true</div>
                </div>
              </div>

              {/* Rule Evaluation Explanation */}
              <div className="wf-box">
                <div className="wf-box-title">[KẾT QUẢ ĐÁNH GIÁ QUY TẮC TỰ ĐỘNG (RULE DEMO-V1)]</div>
                <div className="rule-eval-box">
                  <div><strong>Mã quy tắc:</strong> <code>rule-03-water-near-elec</code> (Version: demo-v1)</div>
                  <div><strong>Giải thích:</strong> Rò nước và gần nguồn điện: Cần ưu tiên cao P1, gắn cờ an toàn điện.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: WIREFRAME TIMELINE & GHI CHÚ */}
      {activeTab === 'timeline' && (
        <div key="timeline" className="wireframe-content-section gui-fade-transition">
          <p className="wf-note">Dòng thời gian minh họa cho báo cáo CSVC trong wireframe.</p>
          <div className="wireframe-frame">
            <div className="wireframe-browser-bar">
              <span className="window-dots">🔴 🟡 🟢</span>
              <span className="window-url">https://incident.usth.edu.vn/staff/incidents/2ee24992/timeline</span>
              <span className="wireframe-tag">[MÔ PHỎNG DÒNG THỜI GIAN &amp; GHI CHÚ]</span>
            </div>

            <div className="wireframe-paper">
              <div className="detail-grid">
                {/* Timeline Column */}
                <div>
                  <h3>[DÒNG THỜI GIAN SỰ CỐ]</h3>
                  <p className="hint">Mọi thay đổi trạng thái, phân công và cảnh báo SLA được ghi nhận tuần tự.</p>

                  <div className="timeline-list mt-2">
                    <div className="timeline-item">
                      <div className="timeline-point"></div>
                      <div className="timeline-body">
                        <div className="timeline-header">
                          <span className="timeline-action">Báo cáo sự cố được tạo</span>
                          <span className="badge-visibility badge-public">🌐 Công khai</span>
                        </div>
                        <div className="timeline-meta">Lê Minh Tuấn (Sinh viên) • 08:05:00 UTC</div>
                      </div>
                    </div>

                    <div className="timeline-item">
                      <div className="timeline-point"></div>
                      <div className="timeline-body">
                        <div className="timeline-header">
                          <span className="timeline-action">Đánh giá quy tắc demo-v1: Gán P1 &amp; CSVC</span>
                          <span className="badge-visibility badge-public">🌐 Công khai</span>
                        </div>
                        <div className="timeline-meta">Hệ thống tự động • 08:06:00 UTC</div>
                      </div>
                    </div>

                    <div className="timeline-item">
                      <div className="timeline-point point-internal"></div>
                      <div className="timeline-body">
                        <div className="timeline-header">
                          <span className="timeline-action">Phân công KTV Phạm Văn Nam</span>
                          <span className="badge-visibility badge-public">🌐 Công khai</span>
                        </div>
                        <div className="timeline-meta">Hoàng Đức (Trưởng ban CSVC) • 08:08:00 UTC</div>
                      </div>
                    </div>

                    <div className="timeline-item">
                      <div className="timeline-point point-internal"></div>
                      <div className="timeline-body">
                        <div className="timeline-header">
                          <span className="timeline-action">Cảnh báo SLA Mức 1: Quá thời hạn tiếp nhận 15 phút</span>
                          <span className="badge-visibility badge-internal">🔒 Nội bộ (Chỉ nhân viên)</span>
                        </div>
                        <div className="timeline-meta">Hệ thống giám sát SLA • 08:21:00 UTC</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Comments & Notes Column */}
                <div>
                  <h3>[TRAO ĐỔI &amp; GHI CHÚ NỘI BỘ]</h3>
                  <p className="hint">Phân biệt giữa bình luận công khai và ghi chú kỹ thuật nội bộ.</p>

                  <div className="comments-list mt-2">
                    <div className="comment-card comment-card-public">
                      <div className="comment-card-header">
                        <strong>Lê Minh Tuấn (Sinh viên)</strong>
                        <span className="badge-visibility badge-public">🌐 Công khai</span>
                      </div>
                      <div className="comment-card-body">
                        Em thấy nước bắt đầu nhỏ giọt xuống sàn gỗ, sinh viên đi lại nhiều dễ trơn trượt ạ.
                      </div>
                    </div>

                    <div className="comment-card comment-card-internal">
                      <div className="comment-card-header">
                        <strong>Hoàng Đức (Trưởng ban CSVC)</strong>
                        <span className="badge-visibility badge-internal">🔒 Ghi chú nội bộ</span>
                      </div>
                      <div className="comment-card-body">
                        [NỘI BỘ] Nam mang theo thang rút, xô hứng và cờ cảnh báo trơn trượt ngay nhé.
                      </div>
                    </div>
                  </div>

                  <div className="comment-form-box mt-2">
                    <label><strong>Thêm bình luận / Ghi chú mới:</strong></label>
                    <div className="radio-group-horizontal mt-1">
                      <label className="radio-label">
                        <input type="radio" name="note-type" defaultChecked />
                        <span>🔒 Ghi chú nội bộ (Chỉ nhân viên)</span>
                      </label>
                      <label className="radio-label">
                        <input type="radio" name="note-type" />
                        <span>🌐 Bình luận công khai (Người báo thấy)</span>
                      </label>
                    </div>
                    <div className="wf-mock-textarea mt-1">[ Nhập nội dung ghi chú nghiệp vụ... ]</div>
                    <button type="button" className="btn btn-primary btn-sm mt-1">[ Gửi ghi chú ]</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
