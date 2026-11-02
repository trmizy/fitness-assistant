/**
 * D77 LIFECYCLE PROBE (31/10/2026) - MEASURES, does not pin expectations.
 *
 * Evidence label: BACKEND INTEGRATION (cross-service): user-service's paymentClient -> HTTP -> a REAL payment-service child process -> the REAL ledger on an
 * isolated *_test database. The contract rows are REAL (H.paidContract: pay + signed gateway IPN). The session-level steps are driven AT THE LEDGER DOOR
 * (/internal/contracts/{release-session,no-show,late-arrival,late-arrival-obligation,terminate,resolve-unresolved-session}) with the same bodies
 * contract-payout.service builds (usedSessions / compensatedSessions / alreadyReleased are tracked here the way contract.addReleased does it from each
 * release answer). No user-service session row, sweep or gate is involved: what is measured is the money, not the workflow.
 *
 * TEST FIXTURES, named where used:
 *   - "L OPEN, whole"   = the REAL record-only door (/late-arrival-obligation): charged 0, OPEN obligation owed 125,000.
 *   - "L OPEN, partial" = the SAME fixture the matrix test used before 31/10 (wallet pending_balance of the PT cut by 850,000 and of the platform REVENUE
 *                         by 100,000, escrow cut by the same total so the invariant holds) BEFORE the late-arrival step: the ledger can then fund 50,000 of
 *                         the 125,000 (PT 50,000, platform 0). A hand-cut wallet is not a state the fixed ledger can reach: the numbers of these cases describe
 *                         a LEGACY over-spent contract and are marked fixtureCut in the JSON (booksSound is recorded, not asserted, for them).
 *
 * Output: S2_PROBE_REPORT=<path> writes {cases:[...]} (wallet buckets of every party before / after, ownPending, client credit, obligations, the
 * terminate answer, hand-computed expectation and the diff where one exists). The only assertion is the reconciliation invariant (assertBooksSound).
 *
 * Opt-in; run ALONE (it spawns payment-service and TRUNCATEs its ledger tables):
 *   RUN_CROSS_SERVICE_MONEY=1 TEST_DATABASE_URL=...user_<x>_test... E2E_PAYMENT_DATABASE_URL=...payment_<x>_test... S2_PROBE_REPORT=<path> \
 *   ./node_modules/.bin/tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/cross-service-money-d77-lifecycle-probe.e2e.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { skip, startHarness, type GymTerms, type Harness, type PaidContract } from "./cross-service-money.harness";
// Fail-closed late-open switch (DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED, user-service gate AND the payment-service child it spawns): this suite PAYS an OPEN late-arrival obligation, so it is turned on in-process before the harness starts (the child inherits it at spawn).
process.env.NODE_ENV = "test";
process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED = "true";

const PRICE = 1_000_000;
const V = 250_000;
const L = 125_000;
const num = (v: unknown) => Number(v ?? 0);
const fixtureGym = (): GymTerms => ({ gymId: randomUUID(), platformRate: "0.10", ptRate: "0.55", gymRate: "0.35" });

let H: Harness;
let restoreGym: () => void = () => {};
test.before(async () => {
  if (skip) return;
  H = await startHarness({ paymentAuth: true });
  // TEST FIXTURE (same as the d77 matrix): a gym-tied contract is confirmed against a stubbed gym-service answer.
  const { gymClient } = await import("../clients/gym.client");
  const original = gymClient.getActiveCollaboration;
  const originalMembership = gymClient.getClientMembershipAtGym;
  (gymClient as any).getActiveCollaboration = async () => ({ collaborationId: "agr-probe", platformRate: "0.10", ptRate: "0.55", gymRate: "0.35", brandId: null, agreementScope: null });
  (gymClient as any).getClientMembershipAtGym = async () => ({
    hasActiveMembership: true,
    brandId: null,
    membership: { membershipId: "mem-probe", planName: "fixture", purchaseGymId: "gym", startDate: new Date(Date.now() - 86_400_000).toISOString(), endDate: new Date(Date.now() + 365 * 86_400_000).toISOString() },
  });
  restoreGym = () => {
    (gymClient as any).getActiveCollaboration = original;
    (gymClient as any).getClientMembershipAtGym = originalMembership;
  };
});
test.after(async () => {
  restoreGym();
  if (process.env.S2_PROBE_REPORT) fs.writeFileSync(process.env.S2_PROBE_REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), cases: CASES }, null, 2));
  if (H) await H.close();
});

// ── the measuring kit ────────────────────────────────────────────────────────

type Buckets = { PENDING: number; AVAILABLE: number; HOLDBACK: number };
interface Snap {
  client: number;
  pt: Buckets;
  gym: Buckets | null;
  platform: Buckets;
  escrow: number;
  /** ownPending as payment-service computes it: the contract's own PENDING rows, clamped to the wallet's pooled PENDING. */
  ownPending: { pt: number; gym: number | null; platform: number };
  pendingTotal: number;
  availableTotal: number;
  holdbackTotal: number;
  /** everything except escrow: must equal the price while the escrow still holds it. */
  partiesSum: number;
}
const CASES: Array<Record<string, unknown>> = [];

