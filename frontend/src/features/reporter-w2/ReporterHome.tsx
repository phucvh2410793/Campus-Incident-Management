import { useState } from 'react'
import { ReporterCreateIncident } from '../reporter-w6/ReporterCreateIncident.tsx'
import { ReporterIncidentPortal } from '../reporter-w7/ReporterIncidentPortal.tsx'

export function ReporterHome() {
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list')

  return (
    <div className="reporter-home-wrap">
      {/* Top Action & Sub-Navigation */}
      <div
        className="reporter-tab-strip"
        style={{
          display: 'flex',
          gap: '0.75rem',
          marginBottom: '1rem',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className={`btn ${activeTab === 'list' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setActiveTab('list')}
          >
            📋 Báo cáo của tôi & Timeline (N6-W07)
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'create' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setActiveTab('create')}
          >
            ➕ Gửi báo cáo mới (N6-W06)
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            className="w2-badge"
            style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}
          >
            N6 · Giao diện Người báo cáo (Đỗ Tuấn Kiệt)
          </span>
        </div>
      </div>

      {activeTab === 'create' ? (
        <ReporterCreateIncident
          onIncidentCreated={() => setActiveTab('list')}
          onCancel={() => setActiveTab('list')}
        />
      ) : (
        <ReporterIncidentPortal onOpenCreate={() => setActiveTab('create')} />
      )}
    </div>
  )
}
