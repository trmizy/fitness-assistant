// Tier B executors: the real business flows through the gateway, driven by the pure planners. NOT RUN LIVE in Phase G2 (dev stack
// untouched); exercised by __tests__/flows.test.mjs against a fake gateway and in dryRun mode.
//
// Every ensure*() first READS the current state, asks the planner what is still missing and does only that, so a second or third
// run finds nothing to do. No flow deletes or edits anything it did not create (all identities are seed-domain e-mails).
import { readAsset } from "../world/assets.mjs";
import { unwrap, postToStorage, putToStorage } from "./client.mjs";
import * as P from "./payloads.mjs";
import { planBranch, planContract, planListing, planMembership, planPartnerApplication, planProposal, planPtApplication } from "./planners.mjs";

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PDF_MIN = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const FLOW2 = { "X-Gymini-Listing-Flow": "2", "X-Gymini-Client": "seed-marketplace/1" };

const need = (ctx, v, what) => {
  if (v == null) {
    if (ctx.client.dryRun) return `dry-${what}`;
    throw new Error(`missing ${what}`);
  }
  return v;
};
const stat = (ctx, key, n = 1) => {
  ctx.stats[key] = (ctx.stats[key] ?? 0) + n;
};

// ---------------------------------------------------------------------------------------------------------------------------
export async function adminToken(ctx) {
  return ctx.client.login(ctx.admin.email);
}

// ---- catalogue ----------------------------------------------------------------------------------------------------------
export async function ensureCatalogue(ctx) {
  const admin = await adminToken(ctx);
  const list = unwrap(await ctx.client.call("GET", "/admin/amenities", { token: admin, expect: [200] }));
  const amenities = Array.isArray(list) ? list : list?.amenities ?? [];
  ctx.catalog = new Map(amenities.map((a) => [a.slug, a]));
  for (const c of ctx.world.catalogue) {
    if (ctx.catalog.has(c.key) || amenities.some((a) => a.name === c.name)) continue;
    const r = await ctx.client.call("POST", "/admin/amenities", { token: admin, body: P.catalogueCreateBody(c), expect: [200, 201] });
    const a = unwrap(r)?.amenity ?? unwrap(r);
    ctx.catalog.set(c.key, a);
    stat(ctx, "catalogue.created");
  }
  // resolve by display name too (custom rows get a generated slug)
  for (const c of ctx.world.catalogue) {
    const found = (await refreshCatalog(ctx, admin)).find((a) => a.name === c.name);
    if (found) ctx.catalog.set(c.key, found);
  }
}
async function refreshCatalog(ctx, admin) {
  const list = unwrap(await ctx.client.call("GET", "/admin/amenities", { token: admin, expect: [200] }));
  return Array.isArray(list) ? list : list?.amenities ?? [];
}
export const amenityIdFor = (ctx, slugOrKey) => ctx.catalog.get(slugOrKey)?.id ?? (String(slugOrKey).match(/^[A-Z_]+$/) ? `amenity-sys-${String(slugOrKey).toLowerCase().replace(/_/g, "-")}` : null);

// ---- PT --------------------------------------------------------------------------------------------------------------------
async function uploadPtDocument(ctx, token, bytes, contentType) {
  if (process.env.SEED_PT_DOCUMENT_UPLOAD === 'multipart') {
    const form = new FormData();
    form.append('document', new Blob([bytes], { type: contentType }), 'seed-document.png');
    const uploaded = unwrap(await ctx.client.call('POST', '/pt-applications/me/upload', { token, form, expect: [200] }));
    return uploaded?.url;
  }
  const p = unwrap(await ctx.client.call("POST", "/pt-applications/me/upload/presign", { token, body: { contentType }, expect: [200] }));
  await putToStorage(ctx.client, need(ctx, p?.uploadUrl, "uploadUrl"), bytes, contentType);
  const c = unwrap(await ctx.client.call("POST", "/pt-applications/me/upload/confirm", { token, body: { key: need(ctx, p?.key, "key") }, expect: [200] }));
  return c?.url ?? p?.url;
}

export async function ensurePtApplication(ctx, pt) {
  const token = await ctx.client.login(pt.email);
  const me = await ctx.client.call("GET", "/pt-applications/me", { token });
  const observed = me.status === 200 ? unwrap(me)?.status ?? null : null;
  const { actions, conflict } = planPtApplication(observed, pt.app.state);
  if (conflict) {
    stat(ctx, "pt.application.conflict");
    ctx.warnings.push(`${pt.email}: ${conflict}`);
    return;
  }
  let docs = {};
  const admin = await adminToken(ctx);
  const appId = () => unwrap(me)?.id;
  for (const a of actions) {
    if (a === "saveDraft") await ctx.client.call("POST", "/pt-applications/me/draft", { token, body: P.ptDraftBody(pt, docs), expect: [200] });
    else if (a === "uploadDocuments") {
      docs = {
        idCardFrontUrl: await uploadPtDocument(ctx, token, PNG_1x1, "image/png"),
        idCardBackUrl: await uploadPtDocument(ctx, token, PNG_1x1, "image/png"),
        portraitPhotoUrl: await uploadPtDocument(ctx, token, PNG_1x1, "image/png"),
      };
      // the draft must carry the document URLs before it can be submitted
      await ctx.client.call("POST", "/pt-applications/me/draft", { token, body: P.ptDraftBody(pt, docs), expect: [200] });
    } else if (a === "submit") {
      if (!ctx.ptTermsVersion && !ctx.client.dryRun) {
        const terms = unwrap(await ctx.client.call('GET', '/pt-applications/terms', { token, expect: [200] }));
        ctx.ptTermsVersion = terms?.version;
      }
      await ctx.client.call("POST", "/pt-applications/me/submit", { token, body: { termsVersion: ctx.ptTermsVersion }, expect: [200] });
    }
    else if (a.startsWith("review:")) {
      const status = a.slice(7);
      const id = appId() ?? unwrap(await ctx.client.call("GET", "/pt-applications/me", { token }))?.id;
      await ctx.client.call("POST", `/pt-applications/admin/${need(ctx, id, "applicationId")}/review/${status}`, { token: admin, body: P.ptReviewBody[status](pt), expect: [200] });
      if (status === "APPROVED") ctx.client.forget(pt.email); // role changed -> new token
    }
    stat(ctx, `pt.application.${a.split(":")[0]}`);
  }
}

