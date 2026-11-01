// Tier B orchestrator. Order matters (an application must be approved before its branch can have a listing, a PT's listing must
// publish packages before a client can buy one, ...). Every step is an "ensure": read, plan, do only what is missing.
import { makeHelpers, rngFrom } from "../util.mjs";
import { readAsset } from "../world/assets.mjs";
import * as F from "./flows.mjs";
import * as P from "./payloads.mjs";
import { unwrap } from "./client.mjs";

const REVIEW_COMMENTS = [
  "Phòng tập sạch sẽ, máy móc đầy đủ, nhân viên thân thiện. Giờ cao điểm hơi đông nhưng vẫn tập thoải mái.",
  "Giá hợp lý so với chất lượng. Mình tập buổi tối ở đây khá ổn, có chỗ gửi xe rộng.",
  "Huấn luyện viên nhiệt tình, hướng dẫn kỹ thuật rất kỹ cho người mới như mình.",
  "Không gian thoáng, điều hòa mát, khu tạ tự do đầy đủ. Sẽ gia hạn gói dài hơn.",
  "Phòng thay đồ và nhà tắm tốt. Chỉ mong có thêm máy chạy bộ vào giờ cao điểm.",
  "Cơ sở mới đẹp, nhưng buổi sáng cuối tuần khá đông. Nhìn chung hài lòng.",
];

/** Gym branch listing driver spec (the open-revision variations of plan 8.1 become the tail payload). */
function branchSpec(ctx, owner, b, token, gymId) {
  const tweakPayload = (base, tweaks, extraPhotoIds = []) => {
    const p = { ...base, amenityIds: [...base.amenityIds], photoIds: [...base.photoIds] };
    for (const t of tweaks ?? []) {
      if (t === "description") p.description = `${b.description} Nay có thêm khu tập mới và giờ mở cửa dài hơn.`.slice(0, 300);
      else if (t.startsWith("addAmenity:")) {
        const id = F.amenityIdFor(ctx, t.split(":")[1]);
        const amenityId = id ?? `amenity-sys-${t.split(":")[1].toLowerCase().replace(/_/g, "-")}`;
        if (!p.amenityIds.includes(amenityId)) p.amenityIds.push(amenityId);
      } else if (t.startsWith("swapPhoto:") && extraPhotoIds.length) {
        const idx = Number(t.split(":")[1]);
        p.photoIds = p.photoIds.filter((_, i) => i !== idx).concat(extraPhotoIds.slice(0, 1));
        p.coverPhotoId = p.photoIds[0] ?? null;
      }
    }
    return p;
  };
  const baseAmenities = () => b.amenities.system.map((s) => ctx.catalog?.get(s)?.id ?? `amenity-sys-${s.toLowerCase().replace(/_/g, "-")}`).concat(b.amenities.custom.map((k) => ctx.catalog?.get(k)?.id).filter(Boolean));
  const tweaks = b.listing.open ?? [];
  return {
    label: "gym",
    token,
    id: gymId,
    ownerBase: `/owner/gyms/${gymId}/listing`,
    photoBase: `/owner/gyms/${gymId}/listing/photos`,
    adminBase: "/admin/listings/gyms",
    want: { kind: b.listing.finalKind, rounds: b.listing.rounds },
    photos: b.photoFiles,
    async payloadForRound(r, R, photoIds) {
      const roundTweaks = b.listing.roundTweaks?.[r - 1] ?? [];
      const payload = tweakPayload(P.gymListingPayload({ description: b.description, amenityIds: baseAmenities(), photoIds, coverPhotoId: photoIds[0] ?? null }), r < R ? [] : roundTweaks);
      payload.description = `${payload.description.slice(0, 250)} Cập nhật cơ sở lần ${r}.`;
      return payload;
    },
    async payloadForTail(photoIds) {
      const proposals = tweaks.filter((t) => t.startsWith("proposal:"));
      const proposalIds = [];
      for (const t of proposals) {
        const [, name, category] = t.split(":");
        const r = await ctx.client.call("POST", "/owner/amenities/proposals", { token, body: P.proposalBody(gymId, { name, category }), expect: [200, 201] });
        const id = unwrap(r)?.proposal?.id;
        if (id) proposalIds.push(id);
      }
      const base = P.gymListingPayload({ description: b.description, amenityIds: baseAmenities(), proposalIds, photoIds, coverPhotoId: photoIds[0] ?? null });
      const payload = tweakPayload(base, tweaks.filter((t) => !t.startsWith("proposal:")));
      payload.description = `${payload.description.slice(0, 240)} Bổ sung thông tin khu tập trong tháng này.`;
      return payload;
    },
    directEdit: () => ({ description: `${b.description} (Quản trị viên đã chỉnh lại mô tả theo yêu cầu của chủ cơ sở.)`.slice(0, 300) }),
  };
}

