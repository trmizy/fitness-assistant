/**
 * Listing Management (Phase D2) — the "I am a new client" headers, and exactly which requests carry them.
 *
 * gym-service (legacy-compat.service.ts) reads two headers:
 *  - `X-Gymini-Listing-Flow: <integer >= 2>` — a NEW client (one that knows the amenity step). Without it the server treats
 *    the request as an old app: it accepts a branch / application with no amenities (while LISTING_LEGACY_CLIENT_COMPAT is on),
 *    records a legacy-compat event, and `GET /owner/application` does not list AMENITIES in `missing`.
 *  - `X-Gymini-Client: web/<version>` — measured only (client_header), never decides behaviour.
 *
 * The axios instance sets no header globally (only Content-Type + the token). The headers are attached by a request
 * interceptor (services/listingFlowHeaders.ts) to the routes the server treats differently for a new client — the application
 * wizard and the branch create / draft / submit routes — and to nothing else, so every other request stays exactly as before.
 *
 * Pure: no axios, no browser API — runs under `npx tsx --test`.
 */
export const LISTING_FLOW_HEADER = "X-Gymini-Listing-Flow";
export const CLIENT_HEADER = "X-Gymini-Client";
/** The first flow version of a new client (the amenity step). */
export const LISTING_FLOW_VERSION = "2";
/** Mirrors package.json `version` (the app has no shared constant; HelpAboutSection hard-codes the same string). */
export const WEB_CLIENT_VERSION = "0.0.1";

/** `web/<version>` — what gym-service stores as client_header (max 120 chars server side). */
export function clientHeaderValue(version: string | null | undefined = WEB_CLIENT_VERSION): string {
  const v = String(version ?? "").trim() || "0";
  return `web/${v}`.slice(0, 120);
}

function pathOf(url: string | null | undefined): string {
  const raw = String(url ?? "");
  const noOrigin = raw.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
  // The shared axios instance has baseURL "/api" and passes the relative path; an absolute URL carries the prefix too.
  return noOrigin.split("?")[0].replace(/^\/api(?=\/)/, "").replace(/\/+$/, "") || "/";
}

/**
 * Whether a request is one the server decides differently for a new client:
 *  - every call under /owner/application (the read lists AMENITIES in `missing` only for a new client; the writes record the flow),
 *  - POST /owner/gyms (the quick-create dialog of MyGymsPage, which has an amenity step — 422 AMENITIES_REQUIRED without one),
 *  - POST /owner/gyms/draft, PATCH /owner/gyms/:id/draft, POST /owner/gyms/:id/submit (the add-branch wizard).
 */
export function isListingFlowRequest(method: string | null | undefined, url: string | null | undefined): boolean {
  const m = String(method ?? "get").toUpperCase();
  const path = pathOf(url);
  if (/^\/owner\/application(\/|$)/.test(path)) return true;
  if (m === "POST" && (path === "/owner/gyms" || path === "/owner/gyms/draft")) return true;
  if (m === "PATCH" && /^\/owner\/gyms\/[^/]+\/draft$/.test(path)) return true;
  if (m === "POST" && /^\/owner\/gyms\/[^/]+\/submit$/.test(path)) return true;
  return false;
}

/** The headers to add, or null when the request is not a listing-flow request. */
export function listingFlowHeaders(
  method: string | null | undefined,
  url: string | null | undefined,
  clientVersion: string | null | undefined = WEB_CLIENT_VERSION,
): Record<string, string> | null {
  if (!isListingFlowRequest(method, url)) return null;
  return { [LISTING_FLOW_HEADER]: LISTING_FLOW_VERSION, [CLIENT_HEADER]: clientHeaderValue(clientVersion) };
}