/**
 * Read-only "is this PT's application + listing scenario finished?" check for an account that CANNOT log in (disabled), so it
 * only uses admin endpoints: the application list (status filter) and the admin listing history of the PT. A complete scenario means
 * the application is in the scenario state and, for an APPROVED application, `planListing` has nothing left to do.
 */
export async function ptScenarioComplete(ctx, pt) {
  const admin = await adminToken(ctx);
  const list = unwrap(await ctx.client.call("GET", `/pt-applications/admin?status=${pt.app.state}`, { token: admin, expect: [200] }));
  const apps = Array.isArray(list) ? list : list?.applications ?? [];
  // real admin list rows carry userProfile.userId (no top-level userId)
  if (!apps.some((a) => (a.userProfile?.userId ?? a.userId) === pt.userId && a.status === pt.app.state)) return false;
  if (pt.app.state !== "APPROVED") return true;
  const hist = unwrap(await ctx.client.call("GET", `/admin/listings/pts/${pt.userId}/history`, { token: admin, expect: [200] }));
  const revisions = hist?.revisions ?? [];
  const OPEN = new Set(["DRAFT", "PENDING"]);
  const obs = observeListing({ history: revisions.filter((r) => !OPEN.has(r.status)), openRevision: revisions.find((r) => OPEN.has(r.status)) ?? null });
  return planListing(obs, { kind: pt.listing.kind, rounds: pt.listing.rounds || 0 }).length === 0;
}

/** Admin switch of a seed-domain auth account (PATCH /auth/users/:id/enable|disable - the real admin API). */
export async function setAccountActive(ctx, userId, active) {
  const admin = await adminToken(ctx);
  await ctx.client.call("PATCH", `/auth/users/${userId}/${active ? "enable" : "disable"}`, { token: admin, expect: [200] });
  stat(ctx, active ? "pt.account.reenabled" : "pt.account.disabled");
}

export async function ensurePtFlags(ctx, pt) {
  if (pt.app.state !== "APPROVED") return;
  if (ctx.disabledPts?.has(pt.userId)) return; // disabled AND complete: nothing to do
  if (ctx.incompletePts?.has(pt.userId)) {
    // never lock an account (or restrict it) before its application + listing scenario is finished
    ctx.warnings.push(`${pt.email}: flags skipped, application/listing scenario is not complete`);
    return;
  }
  const admin = await adminToken(ctx);
  const token = await ctx.client.login(pt.email).catch(() => null);
  const profile = pt.flags.notAccepting && token ? unwrap(await ctx.client.call("GET", "/profile/me", { token, expect: [200] }))?.profile : null;
  if (pt.flags.notAccepting && token && profile?.isAcceptingClients !== false) {
    await ctx.client.call("PATCH", "/profile/me/accepting-clients", { token, body: { isAcceptingClients: false, reason: "Lịch kín đến hết tháng sau" }, expect: [200, 404] });
    stat(ctx, "pt.flags.notAccepting");
  }
  if (pt.flags.accountRestricted) {
    const history = unwrap(await ctx.client.call("GET", `/admin/pts/${pt.userId}/restrictions`, { token: admin, expect: [200] }));
    if (history?.restrictions?.some(r => r.scope === "ACCOUNT" && !r.endedAt)) return;
    await ctx.client.call("POST", `/admin/pts/${pt.userId}/suspend`, { token: admin, body: P.suspendPtBody("COMPLAINT_REVIEW", "Có nhiều phản hồi về việc huấn luyện viên đến muộn. Tạm đình chỉ để rà soát.", "Tài khoản đang được rà soát."), expect: [200, 409] });
    stat(ctx, "pt.flags.accountRestricted");
  }
  if (pt.flags.suspended) {
    await setAccountActive(ctx, pt.userId, false);
    stat(ctx, "pt.flags.suspended");
  }
}

async function uploadPhoto(ctx, token, base, file) {
  const target = unwrap(await ctx.client.call("POST", `${base}/presign`, { token, body: { contentType: "image/webp" }, headers: FLOW2, expect: [200, 201] }));
  await postToStorage(ctx.client, need(ctx, target, "presign"), readAsset(file), "image/webp");
  const c = unwrap(await ctx.client.call("POST", `${base}/confirm`, { token, body: { uploadId: need(ctx, target?.uploadId, "uploadId") }, headers: FLOW2, expect: [200, 201] }));
  return c?.photo?.id ?? c?.id ?? `dry-photo-${file.id}`;
}