async function snap(c: PaidContract): Promise<Snap> {
  const rows = await H.entries(c.txnId);
  const tally = (ownerType: string, ownerId?: string): Buckets => {
    const b: Buckets = { PENDING: 0, AVAILABLE: 0, HOLDBACK: 0 };
    for (const e of rows) {
      if (e.ownerType !== ownerType || (ownerId !== undefined && e.ownerId !== ownerId)) continue;
      if (e.bucket in b) (b as any)[e.bucket] += e.type === "CREDIT" ? e.amount : -e.amount;
    }
    return b;
  };
  const clientB = tally("CLIENT");
  const pt = tally("PT");
  const gym = c.gymId ? tally("GYM") : null;
  const platform = tally("PLATFORM", "REVENUE");
  const escrow = tally("PLATFORM", "ESCROW").AVAILABLE;
  const pooled = async (t: string, id: string) => (await H.wallet(t, id)).p;
  const clampOwn = (own: number, pooledPending: number) => (own <= 0 ? 0 : Math.min(own, pooledPending));
  const ownPending = {
    pt: clampOwn(pt.PENDING, await pooled("PT", c.ptUserId)),
    gym: gym ? clampOwn(gym.PENDING, await pooled("GYM", c.gymId!)) : null,
    platform: clampOwn(platform.PENDING, await pooled("PLATFORM", "REVENUE")),
  };
  const all = [pt, gym, platform].filter(Boolean) as Buckets[];
  const sum = (k: keyof Buckets) => all.reduce((s, b) => s + b[k], 0);
  return {
    client: clientB.AVAILABLE,
    pt,
    gym,
    platform,
    escrow,
    ownPending,
    pendingTotal: sum("PENDING"),
    availableTotal: sum("AVAILABLE"),
    holdbackTotal: sum("HOLDBACK"),
    partiesSum: clientB.AVAILABLE + sum("PENDING") + sum("AVAILABLE") + sum("HOLDBACK"),
  };
}

async function obligations(c: PaidContract) {
  const rows: any[] = await H.payDb.$queryRawUnsafe(
    `SELECT key, kind::text AS kind, status::text AS status, owed::text AS owed, paid::text AS paid, unpaid::text AS unpaid FROM contract_unpaid_obligations WHERE transaction_id = $1 ORDER BY created_at, key`,
    c.txnId,
  );
  return rows.map((r) => ({ key: String(r.key).replace(/^(.*?:)[0-9a-f-]{36}:/, "$1…:"), kind: r.kind as string, status: r.status as string, owed: num(r.owed), paid: num(r.paid), unpaid: num(r.unpaid) }));
}

async function cutPending(ownerType: "PT" | "PLATFORM", ownerId: string, cut: number) {
  await H.payDb.$executeRawUnsafe(`UPDATE wallets SET pending_balance = pending_balance - ${cut} WHERE owner_type = $1::"WalletOwnerType" AND owner_id = $2`, ownerType, ownerId);
  await H.payDb.$executeRawUnsafe(`UPDATE wallets SET available_balance = available_balance - ${cut} WHERE owner_type = 'PLATFORM' AND owner_id = 'ESCROW'`);
}

