export const STATUS_LABELS = {
  FREE: 'Còn trống',
  OCCUPIED: 'Đã có xe',
  RESERVED: 'Đã giữ chỗ',
  MAINTENANCE: 'Bảo trì',
  OPEN: 'Đang mở',
  OPENING: 'Đang mở',
  CLOSED: 'Đã đóng',
  CLOSING: 'Đang đóng',
  BLOCKED: 'Đang khóa',
  ERROR: 'Có lỗi',
  EVACUATION: 'Thoát hiểm',
  DETECTED: 'Đã phát hiện',
  AIMING: 'Đang định hướng',
  SUPPRESSING: 'Đang chữa cháy',
  RESOLVED: 'Đã xử lý',
  FALSE_ALARM: 'Báo động giả',
  PENDING: 'Đang chờ',
  PROCESSING: 'Đang thanh toán',
  SUCCESS: 'Đã thanh toán',
  EXPIRED: 'Đã hết hạn',
  REFUNDED: 'Đã hoàn tiền',
  SENT: 'Đã gửi',
  ACKNOWLEDGED: 'Đã xác nhận',
  FAILED: 'Thất bại',
  ONLINE: 'Trực tuyến',
  OFFLINE: 'Ngoại tuyến',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || 'Chưa xác định';
}

export function formatDateTime(value) {
  if (!value) return 'Chưa có dữ liệu';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Không hợp lệ';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function formatTime(value) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function formatDuration(startValue, endValue = new Date()) {
  if (!startValue) return '—';
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';
  const minutes = Math.max(0, Math.floor((end - start) / 60000));
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} giờ ${rest} phút`;
}

export function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric * 100));
}

export function normalizePlate(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(amount);
}
