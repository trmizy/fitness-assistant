/**
 * 14B.6 (PG-B7) — the paid-package form, checked the way ai-service's createPackageSchema checks it:
 * name 3–120 characters, price a positive amount, weeks (optional) a positive whole number.
 */
export type PackageForm = { name: string; price: string; durationWeeks: string; description: string };

export function packageFormError(f: PackageForm): string | null {
  const name = f.name.trim();
  if (name.length < 3) return "Tên gói cần ít nhất 3 ký tự";
  if (name.length > 120) return "Tên gói tối đa 120 ký tự";
  const price = Number(f.price);
  if (!f.price.trim() || !Number.isFinite(price) || price <= 0) return "Nhập giá lớn hơn 0";
  if (f.durationWeeks.trim()) {
    const w = Number(f.durationWeeks);
    if (!Number.isInteger(w) || w <= 0) return "Số tuần phải là số nguyên dương";
  }
  if (f.description.length > 2000) return "Mô tả tối đa 2000 ký tự";
  return null;
}

export function packagePayload(publishedPlanId: string, f: PackageForm) {
  return {
    publishedPlanId,
    name: f.name.trim(),
    price: Number(f.price),
    durationWeeks: f.durationWeeks.trim() ? Number(f.durationWeeks) : undefined,
    description: f.description.trim() || undefined,
  };
}
