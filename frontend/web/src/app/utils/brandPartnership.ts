/**
 * Phase 1 (cuối) - the pure half of the PT <-> Gym partnership UI, now that the agreement lives at the
 * BRAND level (gym-service `GymBrandPtAgreement`, decisions D5-D9, D72).
 *
 * What the screens must say, and never get wrong:
 *  - ONE PT + ONE brand = ONE agreement, and ONE set of terms for every open branch. A brand agreement
 *    lists the branches it covers; it never shows a rate per branch.
 *  - Termination is a NOTICE: new contracts stop at once, the effective date is chosen by the SERVER
 *    (default 14 days) and read back from `effectiveAt`. This module never computes that date.
 *  - Old per-branch terms ("legacy", scope BRANCH) are shown as what they are. They are never merged and
 *    no rate is ever picked for the brand: a pair whose live legacy rows disagree on the rate is a
 *    CONFLICT (D7) and each branch keeps its own old terms until a brand-wide agreement is signed.
 *  - Who may see terms is decided by the server (branch managers get 403); nothing here widens it.
 *
 * Input rows are what `GET /me/collaborations` / `GET /owner/collaborations` return: brand agreements
 * (`scope: "BRAND"`, `brand`, `coveredBranches`, `terminationInitiatedAt`, `effectiveAt`) next to legacy
 * branch rows (`scope: "BRANCH"`, `gym`, `supersededByAgreementId`). Anything missing degrades to a
 * neutral reading rather than a guess.
 *
 * Kept byte-identical with frontend/mobile/src/features/collaboration/brandPartnership.ts.
 */

export type Viewer = "PT" | "GYM";
export type Tone = "success" | "warning" | "danger" | "neutral" | "info";

/** Shown instead of an internal id whenever a trainer's name is unknown. */
export const PT_NAME_FALLBACK = "Huấn luyện viên";
export const BRAND_NAME_FALLBACK = "Thương hiệu";
export const BRANCH_NAME_FALLBACK = "Chi nhánh";

/**
 * DISPLAY ONLY. The notice period is decided and applied by gym-service
 * (COLLABORATION_TERMINATION_NOTICE_DAYS, default 14, decision D9); the app sends no date and reads the
 * real one back from `effectiveAt`. This number only words the warning before the user confirms.
 */
export const DEFAULT_NOTICE_DAYS_COPY = 14;

export const COVERAGE_COPY =
  "Một bộ điều khoản duy nhất, áp dụng cho mọi chi nhánh đang mở của thương hiệu (kể cả chi nhánh mở sau này).";
export const LEGACY_HEADLINE = "Điều khoản cũ theo chi nhánh — cần ký thỏa thuận chung cho thương hiệu";
export const LEGACY_CONFLICT_DETAIL =
  "Các chi nhánh đang áp tỷ lệ khác nhau. Hệ thống không tự chọn một tỷ lệ cho cả thương hiệu: mỗi chi nhánh giữ điều khoản cũ của mình cho tới khi hai bên ký một thỏa thuận chung.";
export const LEGACY_SAME_DETAIL =
  "Mỗi chi nhánh vẫn áp điều khoản đã ký trước đây. Ký thỏa thuận chung để cả thương hiệu dùng một bộ điều khoản.";
/** A gym with NO brand keeps the branch-level agreement of old (D8): a single-branch deal, ended at once. */
export const BRANCH_AGREEMENT_LABEL = "Thỏa thuận với chi nhánh (phòng gym chưa có thương hiệu)";
export const LEGACY_BRANDLESS_HEADLINE = BRANCH_AGREEMENT_LABEL;
export const BRANDLESS_DETAIL =
  "Phòng gym này chưa có thương hiệu nên thỏa thuận chỉ áp dụng riêng cho chi nhánh này. Khi chấm dứt, hiệu lực là NGAY (không có thời gian báo trước).";
export const BRANDLESS_PROPOSE_NOTE =
  "Chỉ áp dụng riêng cho chi nhánh này (phòng gym chưa có thương hiệu). Khi chấm dứt, hiệu lực là NGAY.";