export async function runTierB(ctx, { only, limit } = {}) {
  const { world } = ctx;
  const t0 = Date.now();
  const want = (k) => !only || only.includes(k);
  const step = async (label, fn) => {
    ctx.log(`[tierB] ${label}`);
    try {
      await fn();
      return true;
    } catch (e) {
      ctx.errors.push({ step: label, error: String(e.message).slice(0, 300) });
      ctx.log(`[tierB] ! ${label}: ${e.message}`);
      if (ctx.failFast) throw e;
      return false;
    }
  };

  if (want("catalogue")) await step("catalogue", () => F.ensureCatalogue(ctx));
  else ctx.catalog = ctx.catalog ?? new Map();

  if (want("pts")) {
    ctx.disabledPts = new Set(); // disabled AND scenario complete: skipped entirely (zero writes)
    ctx.incompletePts = new Set(); // scenario not finished in this run: their flags (disable, restrictions) must not run
    const pts = world.pts.slice(0, limit ?? Infinity);
    if (!ctx.client.dryRun) {
      const users = unwrap(await ctx.client.call("GET", "/auth/users", { token: await F.adminToken(ctx), expect: [200] }));
      const off = new Set((users?.users ?? []).filter((u) => u.isActive === false).map((u) => u.id));
      for (const pt of pts) {
        // seed-domain accounts only (the planned e-mail always ends with the seed domain)
        if (!off.has(pt.userId) || !pt.email.endsWith("@seed.gymini.test")) continue;
        if (await F.ptScenarioComplete(ctx, pt)) {
          ctx.disabledPts.add(pt.userId);
          if (!pt.flags.suspended) ctx.warnings.push(`${pt.email}: account is disabled although the scenario does not suspend it; left alone`);
        } else {
          // locked by an earlier run before its application/listing was finished: enable, complete, flags step locks it again
          await step(`pt ${pt.slug} re-enable (incomplete scenario)`, () => F.setAccountActive(ctx, pt.userId, true));
        }
      }
    }
    for (const pt of pts) {
      if (ctx.disabledPts.has(pt.userId)) continue;
      if (!(await step(`pt ${pt.slug} application`, () => F.ensurePtApplication(ctx, pt)))) ctx.incompletePts.add(pt.userId);
    }
    for (const pt of pts) {
      if (ctx.disabledPts.has(pt.userId) || ctx.incompletePts.has(pt.userId)) continue;
      if (!(await step(`pt ${pt.slug} listing`, () => F.ensurePtListing(ctx, pt)))) ctx.incompletePts.add(pt.userId);
    }
  }

  const ownerCtx = new Map();
  if (want("owners")) {
    for (const owner of world.owners.slice(0, limit ?? Infinity)) {
      await step(`owner ${owner.slug} application`, async () => {
        await F.ensureOwnerApplication(ctx, owner);
        if (owner.__accessState === "SUSPENDED") return;
        ownerCtx.set(owner.slug, await ctx.client.login(owner.email).catch(() => null));
      });
      const token = ownerCtx.get(owner.slug);
      if (owner.__accessState === "SUSPENDED") continue;
      if (!token || !["ACTIVE", "SUSPENDED", "APPROVED_PAYOUT_PENDING"].includes(owner.partner.state)) continue;
      await step(`owner ${owner.slug} plans`, () => F.ensureBrandPlans(ctx, owner, token));
      const gyms = unwrap(await ctx.client.call("GET", "/owner/gyms", { token }).catch(() => ({}))) ?? [];
      const list = Array.isArray(gyms) ? gyms : gyms.gyms ?? [];
      for (const b of owner.branches) {
        await step(`branch ${b.slug}`, async () => {
          let gym = list.find((g) => g.name === b.name || g.approvedName === b.name);
          if (!b.firstOfApplication) gym = await F.ensureExtraBranch(ctx, owner, b, token);
          else if (gym && b.hours) await F.ensureHours(ctx, gym.id, b, token);
          if (gym && b.op && b.op !== "OPEN" && b.firstOfApplication && gym.operationalStatus !== b.op) await ctx.client.call("PATCH", `/owner/gyms/${gym.id}/operational-status`, { token, body: P.operationalBody(b), expect: [200] });
          const gid = gym?.id ?? (ctx.client.dryRun ? `dry-gym-${b.slug}` : null);
          if (gid && b.listing.finalKind !== "NONE" && b.status === "APPROVED") await F.driveListing(ctx, branchSpec(ctx, owner, b, token, gid));
          if (gid && b.listing.finalKind === "REJECTED") for (const tweak of b.listing.open ?? []) {
            if (!tweak.startsWith("proposal:")) continue;
            const [, name, category] = tweak.split(":");
            await F.ensureProposal(ctx, {token, gymId:gid, want:{name, category, outcome:"REJECTED"}});
          }
          b.__gymId = gid;
        });
      }
      if (owner.partner.state === "SUSPENDED") await step(`owner ${owner.slug} suspend`, async () => {
        const app = unwrap(await ctx.client.call("GET", "/owner/application/status", { token, expect: [200] }));
        await ctx.client.call("POST", `/admin/partners/${app.partnerId}/suspend`, { token: await F.adminToken(ctx), body: P.partnerSuspendBody(owner.partner.suspendReason), expect: [200] });
      });
    }
    // catalogue scenarios that span owners
    const s = world.amenityScenarios;
    const o = world.owners.find((x) => x.slug === s.merged.ownerSlug);
    const tok = ownerCtx.get(o.slug);
    if (tok) {
      await step("amenity scenario MERGED", async () => {
        const b = o.branches.find((x) => x.key === s.merged.branchKey);
        if (b?.__gymId) await F.ensureProposal(ctx, { token: tok, gymId: b.__gymId, want: { name: s.merged.name, category: s.merged.category, note: s.merged.note, outcome: "MERGED", mergeInto: s.merged.mergeInto } });
      });
      await step("amenity scenario REENABLE", async () => {
        const admin = await F.adminToken(ctx);
        const gt = ctx.catalog?.get(s.reenable.disableKey);
        if (gt && gt.status !== "DISABLED") await ctx.client.call("PATCH", `/admin/amenities/${gt.id}`, { token: admin, body: P.catalogueToggleBody("DISABLED", "Tạm ngưng danh mục để rà soát tên gọi."), expect: [200] });
        const b = o.branches.find((x) => x.key === s.reenable.branchKey);
        if (b?.__gymId) await F.ensureProposal(ctx, { token: tok, gymId: b.__gymId, want: { name: s.reenable.name, category: s.reenable.category, outcome: "PENDING" } });
      });
    }
  }

  if (want("money")) {
    const rng = rngFrom("tierB:money");
    const h = makeHelpers(rng);
    const clients = world.clients;
    let ci = 0;
    const nextClient = () => clients[(ci++ * 7 + 3) % clients.length];
    for (const pt of world.pts.filter((p) => p.contracts.length && !p.flags.suspended)) {
      for (let i = 0; i < pt.contracts.length; i++) {
        const w = pt.contracts[i];
        await step(`contract ${pt.slug}#${i}`, () => F.ensureContract(ctx, { pt, client: nextClient(), packageIndex: i % Math.max(1, pt.packages.filter((p) => p.isActive).length), want: w === "COMPLETED" ? "COMPLETED" : w }));
      }
    }
    for (const owner of world.owners.filter((o) => o.partner.state === "ACTIVE")) {
      const token = ownerCtx.get(owner.slug);
      if (!token) continue;
      const activeBranches = owner.branches.filter((b) => b.__gymId && b.status === "APPROVED" && b.op === "OPEN");
      const plansRes = unwrap(await ctx.client.call("GET", `/gyms/${activeBranches[0]?.__gymId}/plans`, { token }).catch(() => ({}))) ?? [];
      const plans = (Array.isArray(plansRes) ? plansRes : plansRes.plans ?? []).filter((p) => p.status === "ACTIVE");
      if (!plans.length) continue;
      const n = Math.min(10, 3 + activeBranches.length);
      for (let k = 0; k < n; k++) {
        const b = activeBranches[k % activeBranches.length];
        const plan = plans[h.int(0, plans.length - 1)];
        const client = nextClient();
        const reviewIt = k % 2 === 0;
        await step(`membership ${owner.slug}#${k}`, () =>
          F.ensureMembership(ctx, { client, gymId: b.__gymId, planId: plan.id, want: k % 7 === 6 ? "PENDING_PAYMENT" : "ACTIVE", review: reviewIt ? { rating: h.pick([3, 4, 4, 5, 5, 5]), comment: h.pick(REVIEW_COMMENTS) } : null }),
        );
      }
    }
  }

  // restrictions need contracts to exist first
  if (want("pts")) {
    for (const pt of world.pts.slice(0, limit ?? Infinity)) {
      if (!(await step(`pt ${pt.slug} flags`, () => F.ensurePtFlags(ctx, pt)))) ctx.incompletePts?.add(pt.userId);
      if (pt.flags.contractRestricted && !ctx.disabledPts?.has(pt.userId) && !ctx.incompletePts?.has(pt.userId)) {
        await step(`pt ${pt.slug} contract restriction`, async () => {
          const admin = await F.adminToken(ctx);
          const token = await ctx.client.login(pt.email).catch(() => null);
          const mine = token ? unwrap(await ctx.client.call("GET", "/contracts/pt", { token })) ?? [] : [];
          const c = (Array.isArray(mine) ? mine : mine.contracts ?? []).find((x) => x.status === "ACTIVE");
          const history = unwrap(await ctx.client.call("GET", `/admin/pts/${pt.userId}/restrictions`, { token: admin, expect: [200] }));
          if (history?.restrictions?.some(r => r.scope === "CONTRACT" && r.contractId === c?.id && !r.endedAt)) return;
          if (c) await ctx.client.call("POST", `/admin/pts/${pt.userId}/contracts/${c.id}/restrict`, { token: admin, body: P.restrictContractBody("DOCUMENT_VERIFICATION", "Chứng chỉ của huấn luyện viên cần được xác minh lại cho hợp đồng này.", "Hợp đồng đang tạm dừng để xác minh."), expect: [200, 409] });
        });
      }
    }
  }
  return { ms: Date.now() - t0, stats: ctx.stats, errors: ctx.errors, warnings: ctx.warnings, requests: ctx.client.log.length };
}

