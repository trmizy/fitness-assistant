/**
 * Money, formatted the one way the whole product formats it — ported from web's
 * `utils/currency.ts`, including its fallback: a missing price reads "Liên hệ", never "0 ₫".
 *
 * `Intl.NumberFormat` with a locale works on Hermes because the app is built with
 * `jsEngine: hermes` + Intl enabled (expo's default), the same API web relies on.
 */
export function formatVND(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "Liên hệ";
  }
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}