export const LEGACY_OPEN_OFFER_NOTE =
  "Đề xuất cũ theo chi nhánh: chỉ có thể từ chối. Hãy gửi đề xuất mới cho cả thương hiệu.";
export const SIGNED_CONTRACTS_NOTE =
  "Hợp đồng đã ký giữ nguyên tỷ lệ lúc ký; thỏa thuận mới hay chấm dứt không làm đổi chúng.";

// --- small helpers -----------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "20/12/2026" from an ISO timestamp; "" when it is not a date. */
export function dateVi(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "60%" / "32.5%"; "—" when the rate is absent (never "0%", which would claim someone gets nothing). */
export function percentLabel(rate: unknown): string {
  if (rate == null || rate === "") return "—";
  const n = Number(rate);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 1000) / 10}%`;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A trainer's display name from a profile row; never an email or an id. */
export function ptDisplayName(profile: any): string {
  const name = [profile?.firstName, profile?.lastName].filter((p) => typeof p === "string" && p.trim()).join(" ").trim();
  return name || PT_NAME_FALLBACK;
}

// --- types -------------------------------------------------------------------------------------

export type Stage = "MY_TURN" | "THEIR_TURN" | "ACTIVE" | "TERMINATING" | "TERMINATED" | "REJECTED" | "EXPIRED";

export type RateTriple = { pt: string; gym: string; platform: string };

export type BranchView = { id: string; name: string; city: string | null; closed: boolean };

export interface BrandAgreementView {
  kind: "BRAND";
  id: string;
  brandId: string;
  brandName: string;
  ptUserId: string;
  stage: Stage;
  label: string;
  tone: Tone;
  rates: RateTriple;
  /** Raw fractions ("0.6000") for pre-filling the counter-offer form. */
  raw: { pt: string | null; gym: string | null; platform: string | null };
  proposedBy: Viewer | null;
  round: number;
  expiresAt: string | null;
  /** Effective date of a started termination, formatted; "" when none. */
  effectiveDate: string;
  terminatedDate: string;
  note: string | null;
  branches: BranchView[];
  /** A branch the server accepts as the "door" for a propose call on this brand; null when there is none. */
  proposeBranchId: string | null;
  canRespond: boolean;
  canTerminate: boolean;
  canRepartner: boolean;
  noticeLine: string | null;
}

export interface LegacyRowView {
  id: string;
  branchId: string;
  branchName: string;
  city: string | null;
  stage: Stage;
  label: string;
  tone: Tone;
  rates: RateTriple;
  proposedBy: Viewer | null;
  round: number;
  effectiveDate: string;
  note: string | null;
  /** Answering: a legacy offer at a BRANDED gym can only be turned down (server: 409 otherwise). */
  canReject: boolean;
  canAcceptOrCounter: boolean;
  canTerminate: boolean;
  /** The server ends a legacy row at once (its default is not the brand's notice period). */
  terminatesImmediately: true;
  /** Caption before the rate line: old terms of a branded gym, or the real terms of a brandless branch. */
  ratesCaption: string;
  terminateLabel: string;
  terminateCopy: { title: string; lines: string[] };
  raw: { pt: string | null; gym: string | null; platform: string | null };
}

export interface LegacyGroupView {
  kind: "LEGACY";
  key: string;
  brandId: string | null;
  brandName: string;
  ptUserId: string;
  branded: boolean;
  /** True when the live legacy rows of this pair do not share one rate table (D7). */
  conflict: boolean;
  headline: string;
  detail: string;
  rows: LegacyRowView[];
  /** Offer a brand-wide agreement from here. */
  canProposeJoint: boolean;
  proposeBranchId: string | null;
  needsReply: boolean;
}

export type PartnershipCard = BrandAgreementView | LegacyGroupView;

export interface PartnershipSections {
  needsReply: PartnershipCard[];
  current: PartnershipCard[];
  ended: PartnershipCard[];
}

// --- stage / label -----------------------------------------------------------------------------

const asParty = (v: unknown): Viewer | null => (v === "PT" || v === "GYM" ? v : null);

function stageOf(row: any, viewer: Viewer): Stage {
  const status = str(row?.status);
  if (status === "PENDING" || status === "COUNTERED") {
    const by = asParty(row?.proposedBy);
    return by && by !== viewer ? "MY_TURN" : "THEIR_TURN";
  }
  if (status === "ACCEPTED") return row?.lifecycle === "TERMINATING" || row?.terminationInitiatedAt || row?.terminationEffectiveAt || row?.effectiveAt ? "TERMINATING" : "ACTIVE";
  if (status === "TERMINATED") return "TERMINATED";
  if (status === "REJECTED") return "REJECTED";
  return "EXPIRED";
}

export function stageLabel(stage: Stage, viewer: Viewer): { label: string; tone: Tone } {
  switch (stage) {
    case "MY_TURN":
      return { label: "Bạn cần trả lời", tone: "warning" };
    case "THEIR_TURN":
      return { label: viewer === "PT" ? "Chờ thương hiệu trả lời" : "Chờ huấn luyện viên trả lời", tone: "info" };
    case "ACTIVE":
      return { label: "Đang hợp tác", tone: "success" };
    case "TERMINATING":
      return { label: "Đang chấm dứt", tone: "warning" };
    case "TERMINATED":
      return { label: "Đã chấm dứt", tone: "neutral" };
    case "REJECTED":
      return { label: "Đã từ chối", tone: "danger" };
    default:
      return { label: "Đã hết hạn", tone: "neutral" };
  }
}

const rawRates = (row: any) => ({
  pt: row?.proposedPtRate != null ? String(row.proposedPtRate) : null,
  gym: row?.proposedGymRate != null ? String(row.proposedGymRate) : null,
  platform: row?.platformRate != null ? String(row.platformRate) : null,
});

const rateTriple = (row: any): RateTriple => ({
  pt: percentLabel(row?.proposedPtRate),
  gym: percentLabel(row?.proposedGymRate),
  platform: percentLabel(row?.platformRate),
});

/** "PT 60% · Gym 30% · Nền tảng 10%" - ONE line for ONE set of terms. */
export function ratesLine(r: RateTriple): string {
  return `PT ${r.pt} · Gym ${r.gym} · Nền tảng ${r.platform}`;
}

const OPEN_STATUSES = new Set(["PENDING", "COUNTERED", "ACCEPTED"]);

export function noticeLineFor(effectiveIso: unknown): string | null {
  const d = dateVi(effectiveIso);
  return d
    ? `Hợp đồng mới đã bị chặn. Thỏa thuận chấm dứt hẳn vào ngày ${d}; hợp đồng đã ký vẫn được thực hiện tiếp.`
    : null;
}

// --- branches ----------------------------------------------------------------------------------

export function coveredBranches(row: any): BranchView[] {
  const list = Array.isArray(row?.coveredBranches) ? row.coveredBranches : [];
  return list
    .filter((b: any) => str(b?.id))
    .map((b: any) => ({
      id: String(b.id),
      name: str(b?.name) || BRANCH_NAME_FALLBACK,
      city: str(b?.city) || null,
      closed: !!b?.operationalStatus && b.operationalStatus !== "OPEN",
    }));
}

/** Any APPROVED branch will do as the door of a propose call (the server resolves the brand from it); prefer an open one. */
export function proposeBranchOf(branches: BranchView[]): string | null {
  return (branches.find((b) => !b.closed) ?? branches[0])?.id ?? null;
}

// --- cards -------------------------------------------------------------------------------------

function brandNameOf(row: any): string {
  return str(row?.brand?.name) || BRAND_NAME_FALLBACK;
}

function toBrandView(row: any, viewer: Viewer, all: any[]): BrandAgreementView {
  const stage = stageOf(row, viewer);
  const { label, tone } = stageLabel(stage, viewer);
  const branches = coveredBranches(row);
  const brandId = str(row?.brandId) || str(row?.brand?.id);
  const ptUserId = str(row?.ptUserId);
  // Hợp tác lại: only on the newest ended agreement of the pair, and only when nothing else is live.
  const pair = all.filter((r) => r?.scope === "BRAND" && str(r?.brandId) === brandId && str(r?.ptUserId) === ptUserId);
  const anyLive = pair.some((r) => OPEN_STATUSES.has(str(r?.status)));
  const newestEnded = pair
    .filter((r) => str(r?.status) === "TERMINATED")
    .sort((a, b) => String(b?.terminatedAt ?? b?.updatedAt ?? "").localeCompare(String(a?.terminatedAt ?? a?.updatedAt ?? "")))[0];
  const proposeBranchId = proposeBranchOf(branches);
  return {
    kind: "BRAND",
    id: String(row.id),
    brandId,
    brandName: brandNameOf(row),
    ptUserId,
    stage,
    label,
    tone,
    rates: rateTriple(row),
    raw: rawRates(row),
    proposedBy: asParty(row?.proposedBy),
    round: Number(row?.round) || 1,
    expiresAt: row?.expiresAt ?? null,
    effectiveDate: dateVi(row?.terminationEffectiveAt ?? row?.effectiveAt),
    terminatedDate: dateVi(row?.terminatedAt),
    note: str(row?.note) || null,
    branches,
    proposeBranchId,
    canRespond: stage === "MY_TURN",
    canTerminate: stage === "ACTIVE",
    canRepartner: stage === "TERMINATED" && !anyLive && newestEnded?.id === row.id && !!proposeBranchId,
    noticeLine: stage === "TERMINATING" ? noticeLineFor(row?.terminationEffectiveAt ?? row?.effectiveAt) : null,
  };
}

/** A legacy branch row that still means something: live terms, or an offer still open. Everything else is history. */
function isLiveLegacy(row: any): boolean {
  if (row?.supersededByAgreementId) return false;
  const status = str(row?.status);
  return status === "PENDING" || status === "COUNTERED" || status === "ACCEPTED";
}

function toLegacyRow(row: any, viewer: Viewer, branded: boolean): LegacyRowView {
  const stage = stageOf(row, viewer);
  const base = stageLabel(stage, viewer);
  const label = stage === "ACTIVE" ? (branded ? "Điều khoản cũ đang áp dụng" : "Đang hợp tác") : base.label;
  const branchName = str(row?.gym?.name) || BRANCH_NAME_FALLBACK;
  return {
    id: String(row.id),
    branchId: str(row?.gymId) || str(row?.gym?.id),
    branchName,
    city: str(row?.gym?.city) || null,
    stage,
    label,
    tone: base.tone,
    rates: rateTriple(row),
    proposedBy: asParty(row?.proposedBy),
    round: Number(row?.round) || 1,
    effectiveDate: dateVi(row?.terminationEffectiveAt ?? row?.effectiveAt),
    note: str(row?.note) || null,
    canReject: stage === "MY_TURN",
    canAcceptOrCounter: stage === "MY_TURN" && !branded,
    canTerminate: stage === "ACTIVE",
    terminatesImmediately: true,
    ratesCaption: branded ? "Điều khoản cũ của riêng chi nhánh này" : "Tỷ lệ của chi nhánh này",
    terminateLabel: branded ? "Chấm dứt điều khoản này" : "Chấm dứt hợp tác",
    terminateCopy: terminateLegacyCopy(branchName, branded),
    raw: rawRates(row),
  };
}

/**
 * True when the live ACCEPTED legacy rows of one pair do not all carry the same rate table (D7). A pair that
 * merely mixes equal-rate rows with one already winding down is NOT called a rate conflict here: the copy
 * says "tỷ lệ khác nhau" and must stay true.
 */
export function hasRateConflict(rows: any[]): boolean {
  const accepted = rows.filter((r) => str(r?.status) === "ACCEPTED");
  if (accepted.length < 2) return false;
  const key = (r: any) => `${Number(r?.proposedPtRate)}|${Number(r?.proposedGymRate)}|${Number(r?.platformRate)}`;
  const first = key(accepted[0]);
  return accepted.some((r) => key(r) !== first);
}

function toLegacyGroup(rows: any[], viewer: Viewer, all: any[]): LegacyGroupView {
  const sample = rows[0];
  const brandId = str(sample?.brand?.id) || null;
  const branded = !!brandId;
  const ptUserId = str(sample?.ptUserId);
  const views = rows.map((r) => toLegacyRow(r, viewer, branded));
  const conflict = hasRateConflict(rows);
  const brandHasLiveAgreement =
    branded &&
    all.some(
      (r) =>
        r?.scope === "BRAND" && str(r?.brandId) === brandId && str(r?.ptUserId) === ptUserId && OPEN_STATUSES.has(str(r?.status)),
    );
  const proposeBranchId = views.map((v) => v.branchId).find(Boolean) ?? null;
  return {
    kind: "LEGACY",
    key: `legacy:${brandId ?? "none"}:${ptUserId}`,
    brandId,
    brandName: branded ? brandNameOf(sample) : str(sample?.gym?.name) || BRANCH_NAME_FALLBACK,
    ptUserId,
    branded,
    conflict,
    headline: branded ? LEGACY_HEADLINE : LEGACY_BRANDLESS_HEADLINE,
    detail: !branded ? BRANDLESS_DETAIL : conflict ? LEGACY_CONFLICT_DETAIL : LEGACY_SAME_DETAIL,
    rows: views,
    canProposeJoint: branded && !brandHasLiveAgreement && !!proposeBranchId,
    proposeBranchId,
    needsReply: views.some((v) => v.stage === "MY_TURN"),
  };
}

const activityOf = (c: PartnershipCard): string => (c.kind === "BRAND" ? c.id : c.key);

/**
 * Turn the raw API rows into the cards a screen draws, grouped in the order a person acts on them:
 * what needs an answer, what is current (waiting / active / winding down / old terms), what is over.
 * Superseded and finished legacy rows are history and are not drawn.
 */
export function buildPartnershipSections(rawRows: unknown, viewer: Viewer): PartnershipSections {
  const rows: any[] = (Array.isArray(rawRows) ? rawRows : []).filter((r: any) => r && r.id);
  const cards: PartnershipCard[] = [];

  for (const r of rows.filter((x) => x.scope === "BRAND")) cards.push(toBrandView(r, viewer, rows));

  const legacyLive = rows.filter((x) => x.scope !== "BRAND" && isLiveLegacy(x));
  const groups = new Map<string, any[]>();
  for (const r of legacyLive) {
    const key = `${str(r?.brand?.id) || "none"}:${str(r?.ptUserId)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const g of groups.values()) cards.push(toLegacyGroup(g, viewer, rows));

  const needsReply: PartnershipCard[] = [];
  const current: PartnershipCard[] = [];
  const ended: PartnershipCard[] = [];
  for (const c of cards) {
    if (c.kind === "LEGACY") (c.needsReply ? needsReply : current).push(c);
    else if (c.stage === "MY_TURN") needsReply.push(c);
    else if (c.stage === "TERMINATED" || c.stage === "REJECTED" || c.stage === "EXPIRED") ended.push(c);
    else current.push(c);
  }
  const weight = (c: PartnershipCard) => (c.kind === "LEGACY" ? 3 : c.stage === "ACTIVE" ? 0 : c.stage === "TERMINATING" ? 1 : 2);
  current.sort((a, b) => weight(a) - weight(b) || activityOf(a).localeCompare(activityOf(b)));
  return { needsReply, current, ended };
}

