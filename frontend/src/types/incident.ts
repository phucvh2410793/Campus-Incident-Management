export type Category = 'water_leak' | 'electrical_hazard' | 'phishing'

export type Status = 'reported' | 'assigned' | 'in_progress' | 'resolved' | 'closed'

export type Severity = 'low' | 'medium' | 'high' | 'critical' | null

export type Priority = 'p1' | 'p2' | 'p3' | null

export interface WaterLeakAnswers {
  leak_amount: 'small' | 'large' | 'unknown'
  near_electricity: 'yes' | 'no' | 'unknown'
  slip_risk?: boolean | null
}

export interface ElectricalHazardAnswers {
  exposed_wire: 'yes' | 'no' | 'unknown'
  smoke_or_sparks: 'yes' | 'no' | 'unknown'
  equipment?: string | null
}

export interface PhishingAnswers {
  interaction: 'none' | 'clicked_link' | 'entered_information' | 'unknown'
  channel: 'email' | 'message' | 'other'
  sender_text?: string | null
}

export type FormAnswers = WaterLeakAnswers | ElectricalHazardAnswers | PhishingAnswers

export interface RuleEvaluation {
  rule_id: string
  rule_version: string
  reason: string
}

export interface IncidentResponse {
  id: string
  version: number
  category: Category
  title: string
  description: string
  building: string
  location_detail: string | null
  observed_at: string | null
  answers: FormAnswers
  reporter_id: string
  status: Status
  triage_required: boolean
  severity: Severity
  priority: Priority
  department_id: string | null
  assigned_handler_id: string | null
  rule_evaluation: RuleEvaluation | null
  reported_at: string
  assigned_at: string | null
  acknowledged_at: string | null
  resolved_at: string | null
  closed_at: string | null
  acknowledgment_deadline_at: string | null
  escalation_level: number
  // Extra fields for rich wireframe/mock display
  reporter_name?: string
  department_name?: string
  assigned_handler_name?: string
  resolution?: string | null
  disposition?: {
    kind: 'duplicate' | 'invalid'
    reason: string
    duplicate_of_id?: string | null
  } | null
}

export interface IncidentSummary {
  id: string
  version: number
  category: Category
  title: string
  status: Status
  priority: Priority
  triage_required: boolean
  department_id: string | null
  department_name?: string
  reported_at: string
  acknowledgment_deadline_at: string | null
  overdue: boolean
}

export interface HistoryItem {
  id: string
  action: string
  actor_display_name: string
  created_at: string
  visibility: 'public' | 'internal'
  details?: Record<string, unknown>
}

export interface Comment {
  id: string
  body: string
  visibility: 'public' | 'internal'
  author_id: string
  author_name: string
  created_at: string
}

export interface AttachmentSummary {
  id: string
  original_name: string
  content_type: string
  size_bytes: number
  created_at: string
  incident_version: number
}

export interface ContractErrorDetail {
  field: string
  reason: string
}

export interface ContractError {
  error: {
    code: string
    message: string
    details?: ContractErrorDetail[]
    request_id: string
  }
}
