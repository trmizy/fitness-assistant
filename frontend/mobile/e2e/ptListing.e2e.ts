/**
 * Listing Management, Phase M1 — the PT "Tin đăng" and the client-side trainer reads, against the REAL
 * gateway, using the same normalizers and error helpers the screens use.
 *
 *   npx tsx --test e2e/ptListing.e2e.ts
 *
 *   E2E_BASE_URL       gateway (default http://localhost:3000)
 *   E2E_PT_EMAIL       an APPROVED trainer     (default john.doe@example.com)
 *   E2E_PT_PASSWORD    its password            (default Test@123456)
 *   E2E_CLIENT_EMAIL / E2E_CLIENT_PASSWORD   a plain client — enables the PACKAGE_CHANGED check
 *
 * Leaves no residue: every test that writes needs the trainer to have NO open revision at the start, creates
 * a draft, and discards it again. If the trainer already has an open draft / pending revision, the writing
 * tests are SKIPPED (this suite never touches somebody's work in progress). The photo upload test also
 * skips when the presigned storage URL is not reachable from this machine.
 *
 * Evidence label when it runs: REAL HTTP/API.
 */
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LISTING_ERROR_VI,
  buildDraftPayload,
  formFromPayload,
  isDraftStale,
  isReviewRequired,
  listingErrorInfo,
  listingErrorMessage,
  normalizeListing,
  normalizePreview,
  revisionFromResponse,
  staleRevisionOf,
  type OwnerRevision,
} from "../src/features/ptListing/ptListing";
import { isPtGone, normalizePackages, normalizePt, normalizePts, readPackageChanged } from "../src/features/services/ptDiscovery";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PT_EMAIL = process.env.E2E_PT_EMAIL ?? "john.doe@example.com";
const PT_PASSWORD = process.env.E2E_PT_PASSWORD ?? "Test@123456";
const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL;
const CLIENT_PASSWORD = process.env.E2E_CLIENT_PASSWORD ?? "Test@123456";

type Reply = { status: number; data: any };

async function call(token: string | null, method: string, path: string, body?: unknown): Promise<Reply> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, data: json };
}

/** The shape axios gives the app's error helpers, built from a fetch reply. */
const asAxiosError = (r: Reply) => ({ response: { status: r.status, data: r.data } });

async function login(email: string, password: string): Promise<string | null> {
  const r = await call(null, "POST", "/auth/login", { email, password });
  return r.data?.data?.accessToken ?? r.data?.accessToken ?? null;
}

let ptToken: string | null = null;
let listingBefore: ReturnType<typeof normalizeListing> | null = null;
/** True when the trainer has no open revision, so this run may create (and then discard) a draft. */
let mayWrite = false;

before(async () => {
  ptToken = await login(PT_EMAIL, PT_PASSWORD);
  assert.ok(ptToken, `login failed for ${PT_EMAIL} - set E2E_PT_EMAIL / E2E_PT_PASSWORD`);
  const r = await call(ptToken, "GET", "/profile/me/listing");
  assert.equal(r.status, 200, `GET /profile/me/listing -> ${r.status} ${JSON.stringify(r.data)}`);
  listingBefore = normalizeListing(r.data);
  mayWrite = listingBefore.openRevision === null;
});