// --- counts for dashboards ---------------------------------------------------------------------

/**
 * Distinct trainers actually working with this branch: an ACCEPTED brand agreement covers EVERY branch of
 * its brand (the old `c.gymId === branch` filter only matched the "representative" branch the API puts in
 * `gymId`), plus ACCEPTED legacy rows of exactly this branch. Agreements already winding down are not counted.
 */
export function partneredPtCount(rawRows: unknown, gym: { id?: string | null; brandId?: string | null } | null | undefined): number {
  if (!gym) return 0;
  const pts = new Set<string>();
  for (const r of Array.isArray(rawRows) ? (rawRows as any[]) : []) {
    if (!r || str(r.status) !== "ACCEPTED" || r.lifecycle === "TERMINATING" || r.terminationInitiatedAt || r.terminationEffectiveAt || r.effectiveAt) continue;
    if (r.scope === "BRAND") {
      if (gym.brandId && str(r.brandId) === gym.brandId) pts.add(str(r.ptUserId));
    } else if (!r.supersededByAgreementId && str(r.gymId) === gym.id) {
      pts.add(str(r.ptUserId));
    }
  }
  pts.delete("");
  return pts.size;
}

/** Offers (brand or old per-branch) that are waiting for THIS side to answer - the number the banner promises. */
export function awaitingMyReplyCount(rawRows: unknown, viewer: Viewer): number {
  let n = 0;
  for (const r of Array.isArray(rawRows) ? (rawRows as any[]) : []) {
    if (!r || (r.scope !== "BRAND" && r.supersededByAgreementId)) continue;
    if (stageOf(r, viewer) === "MY_TURN") n += 1;
  }
  return n;
}