/** The ledger-door driver of one contract. Tracks what contract.service tracks (released totals, used / compensated / unresolved counters). */
function kit(c: PaidContract, opts: { holdback?: string } = {}) {
  const pc = H.m.paymentClient as any;
  const base = {
    transactionId: c.txnId,
    price: c.price!.toString(),
    totalSessions: c.totalSessions,
    rates: { platformRate: c.platformRate.toString(), ptRate: c.ptRate.toString(), gymRate: c.gymRate.toString() },
    parties: { ptUserId: c.ptUserId, gymId: c.gymId ?? null, clientUserId: c.clientUserId },
  };
  const hb = opts.holdback ? { ptHoldbackRate: opts.holdback } : {};
  const st = { released: { pt: 0, gym: 0, platform: 0 }, used: 0, comp: 0, unresolved: 0 };
  const steps: Array<Record<string, unknown>> = [];
  const heldIds: string[] = [];
  const sid = (s: string) => `${c.id}:${s}`;
  const brief = (r: any) => (r && typeof r === "object" ? JSON.parse(JSON.stringify(r)) : r);
  async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      const r = await fn();
      steps.push({ step: name, answer: brief(r) });
      return r;
    } catch (e: any) {
      const body = e?.response?.data;
      steps.push({ step: name, error: String(body?.error?.code ?? e?.code ?? "") + " " + String(body?.error?.message ?? e?.message ?? e).slice(0, 200), status: e?.response?.status });
      return undefined;
    }
  }
  const api = {
    st,
    steps,
    base,
    sid,
    release: (s: string) =>
      step(`release ${s}`, async () => {
        const r = await pc.releaseSession({ ...base, label: `probe release ${s}`, idempotencyKey: `SESSION_RELEASE:${sid(s)}`, ...hb, settleLateOpen: true });
        st.released.pt += num(r.released.pt);
        st.released.gym += num(r.released.gym);
        st.released.platform += num(r.released.platform);
        st.used += 1;
        return r;
      }),
    late: (s: string) => step(`late-arrival ${s}`, () => pc.lateArrival({ ...base, label: `probe late ${s}`, idempotencyKey: `PT_LATE_ARRIVAL:${sid(s)}` })),
    recordLate: (s: string) =>
      step(`record-only late-arrival ${s} (OPEN, charged 0)`, () =>
        pc.recordLateArrivalObligation({ ...base, label: `probe late ${s}`, idempotencyKey: `PT_LATE_ARRIVAL:${sid(s)}`, reason: "probe: the ledger never performed the step" }),
      ),
    noShow: (s: string) =>
      step(`no-show ${s}`, async () => {
        const r = await pc.noShow({ ...base, label: `probe no-show ${s}`, idempotencyKey: `PT_NO_SHOW:${sid(s)}`, settleLateOpen: true });
        if (r?.recordedOnly !== true) st.comp += 1;
        return r;
      }),
    hold: (s?: string) => {
      st.unresolved += 1;
      if (s) heldIds.push(sid(s));
    },
    terminate: (reason: string) =>
      step(`terminate ${reason} (used ${st.used}, compensated ${st.comp}, unresolved ${st.unresolved})`, () =>
        pc.terminate({
          ...base,
          usedSessions: st.used,
          compensatedSessions: st.comp,
          ...(st.unresolved > 0 ? { unresolvedSessions: st.unresolved } : {}),
          ...(st.unresolved > 0 && heldIds.length === st.unresolved ? { unresolvedSessionIds: heldIds } : {}),
          reason,
          alreadyReleased: { pt: String(st.released.pt), gym: String(st.released.gym), platform: String(st.released.platform) },
          label: `probe termination ${reason}`,
          idempotencyKey: `CONTRACT_TERMINATE:${c.id}`,
          ...hb,
        }),
      ),
    resolve: (s: string, outcome: "DELIVERED" | "NOT_DELIVERED") =>
      step(`resolve ${s} ${outcome}`, () => pc.resolveUnresolvedSession({ ...base, label: `probe resolve ${s}`, idempotencyKey: `UNRESOLVED_SESSION:${sid(s)}`, outcome, ...hb, settleLateOpen: true })),
    releaseHoldback: () => step("release-holdback (idle ended contract)", () => pc.releaseHoldback({ transactionId: c.txnId, parties: base.parties, label: "probe holdback release", idempotencyKey: `HOLDBACK_RELEASE:${c.id}` })),
  };
  return api;
}

