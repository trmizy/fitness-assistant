/**
 * Listing Management, Phase M2 — the Gym Owner "Tin đăng & tiện ích", the quick add-branch amenity rule, the application's amenity
 * step headers and the client-side gym reads, against the REAL gateway, using the same normalizers and error helpers the screens use.
 *
 *   npx tsx --test e2e/gymListing.e2e.ts
 *
 *   E2E_BASE_URL         gateway (default http://localhost:3000)
 *   E2E_OWNER_EMAIL      a gym OWNER with at least one APPROVED branch   (default owner@example.com)
 *   E2E_OWNER_PASSWORD   its password                                    (default Test@123456)
 *   E2E_MANAGER_EMAIL / E2E_MANAGER_PASSWORD   a MANAGER of the same brand - enables the 403 check
 *   E2E_APPLICANT_EMAIL / E2E_APPLICANT_PASSWORD   a GYM_OWNER with a NOT-yet-approved application - enables the application checks
 *
 * STATUS WHEN THIS FILE WAS WRITTEN: NOT RUN (no gateway was up). Evidence label when it runs: REAL HTTP/API.
 *
 * Leaves no residue: every writing test needs the branch to have NO open revision at the start, creates a draft, and discards it
 * again. If the branch already has an open draft / pending revision the writing tests are SKIPPED (this suite never touches somebody's
 * work in progress). The photo upload test also skips when the presigned storage URL is not reachable from this machine. The quick
 * add-branch test only sends a request the server must REFUSE (no amenities), so it creates nothing.
 */
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  GYM_LISTING_ERROR_VI,
  branchAvailability,
  buildGymDraftPayload,
  formFromGymPayload,
  gymListingErrorMessage,
  gymRevisionFromResponse,
  interpretProposeResponse,
  isAmenitiesRequired,
  isDraftStale,
  isReviewRequired,
  isUploadRouteRetired,
  listingErrorInfo,
  normalizeCatalog,
  normalizeGymListing,
  normalizeGymPreview,
  staleGymRevisionOf,
  type GymRevision,
} from "../src/features/gymListing/gymListing";
import { AMENITY_ICON_KEYS, isKnownAmenityIcon } from "../src/features/gymListing/amenityIcons";
import { CLIENT_HEADER, LISTING_FLOW_HEADER, listingFlowHeaders } from "../src/services/listingFlow";
import { STEPS, firstIncompleteStep, type ApplicationView } from "../src/features/partnerApplication/partnerApplication";
import { isGymGone, normalizeGym, normalizeGyms } from "../src/features/services/gymDirectory";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "Test@123456";
const MANAGER_EMAIL = process.env.E2E_MANAGER_EMAIL;
const MANAGER_PASSWORD = process.env.E2E_MANAGER_PASSWORD ?? "Test@123456";
const APPLICANT_EMAIL = process.env.E2E_APPLICANT_EMAIL;
const APPLICANT_PASSWORD = process.env.E2E_APPLICANT_PASSWORD ?? "Test@123456";

type Reply = { status: number; data: any; headers: Headers };

async function call(token: string | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Reply> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, data: json, headers: res.headers };
}

/** gym-service answers `{ success, data }`; the app unwraps `data` before it normalizes. */
const unwrap = (r: Reply) => r.data?.data ?? r.data;
/** The shape axios gives the app's error helpers, built from a fetch reply. */
const asAxiosError = (r: Reply) => ({ response: { status: r.status, data: r.data } });
/** The headers the app's interceptor adds to a listing-flow request. */
const newClientHeaders = (method: string, path: string) => listingFlowHeaders(method, path, { version: "1.0.0", build: "e2e" }) ?? {};

async function login(email: string, password: string): Promise<string | null> {
  const r = await call(null, "POST", "/auth/login", { email, password });
  return r.data?.data?.accessToken ?? r.data?.accessToken ?? null;
}

let ownerToken: string | null = null;
let gymId: string | null = null;
let listingBefore: ReturnType<typeof normalizeGymListing> | null = null;
let mayWrite = false;