// --- proposing ---------------------------------------------------------------------------------

export interface BrandOption {
  /** "BRAND": a brand-wide agreement. "BRANCH": a brandless gym - the single-branch agreement of old (D8). */
  scope: "BRAND" | "BRANCH";
  /** For scope "BRANCH" this is `branch:<gymId>` so it can never collide with a brand id. */
  brandId: string;
  brandName: string;
  branches: BranchView[];
  proposeBranchId: string;
}

/**
 * What a trainer can approach, from the PUBLIC gym list (`GET /gyms`: APPROVED + OPEN branches, each with
 * `brand`). A branded gym is grouped under its BRAND (a new agreement is made with the brand, never with one
 * branch - D72). A gym with NO brand is offered as its own single-branch option, because the backend still runs
 * the branch-level agreement for it (D8); it is labelled as such and never presented as brand-wide.
 */
export function brandOptionsFromGyms(rawGyms: unknown): BrandOption[] {
  const byBrand = new Map<string, BrandOption>();
  const solo: BrandOption[] = [];
  for (const g of Array.isArray(rawGyms) ? (rawGyms as any[]) : []) {
    const brandId = str(g?.brand?.id) || str(g?.brandId);
    if (!str(g?.id)) continue;
    if (!brandId) {
      const branch = { id: String(g.id), name: str(g?.name) || BRANCH_NAME_FALLBACK, city: str(g?.city) || null, closed: false };
      solo.push({ scope: "BRANCH", brandId: branchOptionId(branch.id), brandName: branch.name, branches: [branch], proposeBranchId: branch.id });
      continue;
    }
    const opt = byBrand.get(brandId) ?? {
      scope: "BRAND" as const,
      brandId,
      brandName: str(g?.brand?.name) || BRAND_NAME_FALLBACK,
      branches: [],
      proposeBranchId: String(g.id),
    };
    opt.branches.push({ id: String(g.id), name: str(g?.name) || BRANCH_NAME_FALLBACK, city: str(g?.city) || null, closed: false });
    byBrand.set(brandId, opt);
  }
  const byName = (a: BrandOption, b: BrandOption) => a.brandName.localeCompare(b.brandName, "vi");
  return [...[...byBrand.values()].sort(byName), ...solo.sort(byName)];
}

