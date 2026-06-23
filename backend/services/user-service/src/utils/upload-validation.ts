import path from 'path';

export const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
export const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.pdf']);

export function validateUploadFilename(originalname: string): string | null {
  if (originalname.includes('\0')) return 'Filename contains invalid characters.';
  if (/\.\.[/\\]/.test(originalname)) return 'Filename contains a path traversal sequence.';
  if (path.isAbsolute(originalname)) return 'Filename must not be an absolute path.';
  if (/[;&|`$<>]/.test(originalname)) return 'Filename contains disallowed special characters.';
  return null;
}

export function validateUploadMime(mimetype: string, originalname: string): string | null {
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    return `File type '${mimetype}' not allowed. Accepted: image/jpeg, image/png, application/pdf.`;
  }
  const ext = path.extname(originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `File extension '${ext}' not allowed. Accepted: .jpg, .jpeg, .png, .pdf.`;
  }
  return null;
}

// InBody scans accept images only (JPG/PNG). PDF is not supported because
// the VLM extraction pipeline expects a raster image, not a document.
export function validateInBodyMime(mimetype: string, originalname: string): string | null {
  if (mimetype === 'application/pdf' || originalname.toLowerCase().endsWith('.pdf')) {
    return 'PDF files are not accepted for InBody scans. Please upload a JPG or PNG image (max 5 MB).';
  }
  return validateUploadMime(mimetype, originalname);
}