/** Observed listing state from GET <owner>/listing, in the shape planListing expects. */
export function observeListing(res) {
  const history = res?.history ?? [];
  const closed = {};
  for (const h of history) {
    const key = h.status === "APPROVED" && h.source === "ADMIN_DIRECT" ? "APPROVED_ADMIN" : h.status;
    closed[key] = (closed[key] ?? 0) + 1;
  }
  return { approvedByOwner: history.filter((h) => h.status === "APPROVED" && h.source !== "ADMIN_DIRECT").length, open: res?.openRevision?.status ?? null, closed, openRevision: res?.openRevision ?? null };
}

/** Subset of `items` for round r of R (monotone growth, last round = everything). */
export const roundSlice = (items, r, R) => items.slice(0, r >= R ? items.length : Math.ceil((items.length * r) / R));

async function ownerListing(ctx, spec, token) {
  return unwrap(await ctx.client.call("GET", spec.ownerBase, { token, expect: [200] }));
}

/** Drives one listing (PT or branch) to its scenario state. `spec` abstracts the differences between PT and gym. */
export async function driveListing(ctx, spec) {
  const token = spec.token;
  const admin = await adminToken(ctx);
  const read = () => ownerListing(ctx, spec, token);
  let cur = await read();
  const obs = observeListing(cur);
  const actions = planListing(obs, spec.want);
  if (!actions.length) return;
  const stagedIds = new Map();
  const ensurePhotos = async (files) => {
    const ids = [];
    for (const f of files) {
      if (!stagedIds.has(f.id)) stagedIds.set(f.id, await uploadPhoto(ctx, token, spec.photoBase, f));
      ids.push(stagedIds.get(f.id));
    }
    return ids;
  };
  const openDraft = async () => {
    const r = await ctx.client.call("POST", `${spec.ownerBase}/draft`, { token, body: {}, headers: FLOW2, expect: [200, 201, 409] });
    return unwrap(r)?.revision ?? unwrap(r)?.openRevision ?? null;
  };
  const save = async (rev, payload) => {
    const r = await ctx.client.call("PUT", `${spec.ownerBase}/draft`, { token, body: P.ptSaveDraftBody(need(ctx, rev?.draftVersion ?? 1, "draftVersion"), payload), headers: FLOW2, expect: [200] });
    return unwrap(r)?.revision ?? rev;
  };
  const submit = async (rev) => unwrap(await ctx.client.call("POST", `${spec.ownerBase}/submit`, { token, body: P.submitBody(need(ctx, rev?.draftVersion ?? 1, "draftVersion")), headers: FLOW2, expect: [200] }))?.revision;
  const adminRevId = async (rev) => rev?.id ?? (await read())?.openRevision?.id;
  let rev = cur?.openRevision ?? null;
  let round = obs.approvedByOwner;
  for (const a of actions) {
    if (a === "round") {
      round++;
      const files = roundSlice(spec.photos, round, spec.want.rounds);
      rev = (await openDraft()) ?? rev;
      const payload = await spec.payloadForRound(round, spec.want.rounds, await ensurePhotos(files), files);
      rev = await save(rev, payload);
      rev = await submit(rev);
      await ctx.client.call("POST", `${spec.adminBase}/revisions/${need(ctx, await adminRevId(rev), "revisionId")}/approve`, { token: admin, body: P.approveBody("Nội dung rõ ràng, hình ảnh đạt yêu cầu."), headers: {}, expect: [200] });
      rev = null;
      stat(ctx, `${spec.label}.listing.round`);
    } else if (a === "discardOpen") {
      await ctx.client.call("POST", `${spec.ownerBase}/discard`, { token, body: {}, headers: FLOW2, expect: [200, 404] });
      rev = null;
    } else if (a === "openDraft") {
      rev = (await openDraft()) ?? rev;
      rev = await save(rev, await spec.payloadForTail(await ensurePhotos(spec.photos), spec.photos));
      stat(ctx, `${spec.label}.listing.openDraft`);
    } else if (a === "submit") {
      if (obs.open === "DRAFT" && rev?.id === obs.openRevision?.id && !actions.includes("openDraft")) {
        rev = await save(rev, await spec.payloadForTail(await ensurePhotos(spec.photos), spec.photos));
      }
      rev = await submit(rev ?? (await read())?.openRevision);
    } else if (a === "requestChanges") {
      await ctx.client.call("POST", `${spec.adminBase}/revisions/${need(ctx, await adminRevId(rev), "revisionId")}/request-changes`, { token: admin, body: P.noteBody("Mô tả cần rõ hơn và vui lòng bổ sung thêm ảnh khu tập chính."), expect: [200] });
      stat(ctx, `${spec.label}.listing.changesRequested`);
    } else if (a === "reject") {
      await ctx.client.call("POST", `${spec.adminBase}/revisions/${need(ctx, await adminRevId(rev), "revisionId")}/reject`, { token: admin, body: P.noteBody("Nội dung có thông tin chưa được xác minh, vui lòng gửi lại bản chính xác."), expect: [200] });
      stat(ctx, `${spec.label}.listing.rejected`);
    } else if (a === "adminDirectEdit") {
      const fresh = await read();
      await ctx.client.call("POST", `${spec.adminBase}/${spec.id}/direct-edit`, { token: admin, body: P.directEditBody({ ...spec.directEdit(fresh), reason: "Cập nhật thông tin theo yêu cầu qua điện thoại của chủ cơ sở.", expectedListingVersion: fresh.listingVersion }), expect: [200] });
      stat(ctx, `${spec.label}.listing.stale`);
    }
  }
}