const terminateSummary = (r: any) =>
  r
    ? {
        reason: r.reason,
        refund: num(r.refund),
        entitlement: { pt: num(r.entitlement?.pt), gym: num(r.entitlement?.gym), platform: num(r.entitlement?.platform) },
        topUp: { pt: num(r.topUp?.pt), gym: num(r.topUp?.gym), platform: num(r.topUp?.platform) },
        returnedToEscrow: num(r.returnedToEscrow),
        shortfall: num(r.shortfall),
        owed: num(r.owed),
        paid: num(r.paid),
        unpaid: num(r.unpaid),
        overReleased: r.overReleased ?? null,
        ptHoldback: r.ptHoldback ?? null,
        unresolved: r.unresolved ?? null,
      }
    : null;

async function scenario(id: string, group: string, params: Record<string, unknown>, fn: (rec: Record<string, unknown>) => Promise<void>, o: { fixtureCut?: boolean } = {}) {
  await H.resetPayment();
  const rec: Record<string, unknown> = { id, group, params, fixtureCut: !!o.fixtureCut };
  CASES.push(rec);
  try {
    await fn(rec);
    let books: { sound: boolean; error?: string };
    try {
      await H.invariant(id);
      books = { sound: true };
    } catch (e: any) {
      books = { sound: false, error: String(e?.message ?? e).slice(0, 300) };
    }
    rec.booksSound = books;
    if (!o.fixtureCut) assert.equal(books.sound, true, `${id}: books not sound ${books.error ?? ""}`);
  } catch (e: any) {
    rec.error = String(e?.message ?? e).slice(0, 400);
    throw e;
  } finally {
    await H.startPayment().catch(() => {});
    await H.cleanup();
  }
}

async function contract(o: { gym?: boolean; total?: number; price?: number } = {}) {
  const pt = await H.makePt();
  return H.paidContract(pt, { price: o.price ?? PRICE, totalSessions: o.total ?? 4, ...(o.gym ? { gym: fixtureGym() } : {}) });
}

// ═════════════════════════ P1. L OPEN: the fate of the money held back ═════════════════════════

const ENDINGS = ["MUTUAL", "CLIENT_CANCELLED", "PT_CANCELLED", "EXPIRED", "COMPLETED"] as const;

/** Builds the L of session S1: whole (record-only) or partial (cut fixture), then releases S1 as COMPLETED. Returns the kit. */
async function buildOpenLAndRelease(c: PaidContract, form: "a" | "b", rec: Record<string, unknown>) {
  const k = kit(c);
  if (form === "a") {
    await k.recordLate("S1");
    rec.how = "L OPEN whole: REAL record-only door /late-arrival-obligation (charged 0, owed 125,000). No wallet touched.";
  } else {
    await cutPending("PT", c.ptUserId, 850_000);
    await cutPending("PLATFORM", "REVENUE", 100_000);
    await k.late("S1");
    rec.how = "L OPEN partial: TEST FIXTURE - PT wallet pending cut by 850,000 and platform REVENUE pending by 100,000 (escrow by 950,000) BEFORE the real /late-arrival step, which then charges PT 50,000 / platform 0 and records OPEN 75,000.";
  }
  await k.release("S1");
  return k;
}