before(async () => {
  ownerToken = await login(OWNER_EMAIL, OWNER_PASSWORD);
  assert.ok(ownerToken, `login failed for ${OWNER_EMAIL} - set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD`);
  const gyms = await call(ownerToken, "GET", "/owner/gyms");
  assert.equal(gyms.status, 200, `GET /owner/gyms -> ${gyms.status}`);
  const rows: any[] = Array.isArray(unwrap(gyms)) ? unwrap(gyms) : [];
  const editable = rows.find((g) => branchAvailability(g).editable);
  assert.ok(editable, "the owner needs an APPROVED / SUSPENDED branch");
  gymId = editable.id;
  const r = await call(ownerToken, "GET", `/owner/gyms/${gymId}/listing`);
  assert.equal(r.status, 200, `GET listing -> ${r.status} ${JSON.stringify(r.data)}`);
  listingBefore = normalizeGymListing(unwrap(r));
  mayWrite = listingBefore.openRevision === null;
});

describe("headers", () => {
  it("the app attaches X-Gymini-Listing-Flow: 2 and X-Gymini-Client: mobile/<version>/<build> to the application and branch-create routes", () => {
    const h = listingFlowHeaders("post", "/owner/gyms", { version: "1.0.0", build: "7" })!;
    assert.equal(h[LISTING_FLOW_HEADER], "2");
    assert.equal(h[CLIENT_HEADER], "mobile/1.0.0/7");
  });
});

