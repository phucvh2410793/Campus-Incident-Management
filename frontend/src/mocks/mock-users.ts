import type { UserSummary } from '../types/auth.ts'

export interface Department {
  id: string
  name: string
  code: string
  description: string
}

export const DEPARTMENTS: Record<string, Department> = {
  'dept-csvc': {
    id: 'dept-csvc',
    name: 'Cơ sở vật chất',
    code: 'CSVC',
    description: 'Quản lý cơ sở hạ tầng, đường ống nước, phòng học, vệ sinh',
  },
  'dept-dien': {
    id: 'dept-dien',
    name: 'Điện và an toàn',
    code: 'DIEN',
    description: 'Xử lý sự cố lưới điện, thiết bị điện, nguy cơ cháy nổ, an toàn lao động',
  },
  'dept-it': {
    id: 'dept-it',
    name: 'IT / Security',
    code: 'IT',
    description: 'Quản lý hệ thống công nghệ thông tin, an toàn thông tin, phòng chống lừa đảo/phishing',
  },
  'dept-triage': {
    id: 'dept-triage',
    name: 'Hàng đợi phân loại thủ công',
    code: 'TRIAGE',
    description: 'Bộ phận tiếp nhận ban đầu cho các sự cố chưa phân loại hoặc thiếu dữ liệu',
  },
}

export const MOCK_USERS: Record<string, UserSummary> = {
  'user-reporter': {
    id: '22e09230-76fd-4638-a97f-96919031e40b',
    display_name: 'Lê Minh Tuấn (Sinh viên)',
    email: 'reporter@usth.edu.vn',
    role: 'reporter',
    department_id: null,
    is_active: true,
  },
  'user-handler-csvc': {
    id: '33a01234-76fd-4638-a97f-96919031e001',
    display_name: 'Phạm Văn Nam (KTV Cơ sở vật chất)',
    email: 'handler.csvc@usth.edu.vn',
    role: 'handler',
    department_id: 'dept-csvc',
    is_active: true,
  },
  'user-handler-dien': {
    id: '33a01234-76fd-4638-a97f-96919031e002',
    display_name: 'Trần Quốc Tuấn (KTV Điện & An toàn)',
    email: 'handler.dien@usth.edu.vn',
    role: 'handler',
    department_id: 'dept-dien',
    is_active: true,
  },
  'user-manager-csvc': {
    id: '44b01234-76fd-4638-a97f-96919031e003',
    display_name: 'Hoàng Đức (Trưởng ban Cơ sở vật chất)',
    email: 'manager.csvc@usth.edu.vn',
    role: 'department_manager',
    department_id: 'dept-csvc',
    is_active: true,
  },
  'user-manager-dien': {
    id: '44b01234-76fd-4638-a97f-96919031e004',
    display_name: 'Đỗ Thị Hà (Trưởng ban Điện & An toàn)',
    email: 'manager.dien@usth.edu.vn',
    role: 'department_manager',
    department_id: 'dept-dien',
    is_active: true,
  },
  'user-manager-it': {
    id: '44b01234-76fd-4638-a97f-96919031e005',
    display_name: 'Vũ Văn An (Trưởng nhóm An ninh mạng)',
    email: 'manager.it@usth.edu.vn',
    role: 'department_manager',
    department_id: 'dept-it',
    is_active: true,
  },
  'user-manager-triage': {
    id: '44b01234-76fd-4638-a97f-96919031e006',
    display_name: 'Nguyễn Văn Triage (Điều phối viên Tiếp nhận)',
    email: 'manager.triage@usth.edu.vn',
    role: 'department_manager',
    department_id: 'dept-triage',
    is_active: true,
  },
  'user-admin': {
    id: '99e09230-76fd-4638-a97f-96919031e999',
    display_name: 'Quản trị viên Hệ thống (Admin)',
    email: 'admin@usth.edu.vn',
    role: 'administrator',
    department_id: null,
    is_active: true,
  },
}
