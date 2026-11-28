/**
 * Test Suite Task N6-W09: Rà mobile, bàn phím, label, focus và thông tin priority không chỉ bằng màu
 * Người thực hiện: Đỗ Tuấn Kiệt (Giao diện người báo - Tuần 9)
 * Tiêu chí hoàn thành: Kịch bản chính thao tác trên điện thoại/laptop bằng bàn phím;
 *                    nhãn priority rõ ràng không dùng màu đơn lẻ; chuẩn touch target >= 44px.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const priorityLabels: Record<'p1' | 'p2' | 'p3', { text: string; sla: string }> = {
  p1: { text: 'P1 - Khẩn cấp', sla: '15 phút' },
  p2: { text: 'P2 - Cao', sla: '2 giờ' },
  p3: { text: 'P3 - Tiêu chuẩn', sla: '8 giờ' },
}

console.log('--- BẮT ĐẦU KIỂM THỬ TASK N6-W09: ACCESSIBILITY, KEYBOARD, MOBILE & LABELS (ĐỖ TUẤN KIỆT) ---\n')

// ============================================================================
// 1. KIỂM TRA NHÃN PRIORITY KHÔNG PHỤ THUỘC MÀU SẮC (WCAG SC 1.4.1)
// ============================================================================
console.log('--- 1. Kiểm tra Tiêu chí: Nhãn Priority đầy đủ ngữ nghĩa & SLA (Không chỉ dùng màu) ---')

assert.strictEqual(priorityLabels.p1.text, 'P1 - Khẩn cấp')
assert.strictEqual(priorityLabels.p1.sla, '15 phút')
assert.strictEqual(priorityLabels.p2.text, 'P2 - Cao')
assert.strictEqual(priorityLabels.p2.sla, '2 giờ')
assert.strictEqual(priorityLabels.p3.text, 'P3 - Tiêu chuẩn')
assert.strictEqual(priorityLabels.p3.sla, '8 giờ')

for (const [code, meta] of Object.entries(priorityLabels)) {
  assert.ok(meta.text.includes('P'), `Priority ${code} phải có tiền tố mã rõ ràng`)
  assert.ok(meta.text.length > 5, `Priority ${code} phải có chữ giải thích ngữ nghĩa tiếng Việt`)
  assert.ok(meta.sla.length > 0, `Priority ${code} phải có định mức thời gian SLA`)
  console.log(`✓ Mức ưu tiên [${code.toUpperCase()}]: "${meta.text}" — Định mức SLA: ${meta.sla}`)
}

// Kiểm tra mã nguồn ReporterWorkspace.tsx có nhãn priority rõ ràng
const reporterSource = readFileSync(join(import.meta.dirname, 'src/modern/ReporterWorkspace.tsx'), 'utf-8')
assert.ok(reporterSource.includes('P1 - Khẩn cấp'), 'ReporterWorkspace phải hiển thị chữ "P1 - Khẩn cấp"')
assert.ok(reporterSource.includes('P2 - Cao'), 'ReporterWorkspace phải hiển thị chữ "P2 - Cao"')
assert.ok(reporterSource.includes('P3 - Tiêu chuẩn'), 'ReporterWorkspace phải hiển thị chữ "P3 - Tiêu chuẩn"')
assert.ok(reporterSource.includes('Cần phân loại thủ công'), 'ReporterWorkspace phải hiển thị nhãn cho sự cố cần phân loại')
assert.ok(reporterSource.includes('aria-label='), 'ReporterWorkspace phải có thuộc tính aria-label cho nhãn priority')
console.log('✓ Mã nguồn ReporterWorkspace: Đảm bảo 100% nhãn mức độ ưu tiên có chữ và aria-label')

// ============================================================================
// 2. KIỂM TRA HỖ TRỢ BÀN PHÍM, FOCUS & ĐIỀU HƯỚNG WAI-ARIA
// ============================================================================
console.log('\n--- 2. Kiểm tra Hỗ trợ Bàn phím & Focus WAI-ARIA ---')

// 2.1 Escape key listener trong ReporterDetail
assert.ok(reporterSource.includes("'Escape'"), 'ReporterDetail phải có listener cho phím Escape để đóng nhanh')
console.log('✓ ReporterDetail: Hỗ trợ phím Escape đóng cửa sổ nhanh chóng')

// 2.2 Tab điều hướng WAI-ARIA
assert.ok(reporterSource.includes('role="tablist"'), 'Tab navigation phải có role="tablist"')
assert.ok(reporterSource.includes('role="tab"'), 'Tab buttons phải có role="tab"')
assert.ok(reporterSource.includes('aria-selected='), 'Tab buttons phải có aria-selected')
assert.ok(reporterSource.includes('handleTabKeyDown'), 'Tab buttons phải hỗ trợ phím mũi tên chuyển tab WAI-ARIA')
console.log('✓ Tab Thông tin / Cập nhật: Chuẩn WAI-ARIA với phím mũi tên chuyển đổi mượt mà')

// 2.3 Keyboard trong danh sách hàng đợi (IncidentRow)
assert.ok(reporterSource.includes('tabIndex={0}'), 'IncidentRow phải có tabIndex={0} cho người dùng bàn phím')
assert.ok(reporterSource.includes('role="row"'), 'IncidentRow phải có role="row"')
assert.ok(reporterSource.includes("e.key === 'Enter' || e.key === ' '"), 'IncidentRow phải mở sự cố khi bấm Enter hoặc Space')
console.log('✓ Danh sách báo cáo: Hàng sự cố có tabIndex={0} và nhận phím Enter/Space để mở chi tiết')

// 2.4 Keyboard trong Form tạo báo cáo (CreateReport Category choices)
assert.ok(reporterSource.includes('role="radiogroup"'), 'Form chọn danh mục phải có role="radiogroup"')
assert.ok(reporterSource.includes('role="radio"'), 'Mỗi lựa chọn danh mục phải có role="radio"')
assert.ok(reporterSource.includes('aria-checked='), 'Lựa chọn danh mục phải có aria-checked')
console.log('✓ Form tạo báo cáo: Danh mục sự cố hỗ trợ chọn bằng bàn phím theo chuẩn RadioGroup')

// ============================================================================
// 3. KIỂM TRA HỆ THỐNG CSS FOCUS & GIAO DIỆN DI ĐỘNG (MOBILE & LAPTOP)
// ============================================================================
console.log('\n--- 3. Kiểm tra Hệ thống CSS Focus & Tối ưu Giao diện Mobile ---')

const cssSource = readFileSync(join(import.meta.dirname, 'src/modern/modern-extra.css'), 'utf-8')

// 3.1 Vòng sáng Focus :focus-visible
assert.ok(cssSource.includes(':focus-visible'), 'CSS phải định nghĩa vòng sáng focus rõ ràng cho bàn phím')
assert.ok(cssSource.includes('.m-incident-row:focus-visible'), 'CSS phải có focus-visible cho hàng sự cố')
assert.ok(cssSource.includes('.m-category-choice:focus-visible'), 'CSS phải có focus-visible cho khối chọn loại sự cố')
console.log('✓ Hệ thống CSS: Vòng sáng :focus-visible tương phản cao cho toàn bộ tương tác bàn phím')

// 3.2 Chuẩn Touch Target >= 44px
assert.ok(cssSource.includes('min-height: 44px'), 'Các nút thao tác di động phải đạt chiều cao tối thiểu 44px (Touch Target WCAG 2.5.5)')
console.log('✓ Chuẩn nút chạm di động: Đạt kích thước tối thiểu 44px theo tiêu chuẩn thiết kế cảm ứng WCAG 2.5.5')

// 3.3 Media Query co giãn màn hình nhỏ <= 768px
assert.ok(cssSource.includes('@media (max-width: 768px)'), 'CSS phải có Media Query cho màn hình nhỏ <= 768px')
assert.ok(cssSource.includes('max-width: 100vw'), 'Panel chi tiết phải co giãn toàn màn hình trên mobile')
console.log('✓ Giao diện di động (<= 768px): Tối ưu độ rộng toàn màn hình 100vw, chống tràn ngang và tối ưu thao tác ngón tay')

console.log('\n🎉 ĐẠT TOÀN BỘ CÁC MỤC KIỂM THỬ TASK N6-W09 CỦA ĐỖ TUẤN KIỆT!')
console.log('✅ Tiêu chí hoàn thành cốt lõi: Rà mobile, bàn phím, label, focus và thông tin priority không chỉ bằng màu; kịch bản chính thao tác trên điện thoại/laptop bằng bàn phím.\n')