for (const form of ["a", "b"] as const) {
  for (const ending of ENDINGS) {
    test(`P1 L OPEN (${form === "a" ? "whole 125k" : "partial 50k paid + 75k OPEN"}) -> S1 COMPLETED -> contract ends ${ending}`, { skip }, async () => {
      await scenario(`P1.${form}.${ending}`, "P1", { form, ending, rates: "90/10" }, async (rec) => {
        const c = await contract();
        const k = await buildOpenLAndRelease(c, form, rec);
        if (ending === "COMPLETED") for (const s of ["S2", "S3", "S4"]) await k.release(s);
        rec.before = await snap(c);
        const t = await k.terminate(ending);
        rec.terminate = terminateSummary(t);
        rec.after = await snap(c);
        rec.obligations = await obligations(c);
        rec.steps = k.steps;
        rec.releasedTracked = k.st;
      }, { fixtureCut: form === "b" });
    });
  }
}

test("P1 [G] gym 55/35/10: L OPEN whole -> S1 COMPLETED -> MUTUAL", { skip }, async () => {
  await scenario("P1.a.MUTUAL.gym", "P1", { form: "a", ending: "MUTUAL", rates: "55/35/10", gym: true }, async (rec) => {
    const c = await contract({ gym: true });
    const k = await buildOpenLAndRelease(c, "a", rec);
    rec.before = await snap(c);
    rec.terminate = terminateSummary(await k.terminate("MUTUAL"));
    rec.after = await snap(c);
    rec.obligations = await obligations(c);
    rec.steps = k.steps;
  });
});

test("P1 PT_NO_SHOW + L OPEN whole (running contract) -> terminate MUTUAL", { skip }, async () => {
  await scenario("P1.noshow.MUTUAL", "P1", { form: "a", outcome: "PT_NO_SHOW", ending: "MUTUAL" }, async (rec) => {
    const c = await contract();
    const k = kit(c);
    await k.recordLate("S1");
    await k.noShow("S1");
    rec.before = await snap(c);
    rec.terminate = terminateSummary(await k.terminate("MUTUAL"));
    rec.after = await snap(c);
    rec.obligations = await obligations(c);
    rec.steps = k.steps;
  });
});

for (const outcome of ["DELIVERED", "NOT_DELIVERED"] as const) {
  test(`P1 ended contract (case ${outcome === "DELIVERED" ? 6 : 18}): L OPEN whole on the held session, ruling ${outcome}: is the pending left ever released?`, { skip }, async () => {
    await scenario(`P1.ended.${outcome}`, "P1", { form: "a", ending: "MUTUAL with S1 held", resolution: outcome }, async (rec) => {
      const c = await contract();
      const k = kit(c);
      await k.recordLate("S1");
      k.hold("S1");
      rec.terminate = terminateSummary(await k.terminate("MUTUAL"));
      rec.afterEnding = await snap(c);
      await k.resolve("S1", outcome);
      rec.afterRuling = await snap(c);
      // Every door that could possibly move the rest: replay of the ending, replay of the ruling, the opposite ruling, the holdback release.
      await k.terminate("MUTUAL");
      await k.resolve("S1", outcome);
      await k.resolve("S1", outcome === "DELIVERED" ? "NOT_DELIVERED" : "DELIVERED");
      await k.releaseHoldback();
      rec.after = await snap(c);
      rec.afterPendingMoved = rec.after && (rec.afterRuling as Snap) ? (rec.after as Snap).pendingTotal - (rec.afterRuling as Snap).pendingTotal : null;
      rec.obligations = await obligations(c);
      rec.steps = k.steps;
      rec.codeAudit =
        "CODE AUDIT: the only code that debits PENDING of a finished contract is releaseSession / compensate* / terminateContract / resolveUnresolvedSession; releaseHeldToAvailable (contract-ledger.service.ts) and unresolvedRemaining only move or count the HOLDBACK bucket and the held-session marker rows, never PENDING.";
    });
  });
}

test("P1 concurrency 1: two sessions with L OPEN whole released at the same moment, then MUTUAL", { skip }, async () => {
  await scenario("P1.concurrent.releases", "P1", { form: "a", sessions: 2 }, async (rec) => {
    const c = await contract();
    const k = kit(c);
    await k.recordLate("S1");
    await k.recordLate("S2");
    rec.before = await snap(c);
    await Promise.all([k.release("S1"), k.release("S2")]);
    rec.afterReleases = await snap(c);
    rec.terminate = terminateSummary(await k.terminate("MUTUAL"));
    rec.after = await snap(c);
    rec.obligations = await obligations(c);
    rec.steps = k.steps;
  });
});

