/**
 * Listing Management (M2) — the "I am a new client" headers, and exactly which requests carry them.
 *
 * gym-service (legacy-compat.service.ts) reads two headers:
 *  - `X-Gymini-Listing-Flow: <integer >= 2>` — a NEW client (one that knows the amenity step). Without it the
 *    server treats the request as an old APK: it accepts a branch/application with no amenities, and
 *    `GET /owner/application` does not list AMENITIES in `missing`.
 *  - `X-Gymini-Client: mobile/<expo version>/<build>` — measured only, never decides behaviour.
 *
 * The header only matters on the routes the server lists as compat routes (COMPAT_ROUTES) plus the application
 * read, so it is attached to THOSE requests by a request interceptor (see the gymListingService region of
 * api.ts) rather than globally: every other request stays exactly as before.
 *
 * Pure: no React Native, no Expo import — runs under `tsx --test`.
 */
export const LISTING_FLOW_HEADER = "X-Gymini-Listing-Flow";
export const CLIENT_HEADER = "X-Gymini-Client";
/** The first flow version of a new client (the amenity step). */
export const LISTING_FLOW_VERSION = "2";

/** `mobile/<version>/<build>` — what gym-service stores as client_header (max 120 chars server side). */
export function clientHeaderValue(version: string | null | undefined, build: string | number | null | undefined): string {
  const v = String(version ?? "").trim() || "0";
  const b = String(build ?? "").trim() || "0";
  return `mobile/${v}/${b}`.slice(0, 120);
}

function pathOf(url: string | null | undefined): string {
  const raw = String(url ?? "");
  const noOrigin = raw.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
  return noOrigin.split("?")[0].replace(/\/+$/, "") || "/";
}

/**
 * Whether a request is one the server decides differently for a new client:
 *  - every call under /owner/application (the read lists AMENITIES in `missing` only for a new client;
 *    the writes record the flow version),
 *  - POST /owner/gyms (quick create — 422 AMENITIES_REQUIRED without amenities),
 *  - POST /owner/gyms/draft, PATCH /owner/gyms/:id/draft, POST /owner/gyms/:id/submit (the wizard).
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
  client: { version: string | null | undefined; build: string | number | null | undefined },
): Record<string, string> | null {
  if (!isListingFlowRequest(method, url)) return null;
  return { [LISTING_FLOW_HEADER]: LISTING_FLOW_VERSION, [CLIENT_HEADER]: clientHeaderValue(client.version, client.build) };
}