export const branchOptionId = (gymId: string) => `branch:${gymId}`;

/** Text of one entry in the "who to partner with" select. */
export function optionLabel(o: BrandOption): string {
  return o.scope === "BRANCH" ? `${BRANCH_AGREEMENT_LABEL}: ${o.brandName}` : `${o.brandName} (${o.branches.length} chi nhánh)`;
}

/** The line under the select: what the agreement will cover. */
export function optionNote(o: BrandOption): string {
  return o.scope === "BRANCH" ? BRANDLESS_PROPOSE_NOTE : `Áp dụng cho: ${o.branches.map((b) => b.name).join(", ")}.`;
}

/**
 * Everything an OWNER can invite a trainer into: their brand (one owner, one brand), plus each approved gym of
 * theirs that has NO brand (single-branch agreement of old).
 */
export function ownerProposalOptions(rawOwnedGyms: unknown): BrandOption[] {
  const brand = ownerBrandOption(rawOwnedGyms);
  const solo = (Array.isArray(rawOwnedGyms) ? (rawOwnedGyms as any[]) : [])
    .filter((g) => g?.id && g.status === "APPROVED" && !(str(g?.brandId) || str(g?.brand?.id)))
    .map<BrandOption>((g) => {
      const branch = { id: String(g.id), name: str(g.name) || BRANCH_NAME_FALLBACK, city: str(g.city) || null, closed: !!g.operationalStatus && g.operationalStatus !== "OPEN" };
      return { scope: "BRANCH", brandId: branchOptionId(branch.id), brandName: branch.name, branches: [branch], proposeBranchId: branch.id };
    });
  return [...(brand ? [brand] : []), ...solo];
}