export async function ensurePtListing(ctx, pt) {
  if (pt.app.state !== "APPROVED") return;
  const token = await ctx.client.login(pt.email);
  const want = { kind: pt.listing.kind, rounds: pt.listing.rounds || (pt.listing.firstListing ? 0 : 0) };
  const spec = {
    label: "pt",
    token,
    id: pt.userId,
    ownerBase: "/profile/me/listing",
    photoBase: "/profile/me/listing/physique",
    adminBase: "/admin/listings/pts",
    want,
    photos: pt.photoFiles,
    async payloadForRound(r, R, photoIds, files) {
      const pk = roundSlice(pt.packages, r, R);
      return P.ptListingPayload(pt, { photoIds, coverPhotoId: photoIds[0] ?? null, packages: await packagesWithIds(ctx, token, pk), profileOverride: R > 1 ? { professionalBio: `${pt.app.professionalBio ?? "Huấn luyện viên cá nhân."} Cập nhật chương trình huấn luyện lần ${r}.`.slice(0, 1990) } : {} });
    },
    async payloadForTail(photoIds) {
      const bump = pt.listing.pendingPriceBump;
      const packages = await packagesWithIds(ctx, token, pt.packages, bump);
      const files = pt.listing.swapPhoto ? photoIds.slice(1) : photoIds;
      return P.ptListingPayload(pt, { photoIds: files, coverPhotoId: files[0] ?? null, packages, profileOverride: pt.listing.kind === "DRAFT" || !bump ? { professionalBio: `${pt.app.professionalBio ?? "Huấn luyện viên cá nhân."} Nhận học viên mới từ tháng này.`.slice(0, 1990) } : {} });
    },
    directEdit: (fresh) => ({ profile: { professionalBio: `${pt.app.professionalBio ?? "Huấn luyện viên cá nhân."}`.slice(0, 1900) + " (đã cập nhật bởi quản trị viên)" } }),
  };
  await driveListing(ctx, spec);
  await ensureStaleChildDraft(ctx, spec);
}
// STALE listings keep an auto-rebased child DRAFT; nothing to do - it is created by the server in the same transaction.
async function ensureStaleChildDraft() {}

/** The published packages keep their ids across rounds: match by name so a later round edits instead of duplicating. */
async function packagesWithIds(ctx, token, wanted, bump) {
  const cur = unwrap(await ctx.client.call("GET", "/profile/me/listing", { token }));
  const byName = new Map((cur?.published?.packages ?? []).map((p) => [p.name, p]));
  const open = new Map(((cur?.openRevision?.payload?.packages) ?? []).map((p) => [p.name, p]));
  return wanted.map((p, i) => {
    const existing = byName.get(p.name) ?? open.get(p.name);
    const price = bump && bump.pkgIndex === i ? bump.to : p.price;
    return P.ptPackagePayload({ ...p, price }, existing?.id);
  });
}

// ---- Gym owner ---------------------------------------------------------------------------------------------------------------
async function applicantToken(ctx, owner) {
  if (ctx.client.dryRun) return `dry-token-${owner.email}`;
  try {
    return await ctx.client.login(owner.email);
  } catch {
    // no account yet: start -> verify -> set-password (needs PARTNER_APPLICATION_DEV_ECHO=true on auth-service)
    const start = await ctx.client.call("POST", "/auth/partner-applications/start", { body: { email: owner.email }, expect: [200, 201] });
    const link = start.json?.devVerifyLink;
    if (!link) throw new Error("PARTNER_APPLICATION_DEV_ECHO is off: /auth/partner-applications/start returned no devVerifyLink (see SEED.md, compose override)");
    const raw = link.split("#token=")[1];
    const ver = await ctx.client.call("POST", "/auth/partner-applications/verify", { body: { token: raw }, expect: [200] });
    const sp = await ctx.client.call("POST", "/auth/partner-applications/set-password", { body: { setupToken: ver.json?.setupToken, password: ctx.password }, expect: [200, 201] });
    const t = sp.json?.accessToken;
    if (!t) throw new Error(`set-password for ${owner.email} returned no token`);
    ctx.stats["owner.account.created"] = (ctx.stats["owner.account.created"] ?? 0) + 1;
    return t;
  }
}

