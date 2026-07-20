export function todayDateOnly(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function elapsedPercent(startIso: string, endIso: string, nowIso = new Date().toISOString()): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const now = new Date(nowIso).getTime();
  if (end <= start) return 0;
  return clampPercent(((now - start) / (end - start)) * 100);
}

export function daysBetween(aIso: string, bIso: string): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) / MS_PER_DAY;
}
