/**
 * Tiện ích chuyển cảnh GUI mượt mà (View Transitions API + CSS fallback)
 * Hỗ trợ làm mờ/fade-out giao diện cũ và hiện rõ từ mờ sang nét giao diện mới
 */

export function transitionGui(callback: () => void) {
  if (typeof document !== 'undefined' && 'startViewTransition' in document) {
    document.startViewTransition(() => {
      callback()
    })
  } else {
    callback()
  }
}