export async function ensureOwnerApplication(ctx, owner) {
  const admin = await adminToken(ctx);
  if (owner.partner.state === "SUSPENDED" && !ctx.client.dryRun) {
    const partners = unwrap(await ctx.client.call("GET", "/admin/partners?status=SUSPENDED", { token: admin, expect: [200] }));
    if ((Array.isArray(partners) ? partners : partners?.partners ?? []).some(p => p.contactEmail === owner.email)) {
      owner.__accessState = "SUSPENDED";
      return;
    }
  }
  let observed = null;
  let token;
  const exists = ctx.client.dryRun ? false : await ctx.client.login(owner.email).then(() => true, () => false);
  if (exists) {
    token = await ctx.client.login(owner.email);
    observed = unwrap(await ctx.client.call("GET", "/owner/application/status", { token, expect: [200] }))?.accessState ?? null;
  }
  const { actions, conflict } = planPartnerApplication(observed, { state: owner.partner.state, onboardingSections: owner.partner.onboardingSections });
  owner.__accessState = observed;
  if (conflict) {
    ctx.warnings.push(`${owner.email}: ${conflict}`);
    return;
  }
  const first = owner.branches.find((b) => b.firstOfApplication) ?? owner.branches[0];
  const partnerIdOf = async () => unwrap(await ctx.client.call("GET", "/owner/application", { token, expect: [200] }))?.partner?.id ?? unwrap(await ctx.client.call("GET", "/owner/application", { token }))?.partnerId;
  const call = (method, path, body, tok = token) => ctx.client.call(method, path, { token: tok, body, headers: FLOW2, expect: [200, 201] });
  const uploadAppPhoto = async (file, category) => {
    const p = unwrap(await call("POST", "/owner/application/uploads/presign", { kind: "PHOTO", contentType: "image/webp", sizeBytes: readAsset(file).length, photoCategory: category }));
    await postToStorage(ctx.client, need(ctx, p, "presign"), readAsset(file), "image/webp");
    await call("POST", "/owner/application/uploads/confirm", { uploadId: need(ctx, p?.uploadId, "uploadId") });
  };
  const uploadAppDoc = async (docType, bytes, contentType) => {
    const p = unwrap(await call("POST", "/owner/application/uploads/presign", { kind: "DOCUMENT", docType, contentType, sizeBytes: bytes.length }));
    await postToStorage(ctx.client, need(ctx, p, "presign"), bytes, contentType);
    await call("POST", "/owner/application/uploads/confirm", { uploadId: need(ctx, p?.uploadId, "uploadId") });
  };
  const amenityIds = first.amenities.system.map((s) => amenityIdFor(ctx, s)).concat(first.amenities.custom.map((k) => amenityIdFor(ctx, k))).filter(Boolean);
  const sections = {
    representative: () => call("PUT", "/owner/application/representative", P.representativeBody(owner)),
    businessScale: () => call("PUT", "/owner/application/business-scale", P.businessScaleBody(owner)),
    brand: () => call("PUT", "/owner/application/brand", P.applicationBrandBody(owner)),
    branch: () => call("PUT", "/owner/application/branch", P.applicationBranchBody(first)),
    location: () => call("PUT", "/owner/application/branch", P.applicationLocationBody(first)),
    amenities: () => {
      if (first.appProposal) {
        const proposals = [P.inlineProposal(first.appProposal)];
        return call("PUT", "/owner/application/amenities", { amenityIds, proposals });
      }
      return call("PUT", "/owner/application/amenities", { amenityIds });
    },
    photos: async () => {
      const cats = ["EXTERIOR", "MAIN_TRAINING_AREA", "EQUIPMENT", "CARDIO", "CHANGING_ROOM", "AMENITIES"];
      let i = 0;
      for (const f of first.photoFiles) await uploadAppPhoto(f, cats[i++ % cats.length]);
    },
    legal: () => call("PUT", "/owner/application/legal", P.legalBody(owner)),
    documents: async () => {
      await uploadAppDoc("BUSINESS_LICENSE", PDF_MIN, "application/pdf");
      await uploadAppDoc("REPRESENTATIVE_ID", PNG_1x1, "image/png");
      await uploadAppDoc("PREMISES_PROOF", PDF_MIN, "application/pdf");
    },
    social: () => call("PUT", "/owner/application/social", P.socialBody(owner)),
  };
  const order = ["representative", "businessScale", "brand", "branch", "location", "amenities", "photos", "legal", "documents", "social"];
  const noPhotosYet = first.photoFiles.length === 0 && owner.partner.state !== "ONBOARDING";
  void noPhotosYet;

  for (const a of actions) {
    if (a === "createAccount") token = await applicantToken(ctx, owner);
    else if (a === "bootstrap") await ctx.client.call("POST", "/owner/application/bootstrap", { token, headers: FLOW2, expect: [200, 201] });
    else if (a.startsWith("fillSections:")) {
      const n = a.endsWith("all") ? order.length : Number(a.split(":")[1]);
      for (const key of order.slice(0, n)) {
        if (owner.partner.state === "UNDER_REVIEW" && key === "social" && !owner.partner.social.facebookUrl) continue;
        if (!ctx.client.dryRun) {
          const app = unwrap(await ctx.client.call("GET", "/owner/application", { token, expect: [200] }));
          const matches = (actual, wanted) => Object.entries(wanted).every(([k, v]) => (actual?.[k] ?? null) === (v ?? null));
          const complete = {
            representative: matches(app?.partner, { representativeName: owner.partner.representative.name, representativeRole: owner.partner.representative.role }) && app?.representativePhone === owner.partner.representative.phone,
            businessScale: app?.partner?.businessScale === owner.partner.scale,
            brand: matches(app?.brand, P.applicationBrandBody(owner)),
            branch: matches(app?.branch, P.applicationBranchBody(first)),
            location: matches(app?.branch, P.applicationLocationBody(first)),
            amenities: amenityIds.every(id => app?.amenities?.some(x => (x.id ?? x.amenityId) === id)) && (!first.appProposal || app?.amenityProposals?.some(x => x.name === first.appProposal.name)),
            photos: (app?.photos?.length ?? 0) >= first.photoFiles.length,
            legal: matches(app?.partner, P.legalBody(owner)),
            documents: ["BUSINESS_LICENSE", "REPRESENTATIVE_ID", "PREMISES_PROOF"].every(t => app?.documents?.some(d => d.docType === t && d.hasFile)),
            social: matches(app?.brand, P.socialBody(owner)),
          };
          if (complete[key]) continue;
        }
        await sections[key]();
      }
    } else if (a === "submit") await call("POST", "/owner/application/submit", P.submitApplicationBody());
    else if (a === "resubmit") await call("POST", "/owner/application/resubmit", {});
    else if (a.startsWith("admin:")) {
      const pid = await partnerIdOf();
      const base = `/admin/partners/${need(ctx, pid, "partnerId")}/application`;
      const doAdmin = (method, path, body) => ctx.client.call(method, path, { token: admin, body, expect: [200, 201] });
      if (a === "admin:requestChanges") await doAdmin("POST", `${base}/request-changes`, P.requestChangesBody(owner.partner.changes));
      else if (a === "admin:reject") await doAdmin("POST", `${base}/reject`, P.rejectApplicationBody(owner.partner.rejectReason));
      else if (a === "admin:acceptDocuments") {
        const full = unwrap(await ctx.client.call("GET", base, { token: admin, expect: [200] }));
        for (const d of ["BUSINESS_LICENSE", "REPRESENTATIVE_ID", "PREMISES_PROOF"]) {
          if (full?.documents?.some(x => x.docType === d && x.status === "VERIFIED")) continue;
          await doAdmin("POST", `${base}/documents/${d}/accept`, {});
        }
      }
      else if (a === "admin:resolveIssues") {
        const full = unwrap(await ctx.client.call("GET", base, { token: admin }));
        for (const i of full?.issues ?? []) if (i.status !== "RESOLVED") await doAdmin("POST", `${base}/issues/${i.id}/resolve`, {});
      } else if (a === "admin:resolveProposals") {
        const pending = unwrap(await ctx.client.call("GET", "/admin/amenities/proposals?status=PENDING", { token: admin })) ?? [];
        const mine = (Array.isArray(pending) ? pending : pending.groups?.flatMap(g => g.proposals) ?? pending.proposals ?? []).filter(p => p.name === first.appProposal?.name && p.gymName === first.name);
        if (mine.length && first.appProposal?.outcome === "APPROVED") await doAdmin("POST", "/admin/amenities/proposals/approve", P.proposalApproveBody(mine.map((p) => p.id), { category: first.appProposal.category, iconKey: "trophy" }));
      } else if (a === "admin:approve") await doAdmin("POST", `${base}/approve`, {});
      else if (a === "admin:suspend") continue; // Run after branch/plan creation; suspended owners cannot operate.
      stat(ctx, `owner.${a}`);
    } else if (a === "owner:onboarding") {
      await ctx.client.call("PATCH", "/owner/onboarding/contact", { token, body: { phone: owner.partner.contactPhone }, expect: [200] });
      await ctx.client.call("PATCH", "/owner/onboarding/payout", { token, body: P.payoutBody(owner), expect: [200] });
      await ctx.client.call("POST", "/owner/onboarding/terms", { token, body: {}, expect: [200, 201] });
    }
  }
}