/** The signed-in owner's own brand from `GET /owner/gyms` (one owner, one brand): only APPROVED branches can host a proposal. */
export function ownerBrandOption(rawOwnedGyms: unknown): BrandOption | null {
  const list = Array.isArray(rawOwnedGyms) ? (rawOwnedGyms as any[]) : [];
  const approved = list.filter((g) => g?.id && g.status === "APPROVED" && (str(g?.brandId) || str(g?.brand?.id)));
  if (approved.length === 0) return null;
  const brandId = str(approved[0].brandId) || str(approved[0].brand?.id);
  const branches = approved
    .filter((g) => (str(g.brandId) || str(g.brand?.id)) === brandId)
    .map((g) => ({
      id: String(g.id),
      name: str(g.name) || BRANCH_NAME_FALLBACK,
      city: str(g.city) || null,
      closed: !!g.operationalStatus && g.operationalStatus !== "OPEN",
    }));
  return {
    scope: "BRAND",
    brandId,
    brandName: str(approved[0].brand?.name) || BRAND_NAME_FALLBACK,
    branches,
    proposeBranchId: proposeBranchOf(branches) as string,
  };
}

export const OWNER_INTRO_BRAND =
  "Thỏa thuận được ký với cả thương hiệu của bạn và áp dụng một bộ tỷ lệ cho mọi chi nhánh đang mở.";