export function makeTierBContext({ client, world, admin, password, log = () => {}, failFast = false }) {
  return { client, world, admin, password, log, failFast, stats: {}, errors: [], warnings: [], catalog: new Map(), ptTermsVersion: undefined };
}

/** Static description of what Tier B would create (no network): used by the dry-run report. */
export function describeTierB(world) {
  const branches = world.owners.flatMap((o) => o.branches);
  return {
    ptApplications: world.pts.length,
    ptListingRounds: world.pts.reduce((n, p) => n + (p.listing.rounds || 0), 0),
    ptListingTails: world.pts.filter((p) => ["DRAFT", "PENDING", "CHANGES_REQUESTED", "REJECTED", "STALE"].includes(p.listing.kind)).length,
    ptPhysiquePhotoUploads: world.pts.reduce((n, p) => n + p.photoFiles.length, 0),
    ptPackages: world.pts.reduce((n, p) => n + p.packages.length, 0),
    ptContractsPlanned: world.pts.reduce((n, p) => n + p.contracts.length, 0),
    ownerApplications: world.owners.length,
    branches: branches.length,
    branchPhotoUploads: branches.reduce((n, b) => n + b.photoFiles.length, 0),
    branchListingRounds: branches.reduce((n, b) => n + (b.listing.rounds || 0), 0),
    gymPlans: world.owners.reduce((n, o) => n + o.plans.length, 0),
  };
}

export { readAsset };
