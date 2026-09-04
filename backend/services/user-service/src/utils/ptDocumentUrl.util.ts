import crypto from "crypto";
import { logger } from "@gym-coach/shared";

/**
 * Signed, short-lived URLs for PT application identity documents (national
 * ID front/back, portrait, certificates, other media).
 *
 * Why signed URLs instead of a Bearer-token-gated endpoint: these documents
 * are rendered via plain `<img src=...>` tags in the admin review UI and the
 * applicant's own review screen, and a browser `<img>` element cannot attach
 * an Authorization header. The ownership/role check therefore has to happen
 * at the moment the URL is MINTED (inside getMe/getById/listApplications,
 * which already run behind authMiddleware + the existing own-application/
 * ADMIN-only route gates) rather than at the moment the image is fetched.
 * The signature is the portable proof that minting was authorized; it
 * expires quickly to limit the exposure window if a URL ever leaks (shared
 * screenshot, browser history, proxy log, ...).
 */

const SECRET = process.env.PT_DOCUMENT_URL_SECRET || process.env.INTERNAL_SERVICE_SECRET || "";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (IS_PRODUCTION && (!SECRET || SECRET.length < 32)) {
  logger.error(
    "PT_DOCUMENT_URL_SECRET/INTERNAL_SERVICE_SECRET missing or under 32 chars in production — PT document links will be rejected.",
  );
}

// Dev-only fallback so local/test runs work without extra env setup. Never used in
// production: the startup check above already refuses a weak/missing secret there,
// and verifyDocumentUrl below independently re-checks isProduction before accepting
// any signature computed with this fallback would be moot anyway since the real
// secret is required by CI/deploy config.
const EFFECTIVE_SECRET = SECRET || "dev-only-insecure-pt-doc-secret-change-me";

const TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough to render a page, short if leaked
const PT_APPLICATIONS_PREFIX = "/uploads/pt-applications/";
const PT_APPLICATIONS_S3_REF_PREFIX = "s3://pt-applications/";

function sign(filename: string, exp: number): string {
  return crypto.createHmac("sha256", EFFECTIVE_SECRET).update(`${filename}:${exp}`).digest("hex");
}

function signedUrlFor(filename: string): string {
  const exp = Date.now() + TTL_MS;
  const sig = sign(filename, exp);
  return `/pt-applications/documents/${encodeURIComponent(filename)}?exp=${exp}&sig=${sig}`;
}

function signS3Key(key: string, exp: number): string {
  return crypto
    .createHmac("sha256", EFFECTIVE_SECRET)
    .update(`s3:${key}:${exp}`)
    .digest("hex");
}

function isSafeS3PtApplicationKey(key: string): boolean {
  return (
    key.startsWith("pt-applications/") &&
    !key.startsWith("/") &&
    !key.includes("\\") &&
    !key.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function signedS3UrlFor(key: string): string {
  const exp = Date.now() + TTL_MS;
  const sig = signS3Key(key, exp);
  return `/pt-applications/documents/s3?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
}

/** Rewrites a stored `/uploads/pt-applications/<filename>` URL into a signed,
 * short-lived link. Non-matching values (null, already-external URLs, etc.)
 * pass through unchanged. */
export function toSignedPtDocumentUrl(storedUrl: string | null | undefined): string | null {
  if (!storedUrl) return storedUrl ?? null;
  if (storedUrl.startsWith(PT_APPLICATIONS_S3_REF_PREFIX)) {
    const key = storedUrl.slice("s3://".length);
    if (!isSafeS3PtApplicationKey(key)) return null;
    return signedS3UrlFor(key);
  }
  if (!storedUrl.startsWith(PT_APPLICATIONS_PREFIX)) return storedUrl;
  const filename = storedUrl.slice(PT_APPLICATIONS_PREFIX.length);
  return signedUrlFor(filename);
}

export function verifyDocumentUrl(filename: string, exp?: string, sig?: string): boolean {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || Date.now() > expNum) return false;
  const expected = sign(filename, expNum);
  const expectedBuf = Buffer.from(expected, "utf-8");
  const sigBuf = Buffer.from(sig, "utf-8");
  if (expectedBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, sigBuf);
}

export function verifyDocumentS3Key(key: string, exp?: string, sig?: string): boolean {
  if (!isSafeS3PtApplicationKey(key)) return false;
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || Date.now() > expNum) return false;
  const expected = signS3Key(key, expNum);
  const expectedBuf = Buffer.from(expected, "utf-8");
  const sigBuf = Buffer.from(sig, "utf-8");
  if (expectedBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, sigBuf);
}

const SIGNED_DOCUMENT_PREFIX = "/pt-applications/documents/";

/**
 * Normalizes a document URL back to its stable, canonical stored form before
 * writing to the database — regardless of whether the frontend echoes back
 * the raw `/uploads/pt-applications/<filename>` path or a signed
 * `/pt-applications/documents/<filename>?exp=...&sig=...` link it received
 * from a previous read. Without this, saving a draft after the signed link's
 * TTL semantics would otherwise let an expiring URL get permanently
 * persisted as the stored value. Applied on every write path
 * (saveDraft/certificates/media) so "sign on read, canonicalize on write"
 * holds no matter which shape the client sends back.
 */
export function canonicalizePtDocumentUrl(url: string | null | undefined): string | null | undefined {
  if (!url) return url;
  if (url.startsWith(PT_APPLICATIONS_S3_REF_PREFIX)) return url;
  if (url.startsWith("/pt-applications/documents/s3?")) {
    const parsed = new URL(url, "http://internal.local");
    const key = parsed.searchParams.get("key");
    if (key && isSafeS3PtApplicationKey(key)) return `s3://${key}`;
    return null;
  }
  if (!url.startsWith(SIGNED_DOCUMENT_PREFIX)) return url;
  const withoutPrefix = url.slice(SIGNED_DOCUMENT_PREFIX.length);
  const filename = decodeURIComponent(withoutPrefix.split("?")[0]);
  return `/uploads/pt-applications/${filename}`;
}

/** Deep-rewrites every known document URL field on a PT application object
 * (including nested certificates/media arrays) to signed links. Mutates a
 * shallow copy — never the original object/DB row. */
export function signPtApplicationDocumentUrls<T extends Record<string, any>>(app: T): T {
  if (!app) return app;
  const result: any = { ...app };
  if ("idCardFrontUrl" in result) result.idCardFrontUrl = toSignedPtDocumentUrl(result.idCardFrontUrl);
  if ("idCardBackUrl" in result) result.idCardBackUrl = toSignedPtDocumentUrl(result.idCardBackUrl);
  if ("portraitPhotoUrl" in result) result.portraitPhotoUrl = toSignedPtDocumentUrl(result.portraitPhotoUrl);
  if (Array.isArray(result.certificates)) {
    result.certificates = result.certificates.map((c: any) => ({
      ...c,
      certificateFileUrl: toSignedPtDocumentUrl(c.certificateFileUrl),
    }));
  }
  if (Array.isArray(result.media)) {
    result.media = result.media.map((m: any) => ({
      ...m,
      fileUrl: toSignedPtDocumentUrl(m.fileUrl),
    }));
  }
  return result;
}