test("P1 concurrency 2: S1 released (L OPEN), S2 (L OPEN) release RACES the ending MUTUAL; the loser is replayed afterwards", { skip }, async () => {
  await scenario("P1.concurrent.release-vs-terminate", "P1", { form: "a", sessions: 2 }, async (rec) => {
    const c = await contract();
    const k = kit(c);
    await k.recordLate("S1");
    await k.recordLate("S2");
    await k.release("S1");
    rec.before = await snap(c);
    // the ending is told S2 is not released (used 1); S2's own release is in flight at the same moment
    const usedAtEnding = k.st.used;
    const rel = k.base;
    const pc = H.m.paymentClient as any;
    const [relS2, term] = await Promise.allSettled([
      pc.releaseSession({ ...rel, label: "probe release S2", idempotencyKey: `SESSION_RELEASE:${k.sid("S2")}` }),
      pc.terminate({ ...rel, usedSessions: usedAtEnding, compensatedSessions: 0, reason: "MUTUAL", alreadyReleased: { pt: String(k.st.released.pt), gym: "0", platform: String(k.st.released.platform) }, label: "probe termination", idempotencyKey: `CONTRACT_TERMINATE:${c.id}` }),
    ]);
    rec.raceRelease = relS2.status === "fulfilled" ? relS2.value : { rejected: String((relS2.reason as any)?.response?.data?.error?.code ?? (relS2.reason as any)?.message) };
    rec.raceTerminate = term.status === "fulfilled" ? terminateSummary(term.value) : { rejected: String((term.reason as any)?.response?.data?.error?.code ?? (term.reason as any)?.message) };
    rec.afterRace = await snap(c);
    await k.release("S2"); // replay / late arrival after the ending
    rec.after = await snap(c);
    rec.obligations = await obligations(c);
    rec.steps = k.steps;
  });
});

// ═════════════════════════ P2. not OPEN: the full lifecycle ═════════════════════════

type P2Outcome = "COMPLETED" | "NO_SHOW";
type P2D77 = "SETTLED" | "PENDING";
const P2_ENDINGS = ["MUTUAL", "CLIENT_CANCELLED", "COMPLETED"] as const;

/** Hand calculation, 90/10, price 1,000,000 / 4 sessions: V = 250,000, L = 125,000. nNormal = ordinary delivered sessions besides the special one. */
function handExpectation(outcome: P2Outcome, ending: (typeof P2_ENDINGS)[number], nNormal: number) {
  const usedCount = (outcome === "COMPLETED" ? 1 : 0) + nNormal;
  const comp = outcome === "NO_SHOW" ? 1 : 0;
  const unused = ending === "COMPLETED" ? 0 : 4 - usedCount - comp;
  const refund = ending === "MUTUAL" ? unused * V : ending === "CLIENT_CANCELLED" ? unused * V * 0.9 : 0;
  const withheld = unused * V - refund;
  const client = (outcome === "COMPLETED" ? L : V) + refund;
  const pt = (outcome === "COMPLETED" ? (V - L) * 0.9 : 0) + nNormal * V * 0.9 + withheld * 0.9;
  const platform = (outcome === "COMPLETED" ? (V - L) * 0.1 : 0) + nNormal * V * 0.1 + withheld * 0.1;
  return { client, pt, platform, sum: client + pt + platform };
}

