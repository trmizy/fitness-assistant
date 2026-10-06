import QRCode from "qrcode";

/**
 * E1 (owner side of 14.3) — the front-desk check-in QR, drawn natively. Web renders the same
 * server token with `qrcode`'s canvas/PNG output (`GymCheckinPanel`); there is no canvas here, so
 * the module matrix becomes one SVG path instead (react-native-svg). Same library and version as
 * web, so both apps encode the token identically.
 */

/** One `M x y h1 v1 h-1 z` square per dark module — a single <Path> instead of hundreds of <Rect>. */
export function qrMatrixPath(text: string): { size: number; path: string } {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { size, data } = qr.modules;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size, path };
}

/** The server signs the token with an expiry (GYM_QR_TTL_DAYS, 365 by default) — a printed QR
 *  stops working on that day, so the owner is told when to print a fresh one. */
export function qrExpiryLabel(expiresAt: number | string | null | undefined): string | null {
  if (expiresAt == null || expiresAt === "") return null;
  const d = new Date(typeof expiresAt === "string" && /^\d+$/.test(expiresAt) ? Number(expiresAt) : expiresAt);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `Mã dùng được đến ${dd}/${mm}/${d.getFullYear()}`;
}

/** Web lists arrivals by the first 8 characters of the member id (it has no names). */
export function shortMemberId(id: string | null | undefined): string {
  return id ? `${id.slice(0, 8)}…` : "—";
}

/** "14:05 · 01/10" — web's timeAgo format in GymCheckinPanel. */
export function checkinTimeLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())} · ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}
