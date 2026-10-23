import { useState } from 'react'
import type { Category } from '../../types/incident.ts'

interface ReporterNewIncidentSelectViewProps {
  onGoToWireframe: () => void
}

export function ReporterNewIncidentSelectView({ onGoToWireframe }: ReporterNewIncidentSelectViewProps) {
  const [selectedCat, setSelectedCat] = useState<Category>('water_leak')

  return (
    <div className="new-incident-select-container">
      <div className="select-hero-box">
        <h3 className="select-hero-title">Chọn Loại Sự Cố Cần Báo Cáo</h3>
        <p className="select-hero-sub">
          Hệ thống sẽ phân luồng câu hỏi đặc thù và chuyển tiếp đến đúng bộ phận phụ trách
        </p>

        {/* 3 Categories Grid */}
        <div className="category-selection-grid mt-3">
          <div
            className={`cat-select-card ${selectedCat === 'water_leak' ? 'selected' : ''}`}
            onClick={() => setSelectedCat('water_leak')}
          >
            <div className="cat-card-header">
              <span className="cat-icon-lg">💧</span>
              <span className="cat-radio-indicator">{selectedCat === 'water_leak' ? '●' : '○'}</span>
            </div>
            <h4 className="cat-card-title">Rò Rỉ Nước</h4>
            <p className="cat-card-desc">
              Đường ống nước bị rò, van hỏng, trần ngấm nước, vòi nước nhỏ giọt hoặc sàn nhà bị ngập ướt.
            </p>
            <div className="cat-card-meta">
              <span>Bộ phận: <strong>Cơ sở vật chất</strong></span>
            </div>
          </div>

          <div
            className={`cat-select-card ${selectedCat === 'electrical_hazard' ? 'selected' : ''}`}
            onClick={() => setSelectedCat('electrical_hazard')}
          >
            <div className="cat-card-header">
              <span className="cat-icon-lg">⚡</span>
              <span className="cat-radio-indicator">{selectedCat === 'electrical_hazard' ? '●' : '○'}</span>
            </div>
            <h4 className="cat-card-title">Nguy Hiểm Về Điện</h4>
            <p className="cat-card-desc">
              Dây điện hở, ổ cắm phát tia lửa/mùi khét, aptomat nhảy liên tục hoặc thiết bị điện quá nhiệt.
            </p>
            <div className="cat-card-meta">
              <span>Bộ phận: <strong>Điện &amp; An toàn</strong></span>
            </div>
          </div>

          <div
            className={`cat-select-card ${selectedCat === 'phishing' ? 'selected' : ''}`}
            onClick={() => setSelectedCat('phishing')}
          >
            <div className="cat-card-header">
              <span className="cat-icon-lg">🎣</span>
              <span className="cat-radio-indicator">{selectedCat === 'phishing' ? '●' : '○'}</span>
            </div>
            <h4 className="cat-card-title">Lừa Đảo / Phishing</h4>
            <p className="cat-card-desc">
              Email mạo danh nhà trường, tin nhắn yêu cầu đổi mật khẩu hoặc đường link đáng ngờ đánh cắp tài khoản.
            </p>
            <div className="cat-card-meta">
              <span>Bộ phận: <strong>IT / Security</strong></span>
            </div>
          </div>
        </div>

        {/* Action Prompt */}
        <div className="select-action-box mt-3">
          <div className="action-box-info">
            <strong>📋 Quy trình báo cáo sự cố (Lộ trình N6):</strong>
            <p className="text-muted mt-1">
              Tuần 2 hoàn thiện bộ khung <strong>Layout Responsive, Auth &amp; Bearer Token in Memory</strong>. Form chi tiết rò nước sẽ được tích hợp chuyên sâu tại W3.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onGoToWireframe}
          >
            📐 Xem Bản Vẽ Chi Tiết Biểu Mẫu (Wireframe W1)
          </button>
        </div>
      </div>
    </div>
  )
}