for (const outcome of ["COMPLETED", "NO_SHOW"] as P2Outcome[]) {
  for (const d77 of ["SETTLED", "PENDING"] as P2D77[]) {
    for (const ending of P2_ENDINGS) {
      test(`P2 ${outcome}/ACTIVE/${d77}: the contract goes on (normal sessions), ends ${ending}`, { skip }, async () => {
        await scenario(`P2.${outcome}.${d77}.${ending}`, "P2", { outcome, d77, ending, rates: "90/10" }, async (rec) => {
          const c = await contract();
          const k = kit(c);
          // SETTLED = the D77 step is first (the order the user-service gate imposes). PENDING = the D77 step reaches the ledger AFTER the ruling's money step
          // (the order before the gate; for COMPLETED this is "D77 arrives after the full release").
          if (d77 === "SETTLED") {
            await k.late("A");
            if (outcome === "COMPLETED") await k.release("A");
            else await k.noShow("A");
          } else {
            if (outcome === "COMPLETED") await k.release("A");
            else await k.noShow("A");
            await k.late("A");
          }
          const nNormal = ending === "COMPLETED" ? (outcome === "COMPLETED" ? 3 : 3) : 1;
          for (let i = 1; i <= nNormal; i++) await k.release(`B${i}`);
          rec.before = await snap(c);
          rec.terminate = terminateSummary(await k.terminate(ending));
          const after = await snap(c);
          rec.after = after;
          rec.obligations = await obligations(c);
          rec.steps = k.steps;
          const exp = handExpectation(outcome, ending, nNormal);
          const actual = { client: after.client, pt: after.pt.AVAILABLE + after.pt.HOLDBACK + after.pt.PENDING, platform: after.platform.AVAILABLE + after.platform.PENDING, sum: 0 };
          actual.sum = actual.client + actual.pt + actual.platform;
          rec.expectedByHand = exp;
          rec.actual = actual;
          rec.diff = { client: actual.client - exp.client, pt: actual.pt - exp.pt, platform: actual.platform - exp.platform, sum: actual.sum - exp.sum, priceSum: actual.sum - PRICE };
        });
      });
    }
  }
}

// ── suspicion: a NO_SHOW session that already covers L, while another session is held at the ending ──
for (const [gym, outcome] of [[false, "DELIVERED"], [false, "NOT_DELIVERED"], [true, "DELIVERED"]] as Array<[boolean, "DELIVERED" | "NOT_DELIVERED"]>) {
  test(`P2 suspicion${gym ? " [G]" : ""}: NO_SHOW(A) covering L SETTLED + session X held at the ending (MUTUAL), X resolved ${outcome}`, { skip }, async () => {
    await scenario(`P2.suspicion.${gym ? "gym." : ""}${outcome}`, "P2", { suspicion: "loadLateArrivalDeductions open-slot", outcome, ending: "MUTUAL", ...(gym ? { rates: "55/35/10", gym: true } : { rates: "90/10" }) }, async (rec) => {
      const c = await contract({ gym });
      const k = kit(c);
      await k.late("A");
      await k.noShow("A");
      k.hold("X"); // X: held at the ending
      rec.before = await snap(c);
      const t = await k.terminate("MUTUAL");
      rec.terminate = terminateSummary(t);
      rec.afterEnding = await snap(c);
      await k.resolve("X", outcome);
      const after = await snap(c);
      rec.after = after;
      rec.obligations = await obligations(c);
      rec.steps = k.steps;
      // 90/10 hand expectation: A paid the client V (L 125k + 125k); remaining = 4 - 0 - 1 - 1 = 2 sessions refunded 100% (500k); X: DELIVERED -> PT 225k / platform 25k, NOT_DELIVERED -> client +250k.
      if (!gym) {
        const exp = outcome === "DELIVERED" ? { client: V + 2 * V, pt: 225_000, platform: 25_000 } : { client: V + 2 * V + V, pt: 0, platform: 0 };
        const actual = { client: after.client, pt: after.pt.AVAILABLE + after.pt.HOLDBACK + after.pt.PENDING, platform: after.platform.AVAILABLE + after.platform.PENDING };
        rec.expectedByHand = { ...exp, sum: exp.client + exp.pt + exp.platform };
        rec.actual = { ...actual, sum: actual.client + actual.pt + actual.platform };
        rec.diff = { client: actual.client - exp.client, pt: actual.pt - exp.pt, platform: actual.platform - exp.platform, priceSum: actual.client + actual.pt + actual.platform - PRICE };
      }
    });
  });
}