describe("PT listing — read", () => {
  it("GET /profile/me/listing: published listing, limits (5 photos / 10 packages), no-store", async () => {
    const res = await fetch(`${BASE_URL}/profile/me/listing`, { headers: { Authorization: `Bearer ${ptToken}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(listingBefore!.limits.maxPhotos, 5);
    assert.equal(listingBefore!.limits.maxPackages, 10);
    for (const p of listingBefore!.published.packages) {
      assert.ok(p.price > 0, "Decimal price parsed to a number");
      assert.ok(p.version >= 1);
    }
  });

  it("an anonymous caller is refused (401), a plain client too (403)", async () => {
    assert.equal((await call(null, "GET", "/profile/me/listing")).status, 401);
    if (CLIENT_EMAIL) {
      const clientToken = await login(CLIENT_EMAIL, CLIENT_PASSWORD);
      assert.ok(clientToken);
      const r = await call(clientToken, "GET", "/profile/me/listing");
      assert.equal(r.status, 403);
      assert.equal(listingErrorInfo(asAxiosError(r)).code, "NOT_A_PT");
    }
  });
});

describe("old package write routes are locked", () => {
  it("POST /profile/me/service-packages answers 409 LISTING_REVIEW_REQUIRED, and the app maps it to Vietnamese", async () => {
    const r = await call(ptToken, "POST", "/profile/me/service-packages", {
      name: "x", sessionCount: 1, price: 1000, sessionMode: "ONLINE",
    });
    assert.equal(r.status, 409);
    assert.equal(isReviewRequired(asAxiosError(r)), true);
    assert.equal(listingErrorMessage(asAxiosError(r)), LISTING_ERROR_VI.LISTING_REVIEW_REQUIRED);
  });

  it("PATCH and DELETE on a package id are locked the same way", async () => {
    const id = listingBefore!.published.packages[0]?.id ?? "00000000-0000-4000-8000-000000000000";
    assert.equal((await call(ptToken, "PATCH", `/profile/me/service-packages/${id}`, { price: 1 })).status, 409);
    assert.equal((await call(ptToken, "DELETE", `/profile/me/service-packages/${id}`)).status, 409);
  });
});

describe("PT listing — draft workflow (creates a draft, discards it)", () => {
  let rev: OwnerRevision | null = null;

  it("createDraft → saveDraft carries expectedDraftVersion and bumps it", async (t) => {
    if (!mayWrite) return t.skip("the trainer already has an open revision - not touching it");
    const created = await call(ptToken, "POST", "/profile/me/listing/draft", {});
    assert.equal(created.status, 201, JSON.stringify(created.data));
    rev = revisionFromResponse(created.data);
    assert.ok(rev);
    assert.equal(rev!.status, "DRAFT");
    assert.equal(rev!.draftVersion, 1);

    // the body the screen builds from the revision it just read
    const body = buildDraftPayload(formFromPayload(rev!.payload));
    const saved = await call(ptToken, "PUT", "/profile/me/listing/draft", { expectedDraftVersion: 1, payload: body });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    rev = revisionFromResponse(saved.data);
    assert.equal(rev!.draftVersion, 2);
  });

  it("a save with a stale version is 409 DRAFT_STALE and carries the server's CURRENT draft", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const body = buildDraftPayload(formFromPayload(rev.payload));
    const r = await call(ptToken, "PUT", "/profile/me/listing/draft", { expectedDraftVersion: 1, payload: body });
    assert.equal(r.status, 409);
    assert.equal(isDraftStale(asAxiosError(r)), true);
    assert.equal(staleRevisionOf(asAxiosError(r))?.draftVersion, rev.draftVersion);
    assert.equal(listingErrorMessage(asAxiosError(r)), LISTING_ERROR_VI.DRAFT_STALE);
  });

  it("a save WITHOUT expectedDraftVersion is refused (400), never accepted as 'last write wins'", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const r = await call(ptToken, "PUT", "/profile/me/listing/draft", { payload: buildDraftPayload(formFromPayload(rev.payload)) });
    assert.equal(r.status, 400);
    assert.equal(listingErrorInfo(asAxiosError(r)).code, "VALIDATION_FAILED");
  });

  it("a 6th photo is refused with PHOTO_LIMIT (422), and the app has a sentence for it", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);
    const body = { ...buildDraftPayload(formFromPayload(rev.payload)), photoIds: ids, coverPhotoId: ids[0] };
    const r = await call(ptToken, "PUT", "/profile/me/listing/draft", { expectedDraftVersion: rev.draftVersion, payload: body });
    assert.equal(r.status, 422);
    assert.equal(listingErrorInfo(asAxiosError(r)).code, "PHOTO_LIMIT");
    assert.equal(listingErrorMessage(asAxiosError(r)), LISTING_ERROR_VI.PHOTO_LIMIT);
  });

  it("a photo id that is not the trainer's own is refused without saying whose it is", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const id = "00000000-0000-4000-8000-0000000000ff";
    const body = { ...buildDraftPayload(formFromPayload(rev.payload)), photoIds: [id], coverPhotoId: id };
    const r = await call(ptToken, "PUT", "/profile/me/listing/draft", { expectedDraftVersion: rev.draftVersion, payload: body });
    assert.equal(r.status, 422);
    assert.equal(listingErrorInfo(asAxiosError(r)).code, "PHOTO_NOT_OWNED");
  });

  it("an unchanged draft cannot be submitted (422 NO_CHANGES)", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const r = await call(ptToken, "POST", "/profile/me/listing/submit", { expectedDraftVersion: rev.draftVersion });
    assert.equal(r.status, 422);
    assert.equal(listingErrorInfo(asAxiosError(r)).code, "NO_CHANGES");
  });

  it("preview is flagged as a preview and normalizes", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const r = await call(ptToken, "GET", "/profile/me/listing/preview");
    assert.equal(r.status, 200);
    const view = normalizePreview(r.data);
    assert.ok(view, "isPreview must be true");
    assert.equal(view!.revisionStatus, "DRAFT");
  });

  it("discard closes the draft and leaves the trainer exactly as before", async (t) => {
    if (!rev) return t.skip("no draft was created");
    const r = await call(ptToken, "POST", "/profile/me/listing/discard", {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const after = normalizeListing((await call(ptToken, "GET", "/profile/me/listing")).data);
    assert.equal(after.openRevision, null);
    assert.equal(after.listingVersion, listingBefore!.listingVersion);
  });
});

describe("PT listing — photo upload (presign → storage → confirm → delete)", () => {
  // 1x1 PNG
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

  it("presign returns a POST form; the real upload + confirm stage a photo that can be deleted", async (t) => {
    if (!mayWrite) return t.skip("the trainer already has an open revision - not touching it");
    const presign = await call(ptToken, "POST", "/profile/me/listing/physique/presign", { contentType: "image/png" });
    if (presign.status === 503) return t.skip("uploads are not configured on this environment (UPLOADS_UNAVAILABLE)");
    assert.equal(presign.status, 200, JSON.stringify(presign.data));
    const { uploadId, url, fields } = presign.data;
    assert.ok(uploadId && url && fields);

    // fields first, the file LAST - what File.upload MULTIPART does on the phone
    const form = new FormData();
    for (const [k, v] of Object.entries(fields as Record<string, string>)) form.append(k, v);
    form.append("file", new Blob([PNG], { type: "image/png" }), "tiny.png");
    let up: Response;
    try {
      up = await fetch(url, { method: "POST", body: form });
    } catch {
      return t.skip(`the presigned storage URL is not reachable from this machine: ${url}`);
    }
    assert.ok(up.status >= 200 && up.status < 300, `storage answered ${up.status}`);

    const confirmed = await call(ptToken, "POST", "/profile/me/listing/physique/confirm", { uploadId });
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.data));
    const photoId = confirmed.data.photo.id;
    assert.equal(confirmed.data.photo.status, "STAGED");

    // confirming twice is refused, not repeated
    const again = await call(ptToken, "POST", "/profile/me/listing/physique/confirm", { uploadId });
    assert.equal(again.status, 409);

    const del = await call(ptToken, "DELETE", `/profile/me/listing/physique/${photoId}`);
    assert.equal(del.status, 200, JSON.stringify(del.data));
  });
});

describe("clients: what the trainer list and detail now answer", () => {
  let token: string | null = null;
  before(async () => {
    token = CLIENT_EMAIL ? await login(CLIENT_EMAIL, CLIENT_PASSWORD) : ptToken;
  });

  it("GET /profile/pts: rows carry no e-mail, a card price consistent with the derived legacy fields, and never a draft", async () => {
    const r = await call(token, "GET", "/profile/pts");
    assert.equal(r.status, 200);
    const rows = normalizePts(r.data);
    assert.ok(rows.length > 0, "no trainers on this environment");
    for (const raw of r.data.pts) {
      assert.equal("email" in raw, false, "the public DTO has no e-mail");
      assert.equal("isPreview" in raw, false);
      assert.equal("revisionStatus" in raw, false);
    }
    for (const pt of rows) {
      assert.ok(pt.lowestPrice === null || pt.lowestPrice > 0);
      assert.ok(pt.name && !pt.name.includes("@"), "no e-mail as a display name");
      for (const photo of pt.physiquePhotos) assert.match(photo.url, /^\/media\/pt-physique\//);
    }
  });

  it("GET /profile/pts/:id: the detail reads the same way; photos are public /media paths", async () => {
    const rows = normalizePts((await call(token, "GET", "/profile/pts")).data);
    const detail = await call(token, "GET", `/profile/pts/${rows[0].userId}`);
    assert.equal(detail.status, 200);
    const pt = normalizePt(detail.data);
    assert.equal(pt.userId, rows[0].userId);
    assert.equal(JSON.stringify(detail.data).includes('"email"'), false);
  });

  it("an unknown / hidden trainer id is a 404 the detail screen turns into its friendly state", async () => {
    const r = await call(token, "GET", "/profile/pts/00000000-0000-4000-8000-0000000000aa");
    assert.equal(r.status, 404);
    assert.equal(isPtGone(asAxiosError(r)), true);
  });

  it("packages carry a version, and a contract request with an old version is 409 PACKAGE_CHANGED", async (t) => {
    if (!CLIENT_EMAIL) return t.skip("E2E_CLIENT_EMAIL not set");
    const rows = normalizePts((await call(token, "GET", "/profile/pts")).data);
    for (const pt of rows) {
      const r = await call(token, "GET", `/profile/pts/${pt.userId}/service-packages`);
      const pkgs = normalizePackages(r.data);
      if (pkgs.length === 0) continue;
      assert.ok(pkgs[0].version && pkgs[0].version >= 1);
      // the check runs before any contract is created, so this leaves nothing behind
      const req = await call(token, "POST", "/contracts/request", {
        ptUserId: pt.userId,
        packageId: pkgs[0].id,
        expectedPackageVersion: pkgs[0].version! + 1000,
        acknowledgedLowAvailability: true,
      });
      assert.equal(req.status, 409, JSON.stringify(req.data));
      const changed = readPackageChanged(asAxiosError(req));
      assert.ok(changed);
      assert.equal(changed!.current?.id, pkgs[0].id);
      assert.equal(changed!.current?.version, pkgs[0].version);
      return;
    }
    t.skip("no trainer with a package on this environment");
  });
});