export async function ensureProposal(ctx, { token, gymId, want, ownerId }) {
  const admin = await adminToken(ctx);
  const list = unwrap(await ctx.client.call("GET", "/owner/amenities", { token, expect: [200] }));
  const found = (list?.proposals ?? []).find((p) => p.gymId === gymId && p.name === want.name);
  const actions = planProposal(found?.status ?? null, want);
  let proposal = found;
  for (const a of actions) {
    if (a === "propose") {
      const r = await ctx.client.call("POST", "/owner/amenities/proposals", { token, body: P.proposalBody(gymId, want), expect: [200, 201] });
      proposal = unwrap(r)?.proposal ?? proposal;
    } else if (a === "admin:approve") await ctx.client.call("POST", "/admin/amenities/proposals/approve", { token: admin, body: P.proposalApproveBody([need(ctx, proposal?.id, "proposalId")], { category: want.category, iconKey: "trophy" }), expect: [200] });
    else if (a === "admin:reject") await ctx.client.call("POST", "/admin/amenities/proposals/reject", { token: admin, body: P.proposalRejectBody([need(ctx, proposal?.id, "proposalId")], want.rejectReason ?? "Tên tiện ích không phù hợp với một phòng tập."), expect: [200] });
    else if (a === "admin:merge") await ctx.client.call("POST", "/admin/amenities/proposals/merge", { token: admin, body: P.proposalMergeBody([need(ctx, proposal?.id, "proposalId")], need(ctx, ctx.catalog.get(want.mergeInto)?.id, "targetAmenityId")), expect: [200] });
    stat(ctx, `proposal.${a}`);
  }
  void ownerId;
}