export const OWNER_INTRO_BRANDLESS =
  "Phòng gym của bạn chưa có thương hiệu nên mỗi thỏa thuận chỉ áp dụng riêng cho từng chi nhánh; khi chấm dứt, hiệu lực là NGAY (không có thời gian báo trước).";
export const OWNER_INTRO_BOTH =
  "Thỏa thuận với thương hiệu của bạn áp dụng một bộ tỷ lệ cho mọi chi nhánh đang mở; chi nhánh chưa có thương hiệu thì có thỏa thuận riêng và khi chấm dứt, hiệu lực là NGAY.";

/**
 * The owner-side intro sentence, from what the owner REALLY has (`ownerProposalOptions`): a brand only,
 * brandless gyms only, or both. With nothing known yet (still loading / no approved gym) it keeps the brand
 * wording, which is the rule for any owner who has a brand.
 */
export function ownerIntroCopy(options: BrandOption[]): string {
  const hasBrand = options.some((o) => o.scope === "BRAND");
  const hasBrandless = options.some((o) => o.scope === "BRANCH");
  if (hasBrandless && hasBrand) return OWNER_INTRO_BOTH;
  if (hasBrandless) return OWNER_INTRO_BRANDLESS;
  return OWNER_INTRO_BRAND;
}

/** Pairs that already have an offer or an agreement running - a second proposal would only earn a 409. */
export function brandsBlockedForProposal(rawRows: unknown, ptUserId?: string): Set<string> {
  const out = new Set<string>();
  for (const r of Array.isArray(rawRows) ? (rawRows as any[]) : []) {
    if (!OPEN_STATUSES.has(str(r?.status))) continue;
    if (ptUserId && str(r.ptUserId) !== ptUserId) continue;
    if (r?.scope === "BRAND") out.add(str(r.brandId));
    // A brandless gym's single-branch agreement blocks a second one for the same branch.
    else if (!r?.brand && !r?.supersededByAgreementId && str(r?.gymId)) out.add(branchOptionId(str(r.gymId)));
  }
  return out;
}

