/**
 * Phase 1 (cuối) - PT <-> Gym partnership at BRAND level (pure half). Fixtures mirror the real rows of
 * `GET /me/collaborations` / `GET /owner/collaborations` (gym-service collaboration.service.ts: listFor +
 * presentBrandAgreement) and the public `GET /gyms` / owner `GET /owner/gyms` lists.
 *
 * Chạy: tsx --test src/features/__tests__/brandPartnership.test.ts (từ frontend/mobile)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BRANCH_AGREEMENT_LABEL,
  BRANCH_NAME_FALLBACK,
  BRANDLESS_DETAIL,
  COVERAGE_COPY,
  LEGACY_BRANDLESS_HEADLINE,
  LEGACY_CONFLICT_DETAIL,
  LEGACY_HEADLINE,
  LEGACY_SAME_DETAIL,
  PT_NAME_FALLBACK,
  awaitingMyReplyCount,
  brandOptionsFromGyms,
  brandsBlockedForProposal,
  buildPartnershipSections,
  dateVi,
  hasRateConflict,
  noticeLineFor,
  optionLabel,
  optionNote,
  ownerBrandOption,
  OWNER_INTRO_BOTH,
  OWNER_INTRO_BRAND,
  OWNER_INTRO_BRANDLESS,
  ownerIntroCopy,
  ownerProposalOptions,
  partneredPtCount,
  percentLabel,
  proposeBranchOf,
  ptDisplayName,
  ratesLine,
  stageLabel,
  terminateBrandCopy,
  terminateLegacyCopy,
  terminatedToast,
} from "../collaboration/brandPartnership";

const BR1 = { id: "brand-1", name: "Iron Temple" };
const BRANCHES = [
  { id: "g-a", name: "Iron Quận 1", city: "HCM", operationalStatus: "OPEN" },
  { id: "g-b", name: "Iron Quận 7", city: "HCM", operationalStatus: "TEMPORARILY_CLOSED" },
];

function brandRow(over: Record<string, unknown> = {}) {
  return {
    id: "ag-1",
    scope: "BRAND",
    brandId: BR1.id,
    brand: BR1,
    ptUserId: "pt-1",
    gymId: "g-a",
    gym: { id: "g-a", name: "Iron Quận 1", city: "HCM" },
    coveredBranches: BRANCHES,
    status: "ACCEPTED",
    proposedBy: "PT",
    round: 1,
    proposedPtRate: "0.6000",
    proposedGymRate: "0.3000",
    platformRate: "0.1000",
    expiresAt: "2026-12-01T00:00:00.000Z",
    acceptedAt: "2026-10-01T00:00:00.000Z",
    terminationInitiatedAt: null,
    effectiveAt: null,
    terminatedAt: null,
    note: null,
    updatedAt: "2026-10-02T00:00:00.000Z",
    ...over,
  };
}

function legacyRow(over: Record<string, unknown> = {}) {
  return {
    id: "lg-1",
    scope: "BRANCH",
    gymId: "g-a",
    gym: { id: "g-a", name: "Iron Quận 1", city: "HCM" },
    brand: BR1,
    ptUserId: "pt-1",
    status: "ACCEPTED",
    proposedBy: "GYM",
    round: 1,
    proposedPtRate: "0.5500",
    proposedGymRate: "0.3500",
    platformRate: "0.1000",
    supersededByAgreementId: null,
    effectiveAt: null,
    terminationInitiatedAt: null,
    note: null,
    ...over,
  };
}

describe("formatting", () => {
  it("percentLabel never turns a missing rate into 0%", () => {
    assert.equal(percentLabel("0.6000"), "60%");
    assert.equal(percentLabel("0.325"), "32.5%");
    assert.equal(percentLabel(null), "—");
    assert.equal(percentLabel(""), "—");
    assert.equal(percentLabel("abc"), "—");
  });
  it("dateVi and ptDisplayName", () => {
    assert.equal(dateVi("2026-10-31T10:00:00.000Z").length, 10);
    assert.equal(dateVi(null), "");
    assert.equal(dateVi("nope"), "");
    assert.equal(ptDisplayName({ firstName: "An", lastName: "Nguyễn" }), "An Nguyễn");
    assert.equal(ptDisplayName({ firstName: "An" }), "An");
    // never an email or an id
    assert.equal(ptDisplayName({ email: "a@b.c", userId: "2c076a2e-1111" }), PT_NAME_FALLBACK);
    assert.equal(ptDisplayName(null), PT_NAME_FALLBACK);
  });
  it("ratesLine is one line for one set of terms", () => {
    assert.equal(ratesLine({ pt: "60%", gym: "30%", platform: "10%" }), "PT 60% · Gym 30% · Nền tảng 10%");
  });
});

describe("stages and labels (brand agreement)", () => {
  const build = (row: any, viewer: "PT" | "GYM" = "PT") => buildPartnershipSections([row], viewer);

  it("pending: the side that did not propose must answer; the proposer waits", () => {
    const mine = build(brandRow({ status: "PENDING", proposedBy: "GYM" }), "PT");
    assert.equal(mine.needsReply.length, 1);
    const c = mine.needsReply[0] as any;
    assert.equal(c.stage, "MY_TURN");
    assert.equal(c.label, "Bạn cần trả lời");
    assert.equal(c.canRespond, true);
    assert.equal(c.canTerminate, false);

    const theirs = build(brandRow({ status: "COUNTERED", proposedBy: "PT" }), "PT");
    assert.equal(theirs.needsReply.length, 0);
    const t = theirs.current[0] as any;
    assert.equal(t.stage, "THEIR_TURN");
    assert.equal(t.label, "Chờ thương hiệu trả lời");
    assert.equal(t.canRespond, false);
    assert.equal(((build(brandRow({ status: "PENDING", proposedBy: "GYM" }), "GYM").current[0]) as any).label, "Chờ huấn luyện viên trả lời");
  });

  it("active: 'Đang hợp tác', can terminate, no notice line", () => {
    const c = build(brandRow()).current[0] as any;
    assert.equal(c.stage, "ACTIVE");
    assert.equal(c.label, "Đang hợp tác");
    assert.equal(c.canTerminate, true);
    assert.equal(c.noticeLine, null);
    assert.equal(c.canRepartner, false);
  });

  it("terminating: ACCEPTED + termination started -> 'Đang chấm dứt — hiệu lực đến <date>' with the SERVER's effective date, no second terminate", () => {
    const eff = "2026-11-01T10:00:00.000Z";
    const c = build(brandRow({ terminationInitiatedAt: "2026-10-18T10:00:00.000Z", effectiveAt: eff })).current[0] as any;
    assert.equal(c.stage, "TERMINATING");
    assert.equal(c.label, `Đang chấm dứt — hiệu lực đến ${dateVi(eff)}`);
    assert.equal(c.effectiveDate, dateVi(eff));
    assert.ok(c.noticeLine.includes(dateVi(eff)));
    assert.ok(c.noticeLine.includes("Hợp đồng mới đã bị chặn"));
    assert.equal(c.canTerminate, false);
    assert.equal(c.canRepartner, false);
  });

  it("B44: the explicit lifecycle + terminationEffectiveAt win over the old heuristics", () => {
    const eff = "2026-11-05T10:00:00.000Z";
    const c = build(brandRow({ lifecycle: "TERMINATING", terminationEffectiveAt: eff })).current[0] as any;
    assert.equal(c.stage, "TERMINATING");
    assert.equal(c.label, `Đang chấm dứt — hiệu lực đến ${dateVi(eff)}`);
    assert.equal(c.canTerminate, false);
    // lifecycle ACTIVE with a stale effectiveAt is still an active agreement.
    const a = build(brandRow({ lifecycle: "ACTIVE", effectiveAt: eff })).current[0] as any;
    assert.equal(a.stage, "ACTIVE");
  });

  it("terminated: goes to the ended section; re-partner only on the newest ended row and only when nothing is live", () => {
    const old = brandRow({ id: "ag-old", status: "TERMINATED", terminatedAt: "2026-09-01T00:00:00.000Z" });
    const newer = brandRow({ id: "ag-new", status: "TERMINATED", terminatedAt: "2026-10-05T00:00:00.000Z" });
    const s = buildPartnershipSections([old, newer], "PT");
    assert.equal(s.ended.length, 2);
    const byId = Object.fromEntries(s.ended.map((c: any) => [c.id, c]));
    assert.equal(byId["ag-new"].canRepartner, true);
    assert.equal(byId["ag-old"].canRepartner, false);
    assert.equal(byId["ag-new"].label, "Đã chấm dứt");

    // once a new proposal is running, no re-partner button anywhere
    const withLive = buildPartnershipSections([newer, brandRow({ id: "ag-live", status: "PENDING", proposedBy: "PT" })], "PT");
    assert.ok(withLive.ended.every((c: any) => c.canRepartner === false));
    assert.equal(withLive.current.length, 1);
  });

  it("rejected and expired are ended, with their own labels, and offer no actions", () => {
    const s = buildPartnershipSections([brandRow({ id: "r", status: "REJECTED" }), brandRow({ id: "e", status: "EXPIRED" })], "GYM");
    assert.deepEqual(s.ended.map((c: any) => c.label).sort(), ["Đã hết hạn", "Đã từ chối"]);
    assert.ok(s.ended.every((c: any) => !c.canRespond && !c.canTerminate && !c.canRepartner));
  });

  it("a brand agreement shows ONE rate table and the covered branches, with closed ones marked - no per-branch rate", () => {
    const c = build(brandRow()).current[0] as any;
    assert.deepEqual(c.rates, { pt: "60%", gym: "30%", platform: "10%" });
    assert.deepEqual(
      c.branches.map((b: any) => [b.name, b.closed]),
      [["Iron Quận 1", false], ["Iron Quận 7", true]],
    );
    assert.ok(c.branches.every((b: any) => !("rates" in b) && !("pt" in b)));
    assert.equal(c.proposeBranchId, "g-a", "prefers an open branch as the door of a propose call");
    assert.ok(COVERAGE_COPY.includes("mọi chi nhánh"));
    assert.equal(c.brandName, "Iron Temple");
  });

  it("missing brand name / branches degrade neutrally", () => {
    const c = build(brandRow({ brand: null, coveredBranches: undefined })).current[0] as any;
    assert.equal(c.brandName, "Thương hiệu");
    assert.deepEqual(c.branches, []);
    assert.equal(c.proposeBranchId, null);
  });

  it("stageLabel table", () => {
    assert.equal(stageLabel("ACTIVE", "GYM").tone, "success");
    assert.equal(stageLabel("TERMINATING", "GYM").tone, "warning");
    assert.equal(stageLabel("REJECTED", "GYM").tone, "danger");
  });
});

describe("two brands for one PT are independent", () => {
  it("each brand is its own card with its own terms and state", () => {
    const x = brandRow({ id: "ag-x", brandId: "brand-x", brand: { id: "brand-x", name: "Brand X" } });
    const y = brandRow({
      id: "ag-y",
      brandId: "brand-y",
      brand: { id: "brand-y", name: "Brand Y" },
      proposedPtRate: "0.5000",
      proposedGymRate: "0.4000",
      terminationInitiatedAt: "2026-10-18T00:00:00.000Z",
      effectiveAt: "2026-11-01T00:00:00.000Z",
    });
    const s = buildPartnershipSections([x, y], "PT");
    assert.equal(s.current.length, 2);
    const byId = Object.fromEntries(s.current.map((c: any) => [c.id, c]));
    assert.equal(byId["ag-x"].stage, "ACTIVE");
    assert.equal(byId["ag-x"].rates.pt, "60%");
    assert.equal(byId["ag-y"].stage, "TERMINATING");
    assert.equal(byId["ag-y"].rates.pt, "50%");
    // Brand X stays terminable; Y's termination does not leak into X.
    assert.equal(byId["ag-x"].canTerminate, true);
  });
});

describe("legacy per-branch terms and conflicts (D7) - shown truthfully, never merged or picked", () => {
  it("equal-rate legacy rows: one group, honest headline, offers a brand-wide agreement", () => {
    const a = legacyRow({ id: "lg-a", gymId: "g-a", gym: { id: "g-a", name: "Iron Quận 1", city: "HCM" } });
    const b = legacyRow({ id: "lg-b", gymId: "g-b", gym: { id: "g-b", name: "Iron Quận 7", city: "HCM" } });
    const s = buildPartnershipSections([a, b], "GYM");
    assert.equal(s.current.length, 1);
    const g = s.current[0] as any;
    assert.equal(g.kind, "LEGACY");
    assert.equal(g.headline, LEGACY_HEADLINE);
    assert.ok(g.headline.includes("cần ký thỏa thuận chung cho thương hiệu"));
    assert.equal(g.conflict, false);
    assert.equal(g.detail, LEGACY_SAME_DETAIL);
    assert.equal(g.rows.length, 2);
    assert.equal(g.canProposeJoint, true);
    assert.equal(g.proposeBranchId, "g-a");
  });

  it("different rates on two branches = conflict: each branch keeps ITS OWN rates, nothing is chosen for the brand", () => {
    const a = legacyRow({ id: "lg-a", gymId: "g-a", gym: { id: "g-a", name: "Iron Quận 1", city: "HCM" } });
    const b = legacyRow({
      id: "lg-b",
      gymId: "g-b",
      gym: { id: "g-b", name: "Iron Quận 7", city: "HCM" },
      proposedPtRate: "0.5000",
      proposedGymRate: "0.4000",
    });
    assert.equal(hasRateConflict([a, b]), true);
    const g = buildPartnershipSections([a, b], "PT").current[0] as any;
    assert.equal(g.conflict, true);
    assert.equal(g.detail, LEGACY_CONFLICT_DETAIL);
    const byBranch = Object.fromEntries(g.rows.map((r: any) => [r.branchName, r.rates.pt]));
    assert.deepEqual(byBranch, { "Iron Quận 1": "55%", "Iron Quận 7": "50%" });
    // no brand-level figure exists on the group at all
    assert.ok(!("rates" in g));
    assert.ok(g.rows.every((r: any) => r.label === "Điều khoản cũ đang áp dụng"));
  });

  it("a clean row next to one winding down is not described as 'different rates'", () => {
    const a = legacyRow({ id: "lg-a" });
    const b = legacyRow({ id: "lg-b", gymId: "g-b", effectiveAt: "2026-11-01T00:00:00.000Z", terminationInitiatedAt: "2026-10-18T00:00:00.000Z" });
    assert.equal(hasRateConflict([a, b]), false);
    const g = buildPartnershipSections([a, b], "PT").current[0] as any;
    assert.equal(g.detail, LEGACY_SAME_DETAIL);
    assert.equal(g.rows.find((r: any) => r.id === "lg-b").stage, "TERMINATING");
  });

  it("superseded and finished legacy rows are history and are not drawn", () => {
    const rows = [
      legacyRow({ id: "s", supersededByAgreementId: "ag-1" }),
      legacyRow({ id: "t", status: "TERMINATED" }),
      legacyRow({ id: "r", status: "REJECTED" }),
      legacyRow({ id: "x", status: "EXPIRED" }),
    ];
    const s = buildPartnershipSections(rows, "PT");
    assert.deepEqual([s.needsReply.length, s.current.length, s.ended.length], [0, 0, 0]);
  });

  it("once a brand agreement is live the legacy group no longer offers a second 'joint' proposal; superseded rows vanish", () => {
    const live = brandRow({ status: "PENDING", proposedBy: "PT" });
    const leg = legacyRow({ id: "lg-a" });
    const g = buildPartnershipSections([live, leg], "GYM").current.find((c) => c.kind === "LEGACY") as any;
    assert.equal(g.canProposeJoint, false);
    const after = buildPartnershipSections([brandRow(), legacyRow({ id: "lg-a", supersededByAgreementId: "ag-1" })], "GYM");
    assert.equal(after.current.length, 1);
    assert.equal(after.current[0].kind, "BRAND");
  });

  it("an open legacy offer at a BRANDED gym can only be rejected (server refuses accept/counter with 409)", () => {
    const open = legacyRow({ id: "lg-o", status: "PENDING", proposedBy: "PT" });
    const g = buildPartnershipSections([open], "GYM").needsReply[0] as any;
    assert.equal(g.rows[0].canReject, true);
    assert.equal(g.rows[0].canAcceptOrCounter, false);
    assert.equal(g.rows[0].canTerminate, false);
  });

  it("a legacy offer at a BRANDLESS gym keeps the whole old flow, and offers no brand-wide proposal", () => {
    const open = legacyRow({ id: "lg-o", status: "PENDING", proposedBy: "PT", brand: null });
    const g = buildPartnershipSections([open], "GYM").needsReply[0] as any;
    assert.equal(g.branded, false);
    assert.equal(g.headline, LEGACY_BRANDLESS_HEADLINE);
    assert.equal(g.headline, BRANCH_AGREEMENT_LABEL);
    assert.equal(g.detail, BRANDLESS_DETAIL);
    assert.equal(g.rows[0].canAcceptOrCounter, true);
    assert.equal(g.canProposeJoint, false);
    assert.equal(g.brandName, "Iron Quận 1");
  });

  it("an ACCEPTED legacy row can be ended, and the row says it ends at once (no notice period)", () => {
    const g = buildPartnershipSections([legacyRow()], "PT").current[0] as any;
    assert.equal(g.rows[0].canTerminate, true);
    assert.equal(g.rows[0].terminatesImmediately, true);
    assert.ok(terminateLegacyCopy("Iron Quận 1").lines[0].includes("NGAY"));
  });

  it("legacy rows of different PTs stay in different groups", () => {
    const s = buildPartnershipSections([legacyRow({ id: "a", ptUserId: "pt-1" }), legacyRow({ id: "b", ptUserId: "pt-2" })], "GYM");
    assert.equal(s.current.length, 2);
  });
});

describe("sections and ordering", () => {
  it("needs-reply first, then current (active before winding down before waiting before old terms), ended last", () => {
    const rows = [
      brandRow({ id: "ag-wait", brandId: "b-wait", brand: { id: "b-wait", name: "W" }, status: "PENDING", proposedBy: "PT" }),
      brandRow({ id: "ag-act", brandId: "b-act", brand: { id: "b-act", name: "A" } }),
      brandRow({ id: "ag-term", brandId: "b-term", brand: { id: "b-term", name: "T" }, terminationInitiatedAt: "2026-10-18T00:00:00Z", effectiveAt: "2026-11-01T00:00:00Z" }),
      brandRow({ id: "ag-me", brandId: "b-me", brand: { id: "b-me", name: "M" }, status: "COUNTERED", proposedBy: "GYM" }),
      brandRow({ id: "ag-end", brandId: "b-end", brand: { id: "b-end", name: "E" }, status: "TERMINATED" }),
      legacyRow({ id: "lg-1", ptUserId: "pt-9" }),
    ];
    const s = buildPartnershipSections(rows, "PT");
    assert.deepEqual(s.needsReply.map((c: any) => c.id), ["ag-me"]);
    assert.deepEqual(s.current.map((c: any) => c.id ?? c.kind), ["ag-act", "ag-term", "ag-wait", "LEGACY"]);
    assert.deepEqual(s.ended.map((c: any) => c.id), ["ag-end"]);
  });

  it("garbage input never throws", () => {
    assert.deepEqual(buildPartnershipSections(null, "PT"), { needsReply: [], current: [], ended: [] });
    assert.deepEqual(buildPartnershipSections([null, {}, { id: null }], "GYM"), { needsReply: [], current: [], ended: [] });
  });
});

describe("dashboard counts", () => {
  it("partneredPtCount: a brand agreement counts at EVERY branch of the brand, not only the representative one", () => {
    const rows = [brandRow(), brandRow({ id: "ag-2", ptUserId: "pt-2" }), brandRow({ id: "ag-3", ptUserId: "pt-3", brandId: "other" })];
    assert.equal(partneredPtCount(rows, { id: "g-a", brandId: BR1.id }), 2);
    assert.equal(partneredPtCount(rows, { id: "g-b", brandId: BR1.id }), 2, "a non-representative branch counts the same");
    assert.equal(partneredPtCount(rows, { id: "g-x", brandId: "other" }), 1);
  });
  it("partneredPtCount: distinct trainers; winding down, pending and superseded legacy rows do not count; legacy counts at its own branch only", () => {
    const rows = [
      brandRow({ ptUserId: "pt-1" }),
      legacyRow({ id: "l1", ptUserId: "pt-1", gymId: "g-a" }),
      legacyRow({ id: "l2", ptUserId: "pt-4", gymId: "g-a" }),
      legacyRow({ id: "l3", ptUserId: "pt-5", gymId: "g-b" }),
      legacyRow({ id: "l4", ptUserId: "pt-6", gymId: "g-a", supersededByAgreementId: "ag-1" }),
      brandRow({ id: "ag-t", ptUserId: "pt-7", terminationInitiatedAt: "2026-10-18T00:00:00Z", effectiveAt: "2026-11-01T00:00:00Z" }),
      brandRow({ id: "ag-p", ptUserId: "pt-8", status: "PENDING" }),
    ];
    assert.equal(partneredPtCount(rows, { id: "g-a", brandId: BR1.id }), 2, "pt-1 (once) + pt-4");
    assert.equal(partneredPtCount(rows, null), 0);
    assert.equal(partneredPtCount(null, { id: "g-a", brandId: BR1.id }), 0);
  });
  it("awaitingMyReplyCount only counts offers whose turn is mine (not my own proposals, not superseded legacy)", () => {
    const rows = [
      brandRow({ id: "1", status: "PENDING", proposedBy: "PT" }),
      brandRow({ id: "2", status: "PENDING", proposedBy: "GYM", brandId: "b2", brand: { id: "b2", name: "B2" } }),
      legacyRow({ id: "3", status: "PENDING", proposedBy: "PT" }),
      legacyRow({ id: "4", status: "PENDING", proposedBy: "PT", supersededByAgreementId: "ag" }),
      brandRow({ id: "5" }),
    ];
    assert.equal(awaitingMyReplyCount(rows, "GYM"), 2);
    assert.equal(awaitingMyReplyCount(rows, "PT"), 1);
    assert.equal(awaitingMyReplyCount(undefined, "PT"), 0);
  });
});

describe("proposing - brand-level only", () => {
  it("brandOptionsFromGyms groups the public gym list by brand, lists brandless gyms as single-branch options AFTER the brands, sorts by name", () => {
    const gyms = [
      { id: "g1", name: "Z1", city: "HN", brand: { id: "bz", name: "Zeta" } },
      { id: "g2", name: "A1", city: "HCM", brand: { id: "ba", name: "Alpha" } },
      { id: "g3", name: "A2", city: "HCM", brand: { id: "ba", name: "Alpha" } },
      { id: "g4", name: "Solo", city: "HCM" },
    ];
    const opts = brandOptionsFromGyms(gyms);
    assert.deepEqual(opts.map((o) => o.brandName), ["Alpha", "Zeta", "Solo"]);
    assert.deepEqual(opts.map((o) => o.scope), ["BRAND", "BRAND", "BRANCH"]);
    assert.deepEqual(opts[0].branches.map((b) => b.name), ["A1", "A2"]);
    assert.equal(opts[0].proposeBranchId, "g2");
    // the brandless gym is its own option, addressed through that very gym, labelled as a single-branch deal
    assert.equal(opts[2].brandId, "branch:g4");
    assert.equal(opts[2].proposeBranchId, "g4");
    assert.equal(optionLabel(opts[2]), `${BRANCH_AGREEMENT_LABEL}: Solo`);
    assert.equal(optionLabel(opts[0]), "Alpha (2 chi nhánh)");
    assert.ok(optionNote(opts[2]).includes("NGAY"));
    assert.ok(optionNote(opts[0]).startsWith("Áp dụng cho: A1, A2"));
    assert.equal(brandOptionsFromGyms(null).length, 0);
  });
  it("ownerBrandOption lists only APPROVED branches of the owner's brand", () => {
    const gyms = [
      { id: "g1", name: "Một", status: "APPROVED", operationalStatus: "TEMPORARILY_CLOSED", brandId: "b", brand: { id: "b", name: "Mine" } },
      { id: "g2", name: "Hai", status: "APPROVED", operationalStatus: "OPEN", brandId: "b", brand: { id: "b", name: "Mine" } },
      { id: "g3", name: "Ba", status: "PENDING_REVIEW", operationalStatus: "OPEN", brandId: "b", brand: { id: "b", name: "Mine" } },
    ];
    const o = ownerBrandOption(gyms)!;
    assert.equal(o.brandName, "Mine");
    assert.deepEqual(o.branches.map((b) => b.id), ["g1", "g2"]);
    assert.equal(o.proposeBranchId, "g2", "prefers an open branch");
    assert.equal(ownerBrandOption([{ id: "g3", status: "PENDING_REVIEW", brandId: "b" }]), null);
    assert.equal(ownerBrandOption(undefined), null);
  });
  it("brandsBlockedForProposal: brands with an offer or agreement running for that PT", () => {
    const rows = [brandRow(), brandRow({ id: "x", brandId: "b-x", status: "TERMINATED" }), brandRow({ id: "y", brandId: "b-y", status: "PENDING" }), legacyRow()];
    assert.deepEqual([...brandsBlockedForProposal(rows)].sort(), ["b-y", "brand-1"]);
    assert.deepEqual([...brandsBlockedForProposal(rows, "someone-else")], []);
  });
  it("proposeBranchOf", () => {
    assert.equal(proposeBranchOf([]), null);
    assert.equal(proposeBranchOf([{ id: "a", name: "A", city: null, closed: true }, { id: "b", name: "B", city: null, closed: false }]), "b");
    assert.equal(proposeBranchOf([{ id: "a", name: "A", city: null, closed: true }]), "a");
  });
});

describe("copy", () => {
  it("terminate confirmation states: new contracts blocked now, server-set notice, signed contracts continue - per viewer", () => {
    const pt = terminateBrandCopy("PT", "Iron Temple");
    assert.equal(pt.title, "Chấm dứt hợp tác với Iron Temple?");
    assert.ok(pt.lines[0].includes("không nhận thêm hợp đồng mới"));
    assert.ok(pt.lines[1].includes("14 ngày"));
    assert.ok(pt.lines[2].includes("vẫn được thực hiện tiếp"));
    const gym = terminateBrandCopy("GYM", "");
    assert.ok(gym.title.includes(PT_NAME_FALLBACK));
    assert.ok(gym.lines[0].includes("thương hiệu của bạn"));
  });
  it("terminatedToast uses the server's effectiveAt; an immediate end says so; no date -> neutral", () => {
    assert.ok(terminatedToast({ status: "ACCEPTED", effectiveAt: "2026-11-01T00:00:00.000Z" }).includes(dateVi("2026-11-01T00:00:00.000Z")));
    assert.equal(terminatedToast({ status: "TERMINATED", effectiveAt: "2026-11-01T00:00:00.000Z" }), "Đã chấm dứt hợp tác.");
    assert.equal(terminatedToast({}), "Đã chấm dứt hợp tác.");
  });
  it("noticeLineFor", () => {
    assert.equal(noticeLineFor(null), null);
    assert.ok(noticeLineFor("2026-11-01T00:00:00.000Z")!.includes("chấm dứt hẳn vào ngày"));
  });
  it("no copy leaks an internal id, enum name or a per-branch rate on a brand card", () => {
    const c = buildPartnershipSections([brandRow()], "PT").current[0] as any;
    const blob = JSON.stringify([c.label, c.noticeLine, c.brandName, c.branches.map((b: any) => b.name)]);
    assert.ok(!/ACCEPTED|PENDING|TERMINATED|brand-1|pt-1/.test(blob));
    assert.equal(BRANCH_NAME_FALLBACK, "Chi nhánh");
  });
});

describe("brandless gym (D8: the branch-level agreement still works) - propose, status, terminate", () => {
  const solo = (over: Record<string, unknown> = {}) =>
    legacyRow({ id: "bl-1", brand: null, gymId: "solo-1", gym: { id: "solo-1", name: "Solo Gym", city: "HN" }, ...over });

  it("an ACCEPTED single-branch agreement is shown as 'Đang hợp tác' with its own rates, not as old terms; it ends immediately", () => {
    const g = buildPartnershipSections([solo()], "PT").current[0] as any;
    assert.equal(g.branded, false);
    assert.equal(g.headline, BRANCH_AGREEMENT_LABEL);
    assert.equal(g.canProposeJoint, false, "there is no brand to make a joint agreement with");
    const r = g.rows[0];
    assert.equal(r.label, "Đang hợp tác");
    assert.equal(r.ratesCaption, "Tỷ lệ của chi nhánh này");
    assert.equal(r.terminateLabel, "Chấm dứt hợp tác");
    assert.equal(r.canTerminate, true);
    assert.equal(r.terminatesImmediately, true);
    assert.ok(r.terminateCopy.title.startsWith("Chấm dứt hợp tác với Solo Gym"));
    assert.ok(r.terminateCopy.lines[0].includes("NGAY"));
    assert.ok(r.terminateCopy.lines[0].includes("chưa có thương hiệu"));
  });

  it("a branded legacy row keeps the 'old terms' wording", () => {
    const g = buildPartnershipSections([legacyRow()], "PT").current[0] as any;
    assert.equal(g.rows[0].label, "Điều khoản cũ đang áp dụng");
    assert.equal(g.rows[0].terminateLabel, "Chấm dứt điều khoản này");
    assert.ok(g.rows[0].terminateCopy.title.includes("điều khoản cũ"));
  });

  it("an open offer to a brandless gym can be accepted, countered and rejected (the old flow is intact)", () => {
    const g = buildPartnershipSections([solo({ status: "PENDING", proposedBy: "PT" })], "GYM").needsReply[0] as any;
    assert.equal(g.rows[0].canAcceptOrCounter, true);
    assert.equal(g.rows[0].canReject, true);
  });

  it("ownerProposalOptions: the brand AND each approved brandless gym as its own single-branch option", () => {
    const gyms = [
      { id: "g1", name: "Một", status: "APPROVED", operationalStatus: "OPEN", brandId: "b", brand: { id: "b", name: "Mine" } },
      { id: "s1", name: "Lẻ 1", status: "APPROVED", operationalStatus: "OPEN", brandId: null },
      { id: "s2", name: "Lẻ 2", status: "PENDING_REVIEW", brandId: null },
    ];
    const opts = ownerProposalOptions(gyms);
    assert.deepEqual(opts.map((o) => [o.scope, o.brandName, o.proposeBranchId]), [["BRAND", "Mine", "g1"], ["BRANCH", "Lẻ 1", "s1"]]);
    // only brandless: no brand option at all
    assert.deepEqual(ownerProposalOptions([gyms[1]]).map((o) => o.scope), ["BRANCH"]);
    assert.deepEqual(ownerProposalOptions(null), []);
  });

  it("ownerIntroCopy follows what the owner really has: brand only / brandless only / both; never claims a brand that is not there", () => {
    const brandGym = { id: "g1", name: "Một", status: "APPROVED", operationalStatus: "OPEN", brandId: "b", brand: { id: "b", name: "Mine" } };
    const soloGym = { id: "s1", name: "Lẻ 1", status: "APPROVED", operationalStatus: "OPEN", brandId: null };
    assert.equal(ownerIntroCopy(ownerProposalOptions([brandGym])), OWNER_INTRO_BRAND);
    assert.equal(ownerIntroCopy(ownerProposalOptions([soloGym])), OWNER_INTRO_BRANDLESS);
    assert.equal(ownerIntroCopy(ownerProposalOptions([brandGym, soloGym])), OWNER_INTRO_BOTH);
    assert.equal(ownerIntroCopy([]), OWNER_INTRO_BRAND, "nothing loaded yet keeps the brand rule");
    assert.ok(!/cả thương hiệu/.test(OWNER_INTRO_BRANDLESS) && /NGAY/.test(OWNER_INTRO_BRANDLESS));
    assert.ok(/NGAY/.test(OWNER_INTRO_BOTH) && /mọi chi nhánh/.test(OWNER_INTRO_BOTH));
  });

  it("brandsBlockedForProposal blocks a brandless branch that already has a live agreement or offer, not an ended one", () => {
    const rows = [solo(), solo({ id: "bl-2", gymId: "solo-2", status: "TERMINATED" }), solo({ id: "bl-3", gymId: "solo-3", supersededByAgreementId: "x" })];
    assert.deepEqual([...brandsBlockedForProposal(rows)], ["branch:solo-1"]);
    assert.deepEqual([...brandsBlockedForProposal(rows, "someone-else")], []);
    // a legacy row at a BRANDED gym does not block a brand proposal
    assert.deepEqual([...brandsBlockedForProposal([legacyRow()])], []);
  });

  it("an ended brandless agreement is history; the branch is offered again as a new proposal", () => {
    const s = buildPartnershipSections([solo({ status: "TERMINATED" })], "PT");
    assert.deepEqual([s.needsReply.length, s.current.length, s.ended.length], [0, 0, 0]);
    assert.equal(brandOptionsFromGyms([{ id: "solo-1", name: "Solo Gym", city: "HN" }]).length, 1);
  });
});
