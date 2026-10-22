import { useState } from 'react'
import type { Category } from '../../types/incident.ts'
import { transitionGui } from '../../utils/transition.ts'

type SubTab = 'forms' | 'states'
type StateType = 'loading' | 'empty' | 'error422' | 'error401' | 'error409'

export function ReporterWireframeView() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('forms')
  const [selectedForm, setSelectedForm] = useState<Category>('water_leak')
  const [selectedState, setSelectedState] = useState<StateType>('loading')

  return (
    <div className="wireframe-view-container">
      <div className="wireframe-header-banner">
        <h2>Giao Diện Người Báo Cáo</h2>

        {/* Sub-nav */}
        <div className="sub-tab-nav">
          <button
            type="button"
            className={`sub-tab-btn ${activeSubTab === 'forms' ? 'active' : ''}`}
            onClick={() => transitionGui(() => setActiveSubTab('forms'))}
          >
            📐 Bản Vẽ 3 Biểu Mẫu Báo Cáo
          </button>
          <button
            type="button"
            className={`sub-tab-btn ${activeSubTab === 'states' ? 'active' : ''}`}
            onClick={() => transitionGui(() => setActiveSubTab('states'))}
          >
            🎛️ Bản Vẽ 5 Trạng Thái Giao Diện
          </button>
        </div>
      </div>

      {/* TAB 1: WIREFRAME BA FORM */}
      {activeSubTab === 'forms' && (
        <div key="forms" className="wireframe-content-section gui-fade-transition">
          <div className="wireframe-control-strip">
            <span className="control-label">Chọn biểu mẫu để xem:</span>
            <div className="pill-group">
              <button
                type="button"
                className={`pill-btn ${selectedForm === 'water_leak' ? 'active' : ''}`}
                onClick={() => transitionGui(() => setSelectedForm('water_leak'))}
              >
                💧 Biểu mẫu 1: Rò rỉ nước
              </button>
              <button
                type="button"
                className={`pill-btn ${selectedForm === 'electrical_hazard' ? 'active' : ''}`}
                onClick={() => transitionGui(() => setSelectedForm('electrical_hazard'))}
              >
                ⚡ Biểu mẫu 2: Nguy hiểm về điện
              </button>
              <button
                type="button"
                className={`pill-btn ${selectedForm === 'phishing' ? 'active' : ''}`}
                onClick={() => transitionGui(() => setSelectedForm('phishing'))}
              >
                🎣 Biểu mẫu 3: Lừa đảo giả mạo (Phishing)
              </button>
            </div>
          </div>

          {/* Wireframe Mockup Frame */}
          <div className="wireframe-frame">
            <div className="wireframe-browser-bar">
              <span className="window-dots">🔴 🟡 🟢</span>
              <span className="window-url">https://incident.usth.edu.vn/reporter/new-incident</span>
              <span className="wireframe-tag">[MÔ PHỎNG BẢN VẼ KHUNG]</span>
            </div>

            <div key={selectedForm} className="wireframe-paper gui-fade-transition">
              <div className="wf-header">
                <h3>[BÁO CÁO SỰ CỐ MỚI]</h3>
                <p className="wf-note">Khuôn viên trường Đại học Khoa học và Công nghệ Hà Nội (USTH)</p>
              </div>

              {/* Safety Alerts on Wireframe */}
              {selectedForm === 'water_leak' && (
                <div className="wf-alert wf-alert-warning">
                  <strong>[!] HƯỚNG DẪN AN TOÀN KHI GẦN ĐIỆN:</strong>
                  <p>
                    Nếu nước chảy gần khu vực tủ điện, ổ cắm hoặc thiết bị điện, hãy rời khỏi khu vực và gọi ngay đầu
                    mối ứng cứu khẩn cấp của trường. Báo cáo ứng dụng không thay thế cuộc gọi khẩn cấp!
                  </p>
                </div>
              )}

              {selectedForm === 'electrical_hazard' && (
                <div className="wf-alert wf-alert-danger">
                  <strong>[!] CẢNH BÁO NGUY HIỂM TỨC THỜI:</strong>
                  <p>
                    Khu vực có khói, tia lửa hoặc dây điện hở gây nguy cơ điện giật hoặc cháy nổ nghiêm trọng. Giữ khoảng
                    cách an toàn ít nhất 5 mét và thông báo cho người xung quanh!
                  </p>
                </div>
              )}

              {selectedForm === 'phishing' && (
                <div className="wf-alert wf-alert-info">
                  <strong>[!] LƯU Ý BẢO MẬT TÀI KHOẢN:</strong>
                  <p>
                    Không nhập mật khẩu, mã OTP hoặc tài liệu bí mật vào form. Nếu đã lỡ nhập thông tin trên trang web
                    lạ, hãy báo ngay cho IT/Security để khóa và đổi mật khẩu tài khoản trường.
                  </p>
                </div>
              )}

              {/* Form Category Selector Wireframe */}
              <div className="wf-box">
                <div className="wf-box-title">[1. LỰA CHỌN LOẠI SỰ CỐ]</div>
                <div className="wf-category-row">
                  <div className={`wf-cat-card ${selectedForm === 'water_leak' ? 'selected' : ''}`}>
                    <div className="wf-radio-dot">{selectedForm === 'water_leak' ? '●' : '○'}</div>
                    <strong>💧 Rò nước</strong>
                    <small>Rò đường ống, sàn ướt, trần ngấm nước</small>
                  </div>
                  <div className={`wf-cat-card ${selectedForm === 'electrical_hazard' ? 'selected' : ''}`}>
                    <div className="wf-radio-dot">{selectedForm === 'electrical_hazard' ? '●' : '○'}</div>
                    <strong>⚡ Nguy hiểm điện</strong>
                    <small>Dây hở, khói, tia lửa, ổ cắm hỏng</small>
                  </div>
                  <div className={`wf-cat-card ${selectedForm === 'phishing' ? 'selected' : ''}`}>
                    <div className="wf-radio-dot">{selectedForm === 'phishing' ? '●' : '○'}</div>
                    <strong>🎣 Phishing</strong>
                    <small>Email giả mạo, liên kết lừa đảo</small>
                  </div>
                </div>
              </div>

              {/* Specific Questions Wireframe */}
              <div className="wf-box">
                <div className="wf-box-title">[2. CÂU HỎI ĐẶC THÙ THEO LOẠI SỰ CỐ]</div>

                {selectedForm === 'water_leak' && (
                  <div className="wf-fields-grid">
                    <div className="wf-field">
                      <label>Mức độ rò nước (*):</label>
                      <div className="wf-mock-input">[ Ít (nhỏ giọt) | Nhiều (thành dòng) | Không rõ ] (Dropdown)</div>
                    </div>
                    <div className="wf-field">
                      <label>Gần nguồn điện / tủ điện? (*):</label>
                      <div className="wf-mock-input">[ Không gần điện | Có gần điện (Ưu tiên P1) | Không rõ ]</div>
                    </div>
                    <div className="wf-field wf-field-full">
                      <label className="wf-checkbox-mock">[x] Có nguy cơ gây trượt ngã cho người đi lại (slip_risk)</label>
                    </div>
                  </div>
                )}

                {selectedForm === 'electrical_hazard' && (
                  <div className="wf-fields-grid">
                    <div className="wf-field">
                      <label>Có dây điện hở / lộ lõi đồng? (*):</label>
                      <div className="wf-mock-input">[ Có dây hở (Ưu tiên P1) | Không có | Không rõ ]</div>
                    </div>
                    <div className="wf-field">
                      <label>Có khói, mùi khét hoặc tia lửa? (*):</label>
                      <div className="wf-mock-input">[ Có khói/tia lửa (Critical P1) | Không có | Không rõ ]</div>
                    </div>
                    <div className="wf-field wf-field-full">
                      <label>Thiết bị liên quan (Tùy chọn, tối đa 200 ký tự):</label>
                      <div className="wf-mock-input">[ Nhập tên thiết bị: VD Ổ cắm máy chiếu, máy lạnh... ]</div>
                    </div>
                  </div>
                )}

                {selectedForm === 'phishing' && (
                  <div className="wf-fields-grid">
                    <div className="wf-field">
                      <label>Mức độ tương tác (*):</label>
                      <div className="wf-mock-input">[ Chưa tương tác | Bấm vào link | ĐÃ NHẬP THÔNG TIN (P1) | Không rõ ]</div>
                    </div>
                    <div className="wf-field">
                      <label>Kênh nhận thông tin (*):</label>
                      <div className="wf-mock-input">[ Email trường | Tin nhắn SMS/Zalo | Kênh khác ]</div>
                    </div>
                    <div className="wf-field wf-field-full">
                      <label>Địa chỉ người gửi / Tên miền khả nghi (Văn bản thuần, max 254 ký tự):</label>
                      <div className="wf-mock-input">[ VD: support@daotao-usth.edu.vn (Chỉ hiển thị text, không mở URL) ]</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Common Fields Wireframe */}
              <div className="wf-box">
                <div className="wf-box-title">[3. THÔNG TIN CHUNG THEO API CONTRACT]</div>
                <div className="wf-fields-grid">
                  <div className="wf-field wf-field-full">
                    <label>Tiêu đề sự cố (*) (5–120 ký tự):</label>
                    <div className="wf-mock-input">[ Nhập tiêu đề ngắn gọn mô tả hiện tượng sự cố ]</div>
                  </div>
                  <div className="wf-field">
                    <label>Tòa nhà / Khu vực (*):</label>
                    <div className="wf-mock-input">[ Tòa A | Tòa B | Tòa C | Thư viện | Ký túc xá ] (Dropdown)</div>
                  </div>
                  <div className="wf-field">
                    <label>Vị trí chi tiết (Tối đa 200 ký tự):</label>
                    <div className="wf-mock-input">[ Tầng, số phòng, số cột hành lang... ]</div>
                  </div>
                  <div className="wf-field wf-field-full">
                    <label>Thời điểm quan sát (ISO 8601 UTC, không được ở tương lai):</label>
                    <div className="wf-mock-input">[ 2026-10-15T09:30:00Z ] (Datetime picker)</div>
                  </div>
                  <div className="wf-field wf-field-full">
                    <label>Mô tả chi tiết (*) (20–2000 ký tự):</label>
                    <div className="wf-mock-textarea">[ Nhập mô tả cụ thể hiện trạng, quy mô ảnh hưởng... ]</div>
                  </div>
                </div>
              </div>

              {/* Evidence Attachments Wireframe */}
              <div className="wf-box">
                <div className="wf-box-title">[4. BẰNG CHỨNG ĐÍNH KÈM (POST /attachments)]</div>
                <p className="wf-desc">
                  Quy ước W1: Tối đa 5 file/incident, $\le$ 10 MiB/file; chỉ định dạng PDF/PNG/JPEG. Upload từng tệp độc
                  lập sau khi tạo sự cố thành công kèm expected_version.
                </p>
                <div className="wf-mock-upload-btn">[ + Chọn tệp bằng chứng từ máy tính ]</div>
                <div className="wf-file-row">
                  <span>📄 anh_hien_truong.jpg (1.4 MB) — [Sẵn sàng upload]</span>
                  <span className="wf-remove-link">[Xóa]</span>
                </div>
              </div>

              {/* Submit Button Row */}
              <div className="wf-submit-row">
                <button type="button" className="wf-btn-mock">
                  [ Gửi Báo Cáo Sự Cố ] (Có khóa chống gửi trùng lặp)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: WIREFRAME 5 TRẠNG THÁI */}
      {activeSubTab === 'states' && (
        <div key="states" className="wireframe-content-section gui-fade-transition">
          <div className="wireframe-control-strip">
            <span className="control-label">Chọn trạng thái giao diện để xem:</span>
            <div className="pill-group">
              <button
                type="button"
                className={`pill-btn ${selectedState === 'loading' ? 'active' : ''}`}
                onClick={() => transitionGui(() => setSelectedState('loading'))}
              >
                1. ⏳ Đang tải (Loading)
              </button>
              <button
                type="button"
                className={`pill-btn ${selectedState === 'empty' ? 'active' : ''}`}
                onClick={() => transitionGui(() => setSelectedState('empty'))}
              >
                2. 📭 Chưa có dữ liệu (Empty)
              </button>
              <button
                type="button"
                className={`pill-btn ${selectedState === 'error422' ? 'active' : ''}`}
                onClick={() => transitionGui(() => setSelectedState('error422'))}
              >
                3. ❌ Lỗi 422 (Dữ liệu không hợp lệ)
              </button>
              <button
                type="button"
                className={`pill-btn ${selectedState === 'error401' ? 'active' : ''}`}
                onClick={() => transitionGui(() => setSelectedState('error401'))}
              >
                4. 🔒 Lỗi 401 (Hết phiên đăng nhập)
              </button>
              <button
                type="button"
                className={`pill-btn ${selectedState === 'error409' ? 'active' : ''}`}
                onClick={() => transitionGui(() => setSelectedState('error409'))}
              >
                5. ⚠️ Lỗi 409 (Xung đột phiên bản)
              </button>
            </div>
          </div>

          <div className="wireframe-frame">
            <div className="wireframe-browser-bar">
              <span className="window-dots">🔴 🟡 🟢</span>
              <span className="window-url">https://incident.usth.edu.vn/reporter/state-preview</span>
              <span className="wireframe-tag">[TRẠNG THÁI: {selectedState.toUpperCase()}]</span>
            </div>

            <div key={selectedState} className="wireframe-paper gui-fade-transition">
              {/* 1. LOADING STATE */}
              {selectedState === 'loading' && (
                <div className="wf-state-box">
                  <div className="wf-spinner-placeholder">
                    <div className="spinner"></div>
                    <h4>[ĐANG TẢI DỮ LIỆU SỰ CỐ...]</h4>
                    <p className="hint">Mọi request HTTP có trạng thái chờ, hiển thị skeleton loader hoặc spinner.</p>
                  </div>

                  <div className="skeleton-card">
                    <div className="skeleton-line skeleton-title"></div>
                    <div className="skeleton-line skeleton-meta"></div>
                    <div className="skeleton-line skeleton-body"></div>
                  </div>
                  <div className="skeleton-card">
                    <div className="skeleton-line skeleton-title"></div>
                    <div className="skeleton-line skeleton-meta"></div>
                    <div className="skeleton-line skeleton-body"></div>
                  </div>
                </div>
              )}

              {/* 2. EMPTY STATE */}
              {selectedState === 'empty' && (
                <div className="wf-state-box">
                  <div className="empty-state">
                    <div className="empty-icon">📭</div>
                    <h3>[CHƯA CÓ BÁO CÁO SỰ CỐ NÀO]</h3>
                    <p className="hint">
                      Bạn chưa gửi báo cáo sự cố nào trong hệ thống. Khi phát hiện rò nước, nguy hiểm điện hoặc email
                      lừa đảo, hãy nhấn nút bên dưới để tạo báo cáo.
                    </p>
                    <button type="button" className="btn btn-primary mt-2">
                      [ + Tạo báo cáo sự cố đầu tiên ]
                    </button>
                  </div>
                </div>
              )}

              {/* 3. ERROR 422 VALIDATION */}
              {selectedState === 'error422' && (
                <div className="wf-state-box">
                  <div className="alert alert-error">
                    <strong>[MÃ 422 - VALIDATION ERROR]:</strong> Dữ liệu yêu cầu không hợp lệ theo quy tắc của hệ thống.
                  </div>

                  <div className="wf-field is-error">
                    <label>Tiêu đề sự cố (*):</label>
                    <div className="wf-mock-input wf-input-error">[ Rò ]</div>
                    <span className="field-error">✗ Tiêu đề phải từ 5 đến 120 ký tự (Hiện tại: 2 ký tự).</span>
                  </div>

                  <div className="wf-field is-error mt-2">
                    <label>Mô tả sự cố (*):</label>
                    <div className="wf-mock-textarea wf-input-error">[ Nước chảy ]</div>
                    <span className="field-error">✗ Mô tả bắt buộc từ 20 đến 2000 ký tự (Hiện tại: 9 ký tự).</span>
                  </div>

                  <div className="wf-field is-error mt-2">
                    <label>Thời điểm quan sát:</label>
                    <div className="wf-mock-input wf-input-error">[ 2026-12-31T12:00:00Z ]</div>
                    <span className="field-error">✗ Thời điểm quan sát không được ở tương lai.</span>
                  </div>
                </div>
              )}

              {/* 4. ERROR 401 UNAUTHENTICATED */}
              {selectedState === 'error401' && (
                <div className="wf-state-box">
                  <div className="alert alert-error">
                    <strong>[MÃ 401 - UNAUTHENTICATED]:</strong> Phiên đăng nhập không hợp lệ hoặc đã hết hạn (TTL 8
                    giờ). Token lưu trong bộ nhớ ứng dụng đã bị thu hồi hoặc reset.
                  </div>

                  <div className="wf-login-dialog">
                    <h4>[YÊU CẦU ĐĂNG NHẬP LẠI]</h4>
                    <p className="hint">Vui lòng nhập email trường USTH và mật khẩu để tiếp tục thao tác.</p>
                    <div className="wf-field mt-2">
                      <label>Email USTH:</label>
                      <div className="wf-mock-input">[ reporter@usth.edu.vn ]</div>
                    </div>
                    <div className="wf-field mt-2">
                      <label>Mật khẩu demo:</label>
                      <div className="wf-mock-input">[ ********** ]</div>
                    </div>
                    <button type="button" className="btn btn-primary mt-2">
                      [ Đăng nhập &amp; Cấp Token Mới ]
                    </button>
                  </div>
                </div>
              )}

              {/* 5. ERROR 409 CONFLICT */}
              {selectedState === 'error409' && (
                <div className="wf-state-box">
                  <div className="alert alert-danger">
                    <strong>[MÃ 409 - VERSION CONFLICT]:</strong> Bản ghi sự cố đã thay đổi bởi một thao tác khác trên
                    hệ thống! (Client gửi expected_version=1 nhưng phiên bản hiện tại trên server là version=2).
                  </div>

                  <div className="wf-conflict-resolution-card">
                    <h4>[XỬ LÝ XUNG ĐỘNG PHIÊN BẢN]</h4>
                    <p>
                      Để bảo toàn tính toàn vẹn dữ liệu và không ghi đè âm thầm, vui lòng nhấn nút bên dưới để tải dữ
                      liệu mới nhất từ server trước khi bổ sung thông tin.
                    </p>
                    <div className="mt-2">
                      <button type="button" className="btn btn-primary">
                        [ 🔄 Tải lại dữ liệu mới nhất (v2) ]
                      </button>
                      <button type="button" className="btn btn-outline ml-2">
                        [ Giữ lại nội dung đang gõ ]
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