// --- copy that depends on who is looking --------------------------------------------------------

/** Title + bullet lines of the confirmation shown BEFORE a brand agreement is terminated. */
export function terminateBrandCopy(viewer: Viewer, counterpartName: string): { title: string; lines: string[] } {
  const who = counterpartName || (viewer === "PT" ? BRAND_NAME_FALLBACK : PT_NAME_FALLBACK);
  return {
    title: `Chấm dứt hợp tác với ${who}?`,
    lines: [
      viewer === "PT"
        ? "Ngay khi xác nhận, bạn không nhận thêm hợp đồng mới tại thương hiệu này (ở mọi chi nhánh)."
        : "Ngay khi xác nhận, huấn luyện viên này không nhận thêm hợp đồng mới tại thương hiệu của bạn (ở mọi chi nhánh).",
      `Thỏa thuận chấm dứt hẳn sau thời gian báo trước do hệ thống quy định (mặc định ${DEFAULT_NOTICE_DAYS_COPY} ngày); ngày hiệu lực sẽ hiện sau khi xác nhận.`,
      "Hợp đồng đã ký và thanh toán vẫn được thực hiện tiếp với tỷ lệ đã chốt; hợp đồng chưa thanh toán không đi tiếp.",
    ],
  };
}

/** Confirmation for ending ONE old per-branch row (the server ends those immediately). */
export function terminateLegacyCopy(branchName: string, branded = true): { title: string; lines: string[] } {
  const name = branchName || BRANCH_NAME_FALLBACK;
  if (!branded) {
    return {
      title: `Chấm dứt hợp tác với ${name}?`,
      lines: [
        "Thỏa thuận này chỉ áp dụng riêng cho chi nhánh đó (phòng gym chưa có thương hiệu) và sẽ chấm dứt NGAY, không có thời gian báo trước.",
        "Hợp đồng đã ký giữ nguyên tỷ lệ lúc ký.",
      ],
    };
  }
  return {
    title: `Chấm dứt điều khoản cũ của ${name}?`,
    lines: [
      "Điều khoản cũ này chỉ áp dụng riêng cho chi nhánh đó và sẽ chấm dứt NGAY (không có thời gian báo trước).",
      "Hợp đồng đã ký giữ nguyên tỷ lệ lúc ký.",
    ],
  };
}

export function proposeCopy(viewer: Viewer, repartner: boolean): { title: string; submit: string } {
  return {
    title: repartner ? "Hợp tác lại" : viewer === "PT" ? "Đề nghị hợp tác" : "Mời huấn luyện viên hợp tác",
    submit: "Gửi đề xuất",
  };
}

/** After a successful terminate: the server's own effective date, or a plain confirmation when it ended at once. */
export function terminatedToast(result: any): string {
  const d = dateVi(result?.effectiveAt);
  if (result?.status === "TERMINATED" || !d) return "Đã chấm dứt hợp tác.";
  return `Đã báo chấm dứt. Hợp đồng mới bị chặn ngay; hiệu lực vào ngày ${d}.`;
}
