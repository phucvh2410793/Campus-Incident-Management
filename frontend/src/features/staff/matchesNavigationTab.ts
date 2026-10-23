import type { IncidentResponse } from '../../types/incident.ts'
import { mockN7StaffRoleApi } from '../../mocks/n7-role-mock-api.ts'
import type { NavTabKey } from './StaffNavigationTabs.tsx'

export function matchesNavigationTab(incident: IncidentResponse, tab: NavTabKey): boolean {
  if (tab === 'handler-in-progress') return incident.status === 'in_progress'
  if (tab === 'handler-completed') return incident.status === 'resolved' || incident.status === 'closed'
  if (tab === 'manager-unassigned' || tab === 'admin-unassigned') {
    return !incident.assigned_handler_id && (incident.status === 'reported' || incident.status === 'assigned')
  }
  if (tab === 'manager-triage' || tab === 'admin-triage') return incident.triage_required
  if (tab === 'manager-sla' || tab === 'admin-sla') {
    return ['overdue', 'warning'].includes(mockN7StaffRoleApi.getSlaStatus(incident).state)
  }
  return true
}
