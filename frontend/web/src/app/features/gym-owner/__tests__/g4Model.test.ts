/**
 * TEST FIXTURE (pure functions) - G4 "Đối tác PT": role -> screen, scope kind, URL, exact rate text, the rate-form sum mirror, the
 * segments / rows built from the SAME `buildPartnershipSections` the old panel uses, error sentences, PT check-in rows and limit note,
 * commission emptiness, and a CODE AUDIT of the source text (the manager and accountant screens never call `/owner/collaborations`).
 * Run: npx tsx --test src/app/features/gym-owner/__tests__/*.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMMISSION_FIELDS,
  PT_CHECKIN_WINDOW,
  buildPartnerRows,
  collabErrorMessage,
  collabErrorNeedsReload,
  findPartnerRow,
  isEmptyCommission,
  parseSegment,
  partnersScopeKind,
  partnersSearch,
  partnersViewFor,
  percentFieldFrom,
  ptCheckinNote,
  ptCheckinRows,
  ratePercent,
  ratesState,
  segmentCounts,
  segmentForKey,
} from "../partners/partnersModel";
import { canUseFeature } from "../../../utils/gymStaffRole";
import { flatNavFor, scopeKindForLocation } from "../../../components/layout/gym-owner/gymOwnerNav";

const BRANCHES = [{ id: "g1", name: "Gymini Quận 1", city: "TP.HCM", operationalStatus: "OPEN" }, { id: "g2", name: "Gymini Quận 7", city: "TP.HCM", operationalStatus: "TEMPORARILY_CLOSED" }];
const brandRow = (id: string, o: Record<string, unknown> = {}) => ({
  id, scope: "BRAND", brandId: "b1", brand: { id: "b1", name: "Gymini Fitness" }, ptUserId: `pt-${id}`, status: "ACCEPTED", proposedBy: "PT",
  proposedPtRate: "0.5500", proposedGymRate: "0.3500", platformRate: "0.1000", round: 1, coveredBranches: BRANCHES, updatedAt: "2026-11-20T00:00:00Z", ...o,
});
const legacyRow = (id: string, gymId: string, o: Record<string, unknown> = {}) => ({
  id, scope: "BRANCH", gymId, gym: { id: gymId, name: gymId === "g1" ? "Gymini Quận 1" : "Gymini Quận 7" }, brand: { id: "b1", name: "Gymini Fitness" }, ptUserId: "pt-legacy",
  status: "ACCEPTED", proposedBy: "GYM", proposedPtRate: "0.6000", proposedGymRate: "0.3000", platformRate: "0.1000", round: 1, updatedAt: "2026-11-01T00:00:00Z", ...o,
});

describe("roles and scope", () => {
  it("owner agreements, manager PT check-ins, accountant commission, receptionist and unknown nothing", () => {
    assert.equal(partnersViewFor("OWNER"), "agreements");
    assert.equal(partnersViewFor("MANAGER"), "checkins");
    assert.equal(partnersViewFor("ACCOUNTANT"), "commission");
    assert.equal(partnersViewFor("RECEPTIONIST"), "none");
    assert.equal(partnersViewFor(undefined), "none");
  });
  it("scope kind: owner brand, manager branch, accountant brand-or-branch", () => {
    assert.equal(partnersScopeKind("OWNER"), "brand");
    assert.equal(partnersScopeKind("MANAGER"), "branch");
    assert.equal(partnersScopeKind("ACCOUNTANT"), "brand-or-branch");
    assert.equal(partnersScopeKind("RECEPTIONIST"), "none");
    assert.equal(scopeKindForLocation("/gym-owner/collaborations", null, "OWNER"), "brand");
    assert.equal(scopeKindForLocation("/gym-owner/collaborations", null, "MANAGER"), "branch");
    assert.equal(scopeKindForLocation("/gym-owner/collaborations", "x", "ACCOUNTANT"), "brand-or-branch");
    assert.equal(scopeKindForLocation("/gym-owner/collaborations", null, undefined), "brand");
  });
  it("the sidebar entry exists for O, M, A and not for the receptionist; every one of them may use the V2 guard", () => {
    for (const r of ["OWNER", "MANAGER", "ACCOUNTANT"] as const) {
      assert.ok(flatNavFor(r).some((i) => i.id === "pt"), r);
      assert.equal(canUseFeature(r, "partners"), true, r);
    }
    assert.ok(!flatNavFor("RECEPTIONIST").some((i) => i.id === "pt"));
    assert.equal(canUseFeature("RECEPTIONIST", "partners"), false);
  });
});

describe("URL", () => {
  it("parseSegment falls back to active; partnersSearch drops the default and carries the agreement", () => {
    assert.equal(parseSegment("mine"), "mine");
    assert.equal(parseSegment("junk"), "active");
    assert.equal(parseSegment(null), "active");
    assert.equal(partnersSearch({ seg: "active" }), "");
    assert.equal(partnersSearch({ seg: "ended" }), "?seg=ended");
    assert.equal(partnersSearch({ seg: "mine", agreementId: "a1" }), "?seg=mine&agreement=a1");
    assert.equal(partnersSearch({ agreementId: "a1" }), "?agreement=a1");
  });
});

describe("rates: exact, never rounded to a different meaning", () => {
  it("shows the stored fraction as a percent with its real decimals", () => {
    assert.equal(ratePercent("0.5500"), "55%");
    assert.equal(ratePercent("0.1000"), "10%");
    assert.equal(ratePercent("0.3255"), "32,55%");
    assert.equal(ratePercent("0.325"), "32,5%");
    assert.equal(ratePercent(0.6), "60%");
    assert.equal(ratePercent(null), "—");
    assert.equal(ratePercent(""), "—");
    assert.equal(ratePercent("abc"), "—");
  });
  it("a form field is pre-filled exactly (the old panel rounded 32.55 to 33)", () => {
    assert.equal(percentFieldFrom("0.3255", "35"), "32.55");
    assert.equal(percentFieldFrom("0.5500", "55"), "55");
    assert.equal(percentFieldFrom(null, "35"), "35");
    assert.equal(percentFieldFrom("x", "35"), "35");
  });
  it("sum mirror: PT + phòng tập + 10 must be 100; body is four-decimal fractions; empty / junk never ok", () => {
    const ok = ratesState("55", "35");
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.body, { ptRate: "0.5500", gymRate: "0.3500", platformRate: "0.1000" });
    assert.equal(ratesState("33.3", "56.7").ok, true); // float-safe
    assert.deepEqual(ratesState("32.55", "57.45").body, { ptRate: "0.3255", gymRate: "0.5745", platformRate: "0.1000" });
    assert.equal(ratesState("55", "36").ok, false);
    assert.equal(ratesState("55", "36").body, null);
    assert.equal(ratesState("", "90").ok, false);
    assert.equal(ratesState("abc", "90").ok, false);
    assert.ok(Number.isNaN(ratesState("", "90").sum));
    assert.equal(ratesState("55", "35").sum, 100);
  });
});

describe("rows and segments (same cards as the old panel)", () => {
  const raw = [
    brandRow("a1", { proposedBy: "PT", status: "PENDING", round: 2, expiresAt: "2026-11-30T05:00:00Z" }), // owner must answer
    brandRow("a2", { proposedBy: "GYM", status: "PENDING", expiresAt: "2026-12-01T05:00:00Z" }), // waiting for the PT
    brandRow("a3", { proposedBy: "GYM", status: "ACCEPTED", acceptedAt: "2026-10-05T03:00:00Z", proposedPtRate: "0.3255", proposedGymRate: "0.5745" }),
    brandRow("a4", { status: "ACCEPTED", effectiveAt: "2026-12-05T00:00:00Z", terminationInitiatedAt: "2026-11-21T00:00:00Z", terminationEffectiveAt: "2026-12-05T00:00:00Z" }),
    brandRow("a5", { status: "TERMINATED", terminatedAt: "2026-09-01T00:00:00Z" }),
    brandRow("a6", { status: "REJECTED" }),
    brandRow("a7", { status: "EXPIRED" }),
    legacyRow("l1", "g1", { ptUserId: "pt-legacy" }),
    legacyRow("l2", "g2", { ptUserId: "pt-legacy", proposedPtRate: "0.5000", proposedGymRate: "0.4000" }),
  ];
  const rows = buildPartnerRows(raw);
  const by = (k: string) => findPartnerRow(rows, k)!;

  it("segments: mine / theirs / active (accepted + winding down + legacy) / ended (terminated, rejected, expired)", () => {
    assert.equal(by("a1").segment, "mine");
    assert.equal(by("a2").segment, "theirs");
    assert.equal(by("a3").segment, "active");
    assert.equal(by("a4").segment, "active");
    for (const k of ["a5", "a6", "a7"]) assert.equal(by(k).segment, "ended", k);
    assert.deepEqual(segmentCounts(rows), { active: 3, mine: 1, theirs: 1, ended: 3 });
  });
  it("status text comes from the panel (no enum), the round only while a turn is open, never a maximum", () => {
    assert.equal(by("a1").tag.text, "Bạn cần trả lời");
    assert.equal(by("a2").tag.text, "Chờ huấn luyện viên trả lời");
    assert.equal(by("a3").tag.text, "Đang hợp tác");
    assert.equal(by("a4").tag.text, "Đang chấm dứt");
    assert.equal(by("a1").roundText, "Vòng 2");
    assert.equal(by("a3").roundText, "—");
    for (const r of rows) assert.ok(!/\/\s*\d|tối đa/i.test(r.roundText), r.key);
  });
  it("rates are the stored values, exactly; a legacy pair with different rates has no single table", () => {
    assert.deepEqual(by("a1").rates, { pt: "55%", gym: "35%", platform: "10%" });
    assert.deepEqual(by("a3").rates, { pt: "32,55%", gym: "57,45%", platform: "10%" });
    const legacy = rows.find((r) => r.kind === "LEGACY")!;
    assert.equal(legacy.rates, null);
    assert.equal(legacy.segment, "active");
    assert.equal(legacy.tag.text, "Điều khoản cũ");
  });
  it("effect column reads the dates the row carries", () => {
    assert.equal(by("a3").effectText, "Từ 05/10/2026");
    assert.equal(by("a4").effectText, "Chấm dứt ngày 05/12/2026");
    assert.match(by("a1").effectText, /^Hạn trả lời 30\/11\/2026$/);
    assert.equal(by("a5").effectText, "Chấm dứt 01/09/2026");
    assert.equal(by("a6").effectText, "Đã từ chối");
    assert.equal(by("a7").effectText, "Đã hết hạn");
  });
  it("a deep link shows the segment of the row; an unknown id keeps the chosen one", () => {
    assert.equal(segmentForKey(rows, "a5", "active"), "ended");
    assert.equal(segmentForKey(rows, "nope", "mine"), "mine");
    assert.equal(findPartnerRow(rows, "nope"), null);
    assert.equal(findPartnerRow(rows, null), null);
  });
  it("nothing in a row is an internal id or a code", () => {
    for (const r of rows) {
      const text = JSON.stringify([r.scopeLine, r.tag, r.roundText, r.effectText]);
      assert.ok(!/pt-a\d|ACCEPTED|PENDING|COUNTERED|TERMINATED|EXPIRED|REJECTED/.test(text), r.key);
    }
  });
  it("a legacy offer from the PT waits for the owner (mine); a legacy offer of the owner waits for the PT (theirs)", () => {
    const m = buildPartnerRows([legacyRow("l9", "g1", { status: "PENDING", proposedBy: "PT", ptUserId: "pt-x" })]);
    assert.equal(m[0].segment, "mine");
    assert.equal(m[0].tag.text, "Bạn cần trả lời");
    const t = buildPartnerRows([legacyRow("l8", "g1", { status: "PENDING", proposedBy: "GYM", ptUserId: "pt-y" })]);
    assert.equal(t[0].segment, "theirs");
  });
  it("empty and junk input never throws", () => {
    assert.deepEqual(buildPartnerRows(null), []);
    assert.deepEqual(buildPartnerRows([null, {}, { id: 5 }]), []);
    assert.deepEqual(segmentCounts([]), { active: 0, mine: 0, theirs: 0, ended: 0 });
  });
});

describe("errors in plain Vietnamese", () => {
  const http = (status: number, error?: unknown) => ({ response: { status, data: { error } } });
  it("uses the server sentence and turns enum words into plain text", () => {
    assert.equal(collabErrorMessage(http(400, { code: "RATES_MUST_SUM_TO_ONE", message: "Tổng ba tỷ lệ phải bằng đúng 1, hiện là 0.9" })), "Tổng ba tỷ lệ phải bằng đúng 1, hiện là 0.9");
    assert.equal(collabErrorMessage(http(409, { message: "Không thể phản hồi đề xuất ở trạng thái ACCEPTED" })), "Không thể phản hồi đề xuất ở trạng thái đang hợp tác");
  });
  it("falls back by status, never to a raw code or the word 'undefined'", () => {
    assert.match(collabErrorMessage(http(403)), /chủ phòng tập/);
    assert.match(collabErrorMessage(http(409)), /Tải lại/);
    assert.match(collabErrorMessage(http(404)), /Không tìm thấy/);
    assert.match(collabErrorMessage(http(500)), /Thử lại/);
    assert.match(collabErrorMessage(null), /Thử lại/);
    for (const s of [400, 403, 409, 500]) assert.ok(!/undefined|\[object|[A-Z_]{6,}/.test(collabErrorMessage(http(s))), String(s));
  });
  it("only 404 / 409 ask for a reload", () => {
    assert.equal(collabErrorNeedsReload(http(409)), true);
    assert.equal(collabErrorNeedsReload(http(404)), true);
    assert.equal(collabErrorNeedsReload(http(500)), false);
    assert.equal(collabErrorNeedsReload(http(403)), false);
  });
});

describe("manager PT check-ins", () => {
  const rawCheckins = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, ptName: `PT ${i}`, localDate: "2026-11-22", firstScanAt: `2026-11-22T0${i % 9}:00:00Z`, lastScanAt: `2026-11-22T0${i % 9}:30:00Z`, scanCount: 1 + (i % 3) }));
  it("newest first, names only, a row without a name reads Huấn luyện viên", () => {
    const rows = ptCheckinRows([{ id: "x", ptName: "  ", firstScanAt: "2026-11-22T01:00:00Z", localDate: "2026-11-22", scanCount: 2 }, ...rawCheckins(3)]);
    assert.equal(rows.length, 4);
    assert.ok(rows.some((r) => r.ptName === "Huấn luyện viên"));
    const times = rows.map((r) => r.firstScanAt);
    assert.deepEqual([...times].sort().reverse(), times);
    assert.match(rows[0].when, /^\d{2}:\d{2} · 22\/11\/2026$/);
  });
  it("the note always states the 50-row limit; it says 'cut' only at the cap", () => {
    assert.match(ptCheckinNote(3), /giới hạn 50/);
    assert.ok(!/không hiện ở đây/.test(ptCheckinNote(49)));
    assert.match(ptCheckinNote(PT_CHECKIN_WINDOW), /chỉ trả 50 lượt gần nhất/);
    assert.match(ptCheckinNote(PT_CHECKIN_WINDOW), /chưa phân trang/);
  });
  it("junk in, empty out", () => {
    assert.deepEqual(ptCheckinRows(null), []);
    assert.deepEqual(ptCheckinRows({ data: [] }), []);
  });
});

describe("accountant commission", () => {
  it("labels follow audit/03: 'paid' is a release to the PT's balance, never 'đã chi'", () => {
    assert.deepEqual(COMMISSION_FIELDS.map((f) => f.key), ["expected", "recorded", "paid", "clawedBack"]);
    const paid = COMMISSION_FIELDS.find((f) => f.key === "paid")!;
    assert.equal(paid.label, "Đã giải phóng cho PT");
    assert.match(paid.hint, /chưa phải đã chuyển vào ngân hàng/);
  });
  it("emptiness needs all totals at zero and no month", () => {
    const zero = { expected: 0, recorded: 0, paid: 0, clawedBack: 0, referralCount: 0 };
    assert.equal(isEmptyCommission({ totals: zero, byMonth: [] }), true);
    assert.equal(isEmptyCommission({ totals: { ...zero, expected: 1 }, byMonth: [] }), false);
    assert.equal(isEmptyCommission({ totals: zero, byMonth: [{ month: "2026-11", ...zero }] }), false);
  });
});

describe("CODE AUDIT of the source text", () => {
  const src = (f: string) => readFileSync(new URL(`../partners/${f}`, import.meta.url), "utf8");
  it("only AgreementsView calls the owner-only collaborations endpoints; manager and accountant screens never do", () => {
    assert.match(src("AgreementsView.tsx"), /listForOwner/);
    for (const f of ["CheckinsView.tsx", "CommissionView.tsx", "PartnersPage.tsx"]) assert.ok(!/listForOwner|collaborationService|owner\/collaborations/.test(src(f).replace(/\/\*\*[\s\S]*?\*\//g, "")), f);
  });
  it("the manager screen reads pt-checkins, the accountant screen reads pt-commission, and neither shows a PT contract or wallet", () => {
    assert.match(src("CheckinsView.tsx"), /listPtCheckins/);
    assert.match(src("CommissionView.tsx"), /getPtCommissionSummary/);
    for (const f of ["CheckinsView.tsx", "CommissionView.tsx", "AgreementsView.tsx", "AgreementDrawer.tsx", "ProposeDrawer.tsx"]) assert.ok(!/ptContract|PTWallet|walletService|getPTWallet|listContracts/.test(src(f)), f);
  });
  it("the success check is drawn only after an awaited call (no mutate().then / onSettled)", () => {
    for (const f of ["AgreementDrawer.tsx", "ProposeDrawer.tsx"]) {
      const s = src(f);
      assert.ok(/await \w+\.mutateAsync/.test(s), f);
      assert.ok(!/onSettled/.test(s), f);
    }
  });
});