export async function ensureBrandPlans(ctx, owner, token) {
  const brands = unwrap(await ctx.client.call("GET", "/owner/brands", { token, expect: [200] })) ?? [];
  const brand = (Array.isArray(brands) ? brands : brands.brands ?? [])[0];
  if (!brand) return;
  const plans = unwrap(await ctx.client.call("GET", `/owner/brands/${brand.id}/plans`, { token, expect: [200] })) ?? [];
  const have = new Map((Array.isArray(plans) ? plans : plans.plans ?? []).map((p) => [p.name, p]));
  for (const p of owner.plans) {
    if (have.has(p.name)) {
      const existing = have.get(p.name);
      const wantedStatus = p.status ?? "ACTIVE";
      if (existing.status !== wantedStatus) await ctx.client.call("PATCH", `/owner/brands/${brand.id}/plans/${existing.id}`, { token, body: P.planPatchBody(wantedStatus), expect: [200] });
      continue;
    }
    const r = await ctx.client.call("POST", `/owner/brands/${brand.id}/plans`, { token, body: P.planBody(p), expect: [200, 201] });
    if (p.status === "INACTIVE") await ctx.client.call("PATCH", `/owner/brands/${brand.id}/plans/${need(ctx, unwrap(r)?.id, "planId")}`, { token, body: P.planPatchBody("INACTIVE"), expect: [200] });
    stat(ctx, "plan.created");
  }
}

/** Extra branches (not the application's first one): wizard or quick create, then admin status + operational status. */
export async function ensureHours(ctx, gymId, b, token) {
  const current = unwrap(await ctx.client.call("GET", `/owner/gyms/${gymId}/hours`, { token, expect: [200] })) ?? [];
  const same = b.hours.every(w => current.some(h => h.day === w.day && h.type === w.type && (h.openMinute ?? null) === (w.openMinute ?? null) && (h.closeMinute ?? null) === (w.closeMinute ?? null)));
  if (!same) await ctx.client.call("PUT", `/owner/gyms/${gymId}/hours`, { token, body: P.hoursBody(b), expect: [200] });
}

export async function ensureExtraBranch(ctx, owner, b, token) {
  const admin = await adminToken(ctx);
  const gyms = unwrap(await ctx.client.call("GET", "/owner/gyms", { token, expect: [200] })) ?? [];
  const mine = (Array.isArray(gyms) ? gyms : gyms.gyms ?? []).find((g) => g.name === b.name || g.approvedName === b.name);
  const actions = planBranch({ exists: !!mine, status: mine?.status, operationalStatus: mine?.operationalStatus, wizardStep: mine?.wizardStep }, { createdVia: b.createdVia === "LEGACY_QUICK" ? "QUICK" : b.createdVia, status: b.status, wizardStep: b.wizardStep, op: b.op });
  let gym = mine;
  const amenityIds = b.amenities.system.map((s) => amenityIdFor(ctx, s)).concat(b.amenities.custom.map((k) => amenityIdFor(ctx, k))).filter(Boolean);
  for (const a of actions) {
    const headers = b.createdVia === "LEGACY_QUICK" ? {} : FLOW2;
    if (a === "createDraft") gym = unwrap(await ctx.client.call("POST", "/owner/gyms/draft", { token, body: {}, headers, expect: [200, 201] }));
    else if (a === "quickCreate") gym = unwrap(await ctx.client.call("POST", "/owner/gyms", { token, body: P.quickCreateBody(b, amenityIds), headers, expect: [200, 201] }));
    else if (a.startsWith("fillWizard:")) {
      const step = a.endsWith("all") ? 7 : Number(a.split(":")[1]);
      await ctx.client.call("PATCH", `/owner/gyms/${need(ctx, gym?.id, "gymId")}/draft`, { token, body: P.wizardDraftBody(b, amenityIds, step), headers, expect: [200] });
      if (step >= 3 || a.endsWith("all")) await ctx.client.call("PUT", `/owner/gyms/${gym.id}/hours`, { token, body: P.hoursBody(b), expect: [200] });
      for (const f of b.photoFiles) await uploadPhoto(ctx, token, `/owner/gyms/${gym.id}/listing/photos`, f);
    } else if (a === "submitWizard") {
      const docs = unwrap(await ctx.client.call('GET', `/owner/gyms/${gym.id}/branch-documents`, { token, expect: [200] }));
      const existing = Array.isArray(docs) ? docs : docs?.documents ?? [];
      for (const docType of ['LEASE_OR_PROPERTY_DOC', 'FACILITY_PHOTOS']) {
        if (existing.some(d => d.docType === docType && d.fileToken)) continue;
        const form = new FormData();
        const photo = b.photoFiles[0];
        form.append('file', new Blob([docType === 'FACILITY_PHOTOS' && photo ? readAsset(photo) : PDF_MIN], { type: docType === 'FACILITY_PHOTOS' && photo ? 'image/webp' : 'application/pdf' }), docType === 'FACILITY_PHOTOS' && photo ? 'facility.webp' : 'lease.pdf');
        await ctx.client.call('POST', `/owner/gyms/${gym.id}/branch-documents/${docType}`, { token, form, expect: [200, 201] });
      }
      await ctx.client.call("POST", `/owner/gyms/${gym.id}/submit`, { token, body: {}, headers, expect: [200] });
    } else if (a.startsWith("admin:status:")) {
      await ctx.client.call("PATCH", `/admin/gyms/${need(ctx, gym?.id, "gymId")}/status`, { token: admin, body: P.adminGymStatusBody(a.split(":")[2]), expect: [200] });
    } else if (a.startsWith("owner:operational:")) {
      await ctx.client.call("PATCH", `/owner/gyms/${gym.id}/operational-status`, { token, body: P.operationalBody(b), expect: [200] });
    }
    stat(ctx, `branch.${a.split(":")[0]}`);
  }
  return gym;
}

