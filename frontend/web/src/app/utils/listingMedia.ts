/**
 * Listing Management (Phase D1) — photo URLs the listing endpoints hand out.
 *
 * Two kinds:
 *  - public / stable:  "/media/pt-physique/<id>", "/media/gym-photos/<id>" — gateway-relative; the web app reaches
 *    the gateway through its API base ("/api" in dev, nginx in prod, or an absolute VITE_API_URL), so they need that
 *    prefix. Public routes, no Authorization header needed for an <img>.
 *  - short-lived presigned links for STAGED photos — already absolute (MinIO / S3), used as they are.
 *
 * Pure (the API base is a parameter, so this runs under `npx tsx --test` without the axios module).
 */
export function resolveListingMediaUrl(url: string | null | undefined, apiBase: string): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (url.startsWith("/media/")) return `${apiBase.replace(/\/+$/, "")}${url}`;
  return url;
}

/** Public, stable URL of a published PT physique photo (used where the API gave only an id, e.g. admin "photos to keep"). */
export const ptPhysiquePublicPath = (photoId: string) => `/media/pt-physique/${photoId}`;
export const gymPhotoPublicPath = (photoId: string) => `/media/gym-photos/${photoId}`;
