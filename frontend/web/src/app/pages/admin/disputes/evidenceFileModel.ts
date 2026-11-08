/**
 * Real evidence files (S2.8, flag `evidenceStorage`). Pure rules shared by the party upload form and both download buttons.
 * Mirrors user-service `services/dispute-case/evidence-storage.ts` (MAX_EVIDENCE_BYTES, ALLOWED_MIME) and the controller's
 * `evidenceFileFields` (description 1..2000, title 1..200 optional). The server stays the judge: it re-checks the size and reads the
 * real type from the bytes (a renamed file is refused 415 UNSUPPORTED_MEDIA_TYPE); this only saves a pointless upload.
 */

export const MAX_EVIDENCE_FILE_BYTES = 5 * 1024 * 1024;

/** declared MIME -> what the user sees */
export const EVIDENCE_FILE_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WEBP",
  "application/pdf": "PDF",
};

/** for `<input accept>` */
export const EVIDENCE_FILE_ACCEPT = Object.keys(EVIDENCE_FILE_TYPES).join(",");

export const EVIDENCE_FILE_RULE = "Ảnh JPG, PNG, WEBP hoặc tệp PDF, tối đa 5 MB.";

export interface PickedFile {
  name: string;
  size: number;
  type: string;
}

export function validateEvidenceFile(file: PickedFile | null | undefined): { ok: boolean; error?: string } {
  if (!file) return { ok: false, error: "Hãy chọn một tệp." };
  if (file.size <= 0) return { ok: false, error: "Tệp rỗng, không gửi được." };
  if (file.size > MAX_EVIDENCE_FILE_BYTES) return { ok: false, error: `Tệp lớn hơn 5 MB (${formatBytes(file.size)}).` };
  if (!EVIDENCE_FILE_TYPES[file.type]) return { ok: false, error: `Loại tệp này không được nhận. ${EVIDENCE_FILE_RULE}` };
  return { ok: true };
}

export function validateEvidenceFileText(description: string, title: string): { description?: string; title?: string } {
  const errs: { description?: string; title?: string } = {};
  const d = description.trim();
  if (d.length < 1) errs.description = "Hãy mô tả tệp này chứng minh điều gì.";
  else if (d.length > 2000) errs.description = "Mô tả tối đa 2000 ký tự.";
  if (title.trim().length > 200) errs.title = "Tiêu đề tối đa 200 ký tự.";
  return errs;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The server strips the internal storage key; what remains under `storedFile` marks an evidence row that has a real stored file. */
export function storedFileOf(payload: unknown): { fileName: string | null } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { storedFile?: unknown; fileName?: unknown; originalName?: unknown };
  if (!p.storedFile || typeof p.storedFile !== "object") return null;
  const sf = p.storedFile as { originalName?: unknown; fileName?: unknown };
  const name = [sf.originalName, sf.fileName, p.fileName, p.originalName].find((x): x is string => typeof x === "string" && x.trim() !== "");
  return { fileName: name ? name.trim() : null };
}

/** File name for the browser's save dialog: the declared name if any, else a neutral one. Never the storage key. */
export function downloadName(fileName: string | null | undefined, evidenceId: string): string {
  const clean = (fileName ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return clean || `bang-chung-${evidenceId.slice(0, 8)}`;
}

/** Saves a Blob through a temporary link (browser only). */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