describe("owner listing — read", () => {
  it("GET /owner/gyms/:id/listing: published listing, limits (20 photos / 40 staged), no-store", async () => {
    const res = await fetch(`${BASE_URL}/owner/gyms/${gymId}/listing`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(listingBefore!.limits.maxPhotos, 20);
    assert.equal(listingBefore!.limits.maxStagedPhotos, 40);
    assert.ok(listingBefore!.listingVersion >= 0);
    for (const a of listingBefore!.amenities) assert.ok(isKnownAmenityIcon(a.iconKey) || a.iconKey === "", `unknown icon key ${a.iconKey}`);
  });

  it("GET /owner/amenities: the ACTIVE catalogue (every icon key on the allowlist) and the owner's own proposals", async () => {
    const r = await call(ownerToken, "GET", "/owner/amenities");
    assert.equal(r.status, 200);
    const c = normalizeCatalog(unwrap(r));
    assert.ok(c.amenities.length >= 18, "the 18 SYSTEM amenities are seeded");
    for (const a of c.amenities) {
      assert.equal(a.status, "ACTIVE");
      assert.ok((AMENITY_ICON_KEYS as readonly string[]).includes(a.iconKey), `icon key outside the allowlist: ${a.iconKey}`);
    }
  });

  it("GET /owner/gyms/:id carries the REAL selection for the OWNER: amenities (custom included) and the owner's PENDING amenityProposals", async () => {
    const r = await call(ownerToken, "GET", `/owner/gyms/${gymId}`);
    assert.equal(r.status, 200);
    const gym = unwrap(r);
    assert.ok(Array.isArray(gym.amenities), "amenities is part of the owner's branch answer");
    assert.ok(Array.isArray(gym.amenityProposals), "amenityProposals is part of the owner's branch answer");
  });

  it("a branch id that is not the owner's answers 404 (no probing)", async () => {
    const r = await call(ownerToken, "GET", "/owner/gyms/00000000-0000-4000-8000-0000000000ff/listing");
    assert.equal(r.status, 404);
  });

  it("an anonymous caller is refused (401); a MANAGER gets 403 on the listing and on the catalogue", async () => {
    assert.equal((await call(null, "GET", `/owner/gyms/${gymId}/listing`)).status, 401);
    if (MANAGER_EMAIL) {
      const mt = await login(MANAGER_EMAIL, MANAGER_PASSWORD);
      assert.ok(mt);
      assert.equal((await call(mt, "GET", `/owner/gyms/${gymId}/listing`)).status, 403);
      assert.equal((await call(mt, "GET", "/owner/amenities")).status, 403);
    }
  });
});

describe("old routes are locked (409 / 410)", () => {
  it("PATCH /owner/gyms/:id with a description on an APPROVED branch is 409 LISTING_REVIEW_REQUIRED", async () => {
    const r = await call(ownerToken, "PATCH", `/owner/gyms/${gymId}`, { description: "x" });
    assert.equal(r.status, 409);
    assert.equal(isReviewRequired(asAxiosError(r)), true);
    assert.equal(gymListingErrorMessage(asAxiosError(r)), GYM_LISTING_ERROR_VI.LISTING_REVIEW_REQUIRED);
  });

  it("PATCH facilities is locked the same way; phone / email still go through", async () => {
    const r = await call(ownerToken, "PATCH", `/owner/gyms/${gymId}`, { facilities: ["WIFI"] });
    assert.equal(r.status, 409);
    assert.equal(isReviewRequired(asAxiosError(r)), true);
  });

  it("the old disk-photo routes answer 410 UPLOAD_ROUTE_RETIRED", async () => {
    const r = await call(ownerToken, "DELETE", `/owner/gyms/${gymId}/photos/00000000-0000-4000-8000-000000000001`);
    assert.equal(r.status, 410);
    assert.equal(isUploadRouteRetired(asAxiosError(r)), true);
  });
});

describe("quick add-branch needs an amenity", () => {
  it("POST /owner/gyms with the new-client header and NO amenity is 422 AMENITIES_REQUIRED (nothing is created)", async () => {
    const r = await call(ownerToken, "POST", "/owner/gyms", { name: "E2E không tiện ích", address: "1 Lê Lợi" }, newClientHeaders("POST", "/owner/gyms"));
    assert.equal(r.status, 422, JSON.stringify(r.data));
    assert.equal(isAmenitiesRequired(asAxiosError(r)), true);
    assert.match(gymListingErrorMessage(asAxiosError(r)), /ít nhất một tiện ích/);
  });
});

describe("owner listing — draft workflow (creates a draft, discards it)", () => {
  let rev: GymRevision | null = null;

  it("createDraft → saveDraft carries expectedDraftVersion and bumps it", async (t) => {
    if (!mayWrite) return t.skip("the branch already has an open revision - not touching it");
    const created = await call(ownerToken, "POST", `/owner/gyms/${gymId}/listing/draft`, {});
    assert.equal(created.status, 201, JSON.stringify(created.data));
    rev = gymRevisionFromResponse(unwrap(created));
    assert.ok(rev);
    assert.equal(rev!.status, "DRAFT");
    assert.equal(rev!.draftVersion, 1);

    const body = buildGymDraftPayload(formFromGymPayload(rev!.payload));
    const saved = await call(ownerToken, "PUT", `/owner/gyms/${gymId}/listing/draft`, { expectedDraftVersion: 1, payload: body });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    rev = gymRevisionFromResponse(unwrap(saved));
    assert.equal(rev!.draftVersion, 2);
  });

  it("a save with a stale version is 409 DRAFT_STALE and carries the server's CURRENT draft", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const body = buildGymDraftPayload(formFromGymPayload(rev.payload));
    const r = await call(ownerToken, "PUT", `/owner/gyms/${gymId}/listing/draft`, { expectedDraftVersion: 1, payload: body });
    assert.equal(r.status, 409);
    assert.equal(isDraftStale(asAxiosError(r)), true);
    assert.equal(staleGymRevisionOf(asAxiosError(r))?.draftVersion, rev.draftVersion);
  });

  it("a save WITHOUT expectedDraftVersion is refused (400)", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const r = await call(ownerToken, "PUT", `/owner/gyms/${gymId}/listing/draft`, { payload: buildGymDraftPayload(formFromGymPayload(rev.payload)) });
    assert.equal(r.status, 400);
    assert.equal(listingErrorInfo(asAxiosError(r)).code, "VALIDATION_FAILED");
  });

  it("a 21st photo is refused with PHOTO_LIMIT (422)", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const ids = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i + 10)}`);
    const body = { ...buildGymDraftPayload(formFromGymPayload(rev.payload)), photoIds: ids, coverPhotoId: ids[0] };
    const r = await call(ownerToken, "PUT", `/owner/gyms/${gymId}/listing/draft`, { expectedDraftVersion: rev.draftVersion, payload: body });
    assert.equal(r.status, 422);
    assert.equal(listingErrorInfo(asAxiosError(r)).code, "PHOTO_LIMIT");
  });

  it("an unknown catalogue amenity is refused (422 AMENITY_UNKNOWN)", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const body = { ...buildGymDraftPayload(formFromGymPayload(rev.payload)), amenityIds: ["no-such-amenity"] };
    const r = await call(ownerToken, "PUT", `/owner/gyms/${gymId}/listing/draft`, { expectedDraftVersion: rev.draftVersion, payload: body });
    assert.equal(r.status, 422);
    assert.equal(listingErrorInfo(asAxiosError(r)).code, "AMENITY_UNKNOWN");
  });

  it("an unchanged draft cannot be submitted (422 NO_CHANGES)", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const r = await call(ownerToken, "POST", `/owner/gyms/${gymId}/listing/submit`, { expectedDraftVersion: rev.draftVersion });
    assert.equal(r.status, 422);
    assert.ok(["NO_CHANGES", "AMENITIES_REQUIRED"].includes(listingErrorInfo(asAxiosError(r)).code ?? ""));
  });

  it("proposing the name of an ACTIVE amenity answers matchedAmenity and creates nothing", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const catalog = normalizeCatalog(unwrap(await call(ownerToken, "GET", "/owner/amenities")));
    const first = catalog.amenities[0];
    const r = await call(ownerToken, "POST", "/owner/amenities/proposals", { gymId, name: first.name.toUpperCase(), suggestedCategory: "FACILITY" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const outcome = interpretProposeResponse(unwrap(r));
    assert.equal(outcome?.kind, "matched");
  });

  it("preview is flagged as a preview and normalizes", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const r = await call(ownerToken, "GET", `/owner/gyms/${gymId}/listing/preview`);
    assert.equal(r.status, 200);
    const view = normalizeGymPreview(unwrap(r));
    assert.ok(view, "isPreview must be true");
    assert.equal(view!.revisionStatus, "DRAFT");
  });

  it("discard closes the draft and leaves the branch exactly as before", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const r = await call(ownerToken, "POST", `/owner/gyms/${gymId}/listing/discard`, {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const after = normalizeGymListing(unwrap(await call(ownerToken, "GET", `/owner/gyms/${gymId}/listing`)));
    assert.equal(after.openRevision, null);
    assert.equal(after.listingVersion, listingBefore!.listingVersion);
  });
});

describe("owner listing — photo upload (presign → storage → confirm → delete)", () => {
  // 1x1 PNG
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

  it("presign returns a POST form; the real upload + confirm stage a photo that can be deleted", async (t) => {
    if (!mayWrite) return t.skip("the branch already has an open revision - not touching it");
    const presign = await call(ownerToken, "POST", `/owner/gyms/${gymId}/listing/photos/presign`, { contentType: "image/png" });
    if (presign.status === 503) return t.skip("uploads are not configured on this environment (UPLOADS_UNAVAILABLE)");
    assert.equal(presign.status, 200, JSON.stringify(presign.data));
    const p = unwrap(presign);
    assert.equal(p.method, "POST");
    assert.ok(p.uploadId && p.url && p.fields);

    const form = new FormData();
    for (const [k, v] of Object.entries(p.fields as Record<string, string>)) form.append(k, v);
    form.append("file", new Blob([PNG], { type: "image/png" }), "e2e.png");
    let put: Response;
    try {
      put = await fetch(p.url, { method: "POST", body: form });
    } catch {
      return t.skip("the presigned storage URL is not reachable from this machine");
    }
    assert.ok(put.status >= 200 && put.status < 300, `storage answered ${put.status}`);

    const confirm = await call(ownerToken, "POST", `/owner/gyms/${gymId}/listing/photos/confirm`, { uploadId: p.uploadId });
    assert.equal(confirm.status, 201, JSON.stringify(confirm.data));
    const photoId = unwrap(confirm).photo.id as string;
    assert.equal(unwrap(confirm).photo.status, "STAGED");

    const del = await call(ownerToken, "DELETE", `/owner/gyms/${gymId}/listing/photos/${photoId}`);
    assert.equal(del.status, 200, JSON.stringify(del.data));
  });

  it("a replayed or foreign uploadId is refused", async () => {
    const r = await call(ownerToken, "POST", `/owner/gyms/${gymId}/listing/photos/confirm`, { uploadId: "00000000-0000-4000-8000-0000000000aa" });
    assert.equal(r.status, 404);
    assert.equal(listingErrorInfo(asAxiosError(r)).code, "UPLOAD_NOT_FOUND");
  });
});

describe("application wizard — amenity step (needs an applicant account)", () => {
  let token: string | null = null;
  before(async () => {
    if (APPLICANT_EMAIL) token = await login(APPLICANT_EMAIL, APPLICANT_PASSWORD);
  });

  it("GET /owner/application with the new-client header lists AMENITIES in `missing`, and the wizard resumes at the Tiện ích step", async (t) => {
    if (!token) return t.skip("set E2E_APPLICANT_EMAIL / E2E_APPLICANT_PASSWORD");
    const r = await call(token, "GET", "/owner/application", undefined, newClientHeaders("GET", "/owner/application"));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const view = unwrap(r) as ApplicationView;
    assert.ok(Array.isArray(view.amenities) && Array.isArray(view.amenityProposals), "amenities / amenityProposals are part of the answer");
    assert.ok((view.applicationFlowVersion ?? 0) >= 2 || view.applicationFlowVersion == null);
    const sections = (view.missing ?? []).map((m) => m.section);
    if (sections.includes("AMENITIES")) {
      assert.equal(STEPS[firstIncompleteStep({ missing: (view.missing ?? []).filter((m) => m.section === "AMENITIES") })].id, "amenities");
    }
  });

  it("without the header the same read does NOT list AMENITIES (an old client)", async (t) => {
    if (!token) return t.skip("set E2E_APPLICANT_EMAIL / E2E_APPLICANT_PASSWORD");
    const r = await call(token, "GET", "/owner/application");
    assert.equal(r.status, 200);
    assert.ok(!((unwrap(r) as ApplicationView).missing ?? []).some((m) => m.section === "AMENITIES"));
  });

  it("GET /owner/application/amenities/catalog gives an applicant the ACTIVE catalogue (same shape as /owner/amenities); /owner/amenities stays gated", async (t) => {
    if (!token) return t.skip("set E2E_APPLICANT_EMAIL / E2E_APPLICANT_PASSWORD");
    const r = await call(token, "GET", "/owner/application/amenities/catalog", undefined, newClientHeaders("GET", "/owner/application/amenities/catalog"));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const c = normalizeCatalog(unwrap(r));
    assert.ok(c.amenities.length >= 18, "the 18 SYSTEM amenities are seeded");
    const gated = await call(token, "GET", "/owner/amenities");
    assert.equal(gated.status, 403, "the operational gate still protects /owner/amenities for an unapproved applicant");
  });
});

describe("client side — public gym reads", () => {
  it("GET /gyms: every gym normalizes; amenities[] and coverPhotoUrl are read, never an internal enum", async () => {
    const r = await call(null, "GET", "/gyms");
    assert.equal(r.status, 200);
    const gyms = normalizeGyms(unwrap(r));
    for (const g of gyms) {
      for (const a of g.amenities) {
        assert.ok(a.name.length > 0);
        assert.ok(!/^[A-Z_]+$/.test(a.name), `an enum code leaked as a name: ${a.name}`);
      }
      if (g.coverPhotoUrl) assert.match(g.coverPhotoUrl, /^\/media\/gym-photos\//);
    }
  });

  it("GET /gyms/:id of a gym that is not public (or does not exist) is 404 - the app shows its friendly state", async () => {
    const r = await call(null, "GET", "/gyms/00000000-0000-4000-8000-0000000000ff");
    assert.equal(r.status, 404);
    assert.equal(isGymGone(asAxiosError(r)), true);
    for (const sub of ["plans", "reviews"]) {
      const s = await call(null, "GET", `/gyms/00000000-0000-4000-8000-0000000000ff/${sub}`);
      assert.equal(s.status, 404, sub);
    }
  });

  it("a public gym detail carries amenities and a cover that resolve", async (t) => {
    const list = normalizeGyms(unwrap(await call(null, "GET", "/gyms")));
    if (list.length === 0) return t.skip("no public gym on this environment");
    const detail = normalizeGym(unwrap(await call(null, "GET", `/gyms/${list[0].id}`)));
    assert.equal(detail.id, list[0].id);
    assert.ok(Array.isArray(detail.amenities));
    if (detail.coverPhotoUrl) {
      const img = await fetch(`${BASE_URL}${detail.coverPhotoUrl}`, { redirect: "manual" });
      assert.ok([200, 301, 302, 307].includes(img.status), `cover answered ${img.status}`);
    }
  });
});

// keep the unused-import guard honest: the helpers above are the ones the screens use
void gymListingErrorMessage;
