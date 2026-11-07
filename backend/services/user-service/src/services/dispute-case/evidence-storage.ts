import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * DISPUTE CASE slice 2 / S2.8 - LOCAL file storage for evidence files, DEV / TEST ONLY, SYNTHETIC DATA ONLY (production storage and the retention policy
 * are blocked by B-7). The caller checks the fail-closed flag DISPUTE_CASE_EVIDENCE_STORAGE_ENABLED; this module only does the bytes.
 *
 *  - Directory: DISPUTE_CASE_EVIDENCE_DIR, default <os tmp>/gymini-dispute-evidence-test. Never user-service/uploads (other data lives there): a
 *    directory inside any `uploads` folder of the service is refused.
 *  - A stored file is addressed by an opaque key `<caseId>/<random uuid>.<ext>` that only the server writes into the database. The key is never taken
 *    from a request, so a request cannot name a path.
 *  - The type is decided from the BYTES (magic numbers), and must agree with the declared MIME; size is capped.
 *  - The server computes sha256 over the bytes it stored; reading re-computes it and refuses a file that no longer matches (integrity).
 */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_MIME: Readonly<Record<string, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export function storageDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = path.resolve(env.DISPUTE_CASE_EVIDENCE_DIR || path.join(os.tmpdir(), "gymini-dispute-evidence-test"));
  const serviceUploads = path.resolve(__dirname, "..", "..", "..", "uploads");
  const inside = (a: string, b: string) => a === b || a.startsWith(b + path.sep);
  if (inside(dir, serviceUploads) || inside(dir, path.resolve(process.cwd(), "uploads")) || dir.split(path.sep).includes("uploads")) {
    throw Object.assign(new Error("EVIDENCE_DIR_REFUSED: the evidence directory must not be inside an 'uploads' folder"), { code: "EVIDENCE_DIR_REFUSED" });
  }
  return dir;
}

export const sha256Buffer = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** The MIME type the BYTES say they are (jpeg / png / webp / pdf), or null. */
export function sniffMime(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

export interface StoredFile {
  key: string;
  sha256: string;
  sizeBytes: number;
  mime: string;
}

export async function storeFile(caseId: string, bytes: Buffer, mime: string): Promise<StoredFile> {
  const ext = ALLOWED_MIME[mime];
  if (!ext) throw new Error("mime not allowed");
  const key = `${caseId}/${randomUUID()}.${ext}`;
  const full = path.join(storageDir(), key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes, { flag: "wx" });
  return { key, sha256: sha256Buffer(bytes), sizeBytes: bytes.length, mime };
}

const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

/** Reads the stored bytes and re-checks the hash recorded at upload. Throws EVIDENCE_FILE_MISSING / EVIDENCE_FILE_INTEGRITY. */
export async function readVerified(key: string, expectedSha256: string): Promise<Buffer> {
  if (!KEY_RE.test(key)) throw Object.assign(new Error("bad storage key"), { code: "EVIDENCE_FILE_MISSING" });
  const dir = storageDir();
  const full = path.resolve(dir, key);
  if (!full.startsWith(dir + path.sep)) throw Object.assign(new Error("bad storage key"), { code: "EVIDENCE_FILE_MISSING" });
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(full);
  } catch {
    throw Object.assign(new Error("file missing"), { code: "EVIDENCE_FILE_MISSING" });
  }
  if (sha256Buffer(bytes) !== expectedSha256) throw Object.assign(new Error("stored file does not match its recorded sha256"), { code: "EVIDENCE_FILE_INTEGRITY" });
  return bytes;
}

export async function removeFile(key: string): Promise<void> {
  if (!KEY_RE.test(key)) return;
  await fs.rm(path.join(storageDir(), key), { force: true }).catch(() => {});
}