// ── PT holdback > 0 (snapshot rate 0.10, as the FH-9 tests) ──
for (const outcome of ["COMPLETED", "NO_SHOW"] as P2Outcome[]) {
  test(`P2 holdback 10%: ${outcome}/SETTLED then B released, then ends MUTUAL`, { skip }, async () => {
    await scenario(`P2.holdback.${outcome}`, "P2", { outcome, d77: "SETTLED", ending: "MUTUAL", ptHoldbackRate: "0.10", rates: "90/10" }, async (rec) => {
      const c = await contract();
      const k = kit(c, { holdback: "0.10" });
      await k.late("A");
      if (outcome === "COMPLETED") await k.release("A");
      else await k.noShow("A");
      await k.release("B1");
      rec.before = await snap(c);
      rec.terminate = terminateSummary(await k.terminate("MUTUAL"));
      rec.after = await snap(c);
      rec.obligations = await obligations(c);
      rec.steps = k.steps;
    });
  });
}

// ── the contract ends and nothing is left: D77 SETTLED, session resolved after the ending ──
for (const [outcome, resolution] of [["COMPLETED", "DELIVERED"], ["NO_SHOW", "NOT_DELIVERED"]] as Array<[P2Outcome, "DELIVERED" | "NOT_DELIVERED"]>) {
  test(`P2 ended contract: ${outcome} with D77 SETTLED on the held session (${resolution}) -> pending must be 0, sum = price`, { skip }, async () => {
    await scenario(`P2.ended.${outcome}`, "P2", { outcome, d77: "SETTLED", ending: "MUTUAL with A held", resolution }, async (rec) => {
      const c = await contract();
      const k = kit(c);
      await k.late("A");
      k.hold("A");
      rec.terminate = terminateSummary(await k.terminate("MUTUAL"));
      rec.afterEnding = await snap(c);
      await k.resolve("A", resolution);
      const after = await snap(c);
      rec.after = after;
      rec.obligations = await obligations(c);
      rec.steps = k.steps;
      rec.pendingLeft = after.pendingTotal;
      rec.priceDiff = after.partiesSum - PRICE;
    });
  });
}

// ── rounding: 1,000,000 / 3 sessions (V = 333,333.33) ──
for (const outcome of ["COMPLETED", "NO_SHOW"] as P2Outcome[]) {
  test(`P2 rounding 1,000,000 / 3: ${outcome}/SETTLED, the other two sessions delivered, COMPLETED`, { skip }, async () => {
    await scenario(`P2.rounding.${outcome}`, "P2", { outcome, d77: "SETTLED", ending: "COMPLETED", total: 3, rates: "90/10" }, async (rec) => {
      const c = await contract({ total: 3 });
      const k = kit(c);
      await k.late("A");
      if (outcome === "COMPLETED") await k.release("A");
      else await k.noShow("A");
      await k.release("B1");
      await k.release("B2");
      if (outcome === "COMPLETED") {
        // all three delivered
      }
      rec.before = await snap(c);
      rec.terminate = terminateSummary(await k.terminate("COMPLETED"));
      const after = await snap(c);
      rec.after = after;
      rec.obligations = await obligations(c);
      rec.steps = k.steps;
      const ptTotal = after.pt.AVAILABLE + after.pt.HOLDBACK + after.pt.PENDING;
      const platTotal = after.platform.AVAILABLE + after.platform.PENDING;
      rec.totals = { client: after.client, pt: ptTotal, platform: platTotal, sum: after.client + ptTotal + platTotal, priceDiff: after.client + ptTotal + platTotal - PRICE };
      // ideal (exact fractions): COMPLETED -> client L only; NO_SHOW -> client one session. Compare to the dong.
      const V3 = PRICE / 3;
      const idealClient = outcome === "COMPLETED" ? V3 / 2 : V3;
      const idealPt = (PRICE - idealClient) * 0.9;
      rec.rounding = { idealClient, idealPt, diffClient: after.client - idealClient, diffPt: ptTotal - idealPt, diffPlatform: platTotal - (PRICE - idealClient) * 0.1 };
    });
  });
}
