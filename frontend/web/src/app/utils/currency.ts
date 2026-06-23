const vndFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

export function formatVND(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'Liên hệ';
  }
  return vndFormatter.format(value);
}
