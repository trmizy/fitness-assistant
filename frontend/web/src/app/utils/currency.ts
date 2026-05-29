export function formatVND(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'Liên hệ';
  }
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}
