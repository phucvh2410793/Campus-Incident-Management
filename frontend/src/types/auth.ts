export type Role = 'reporter' | 'handler' | 'department_manager' | 'administrator'

export interface UserSummary {
  id: string
  display_name: string
  email: string
  role: Role
  department_id: string | null
  is_active: boolean
}

export interface LoginRequest {
  email: string
  password?: string
}

export interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  expires_at: string
  user: UserSummary
}
