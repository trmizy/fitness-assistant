import fs from "node:fs/promises";
import type { NextFunction, Request, Response } from "express";
import { sniffMime } from "../services/dispute-case/evidence-storage";

/**
 * N13A-05 / N13B-03: multer's fileFilter only sees what the client DECLARES (file name + Content-Type). This middleware runs AFTER multer has written the
 * file to disk and judges the real bytes (magic numbers, the same `sniffMime` the dispute-evidence upload uses): JPEG / PNG / WEBP / PDF, nothing else.
 * A file that is not one of `allowed` is deleted from disk and answered 400 in Vietnamese; the controller never sees it.
 */
export type SniffedType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

/** Reads the first bytes of a stored file and returns the type its BYTES say it is (or null). */
export async function sniffFileOnDisk(filePath: string): Promise<string | null> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, "r");
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, 16, 0);
    return sniffMime(head.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export function requireRealFileType(allowed: readonly SniffedType[], message: string, code: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const file = (req as Request & { file?: { path?: string } }).file;
    // no file at all: the controller answers its own "no file" error
    if (!file?.path) return next();
    const real = await sniffFileOnDisk(file.path);
    if (real && (allowed as readonly string[]).includes(real)) return next();
    await fs.rm(file.path, { force: true }).catch(() => {});
    res.status(400).json({ error: message, code });
  };
}

export const requireRealAvatarImage = requireRealFileType(
  ["image/jpeg", "image/png", "image/webp"],
  "Ảnh đại diện không hợp lệ: chỉ nhận ảnh JPG, PNG hoặc WEBP thật (nội dung tệp phải đúng định dạng ảnh)",
  "INVALID_IMAGE_FILE",
);

export const requireRealPtDocument = requireRealFileType(
  ["image/jpeg", "image/png", "application/pdf"],
  "Tệp không hợp lệ: chỉ nhận ảnh JPG, PNG hoặc PDF thật (nội dung tệp phải đúng định dạng)",
  "INVALID_DOCUMENT_FILE",
);