// ---- money --------------------------------------------------------------------------------------------------------------------------
/** Follows the (non-production) VNPay simulator: pay -> checkout URL -> /payments/vnpay/sim page -> signed return URL -> GET it. */
export async function settleViaSimulator(ctx, payResponse, token) {
  if (ctx.client.dryRun) return "dry";
  const text = JSON.stringify(payResponse ?? {});
  const m = text.match(/(https?:\/\/[^"\\]+)?(\/payments\/vnpay\/sim\?txnId=[0-9a-f-]+)/i);
  if (!m) throw new Error("pay response has no /payments/vnpay/sim URL - is VNPAY_SIMULATE=true on payment-service? (see SEED.md)");
  const sim = await ctx.client.call("GET", m[2], { token });
  const html = sim.json?.raw ?? "";
  const ok = html.match(/href="(\/payments\/vnpay\/return\?[^"]+)"/);
  if (!ok) throw new Error("simulator page has no success link");
  const ret = await ctx.client.call("GET", ok[1].replace(/&amp;/g, "&"), { token });
  return ret.status;
}

export async function ensureContract(ctx, { pt, client, packageIndex, want, gymId }) {
  const ptToken = await ctx.client.login(pt.email);
  const clientToken = await ctx.client.login(client.profile.email);
  const listing = unwrap(await ctx.client.call("GET", "/profile/me/listing", { token: ptToken }));
  const pkg = (listing?.published?.packages ?? []).filter((p) => p.isActive)[packageIndex];
  if (!pkg) return;
  const mine = unwrap(await ctx.client.call("GET", "/contracts/client", { token: clientToken })) ?? [];
  const existing = (Array.isArray(mine) ? mine : mine.contracts ?? []).find((c) => c.ptUserId === pt.userId && c.packageName === pkg.name);
  const actions = planContract(existing?.status ?? null, want);
  let contract = existing;
  for (const a of actions) {
    if (a === "request") {
      const send = () => ctx.client.call("POST", "/contracts/request", { token: clientToken, body: P.contractRequestBody(pt.userId, pkg, gymId), expect: [200, 201, 422] });
      let r = await send();
      const code = r.json?.error?.code ?? r.json?.code;
      if (r.status === 422 && code === "PT_NOT_ACCEPTING_CLIENTS" && pt.flags.notAccepting) {
        // an earlier run set the "not accepting" flag before this contract existed: open the PT briefly, ensurePtFlags closes it again
        await ctx.client.call("PATCH", "/profile/me/accepting-clients", { token: ptToken, body: { isAcceptingClients: true }, expect: [200] });
        stat(ctx, "pt.flags.notAccepting.reopenedForContract");
        r = await send();
      }
      if (![200, 201].includes(r.status)) throw new Error(`POST /contracts/request -> ${r.status} ${code ?? ""}`.trim());
      contract = unwrap(r);
    }
    else if (a === "accept") await ctx.client.call("PATCH", `/contracts/${need(ctx, contract?.id, "contractId")}/accept`, { token: ptToken, expect: [200] });
    else if (a === "pay") {
      const r = await ctx.client.call("POST", `/contracts/${contract.id}/pay`, { token: clientToken, body: P.payBody(), expect: [200] });
      await settleViaSimulator(ctx, r.json, clientToken);
    } else if (a === "completeInPast") {
      stat(ctx, "contract.SKIPPED_no_api_for_completed_history");
      continue;
    }
    stat(ctx, `contract.${a}`);
  }
}

export async function ensureMembership(ctx, { client, gymId, planId, want, review }) {
  const token = await ctx.client.login(client.profile.email);
  const mine = unwrap(await ctx.client.call("GET", "/me/gym-memberships", { token })) ?? [];
  const existing = (Array.isArray(mine) ? mine : mine.memberships ?? []).find((m) => m.gymId === gymId && m.planId === planId);
  const actions = planMembership(existing?.status ?? null, want);
  let m = existing;
  let purchasePayment;
  for (const a of actions) {
    if (a === "purchase") {
      const purchased = unwrap(await ctx.client.call("POST", `/gyms/${gymId}/memberships`, { token, body: P.membershipBody(planId), expect: [200, 201] }));
      m = purchased?.membership ?? m;
      purchasePayment = purchased?.payment;
    }
    if (a === "pay") {
      const payment = purchasePayment ?? (await ctx.client.call("POST", `/me/gym-memberships/${need(ctx, m?.id, "membershipId")}/pay`, { token, body: P.payBody(), expect: [200, 201] })).json;
      await settleViaSimulator(ctx, payment, token);
    }
    stat(ctx, `membership.${a}`);
  }
  if (review && want === "ACTIVE") {
    const reviews = unwrap(await ctx.client.call("GET", `/gyms/${gymId}/reviews`, { token, expect: [200] })) ?? [];
    if ((Array.isArray(reviews) ? reviews : reviews.reviews ?? []).some(r => r.clientId === client.profile.userId && r.rating === review.rating && r.comment === review.comment)) return;
    await ctx.client.call("POST", `/gyms/${gymId}/reviews`, { token, body: P.reviewBody(review.rating, review.comment), expect: [200, 201] });
    stat(ctx, "gymReview.posted");
  }
}
