import { guardedTest as dbTest } from "./test-db-guard"; // runs only on a database whose name ends with _test
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { logger } from "@gym-coach/shared";
import { AuditEntityType } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { auditRepository } from "../repositories/audit.repository";
import { auditService } from "../services/audit.service";
import {
  IP_UA_RETENTION_MONTHS,
  ipUaRetentionCutoff,
  runIpUaRetentionSweep,
} from "../services/ip-ua-retention.service";
import { parseHoldUntil, setLegalHold } from "../scripts/ip-ua-legal-hold";

/**
 * IP / user-agent retention (owner decision: 12 months; subject to privacy/legal review - nothing here claims compliance).
 *
 * The sweep sets ip_address AND user_agent to NULL on pt_terms_acceptances / audit_logs rows older than 12 months and never deletes a
 * row; a row under legal hold (legal_hold_until in the future) is skipped; a second run changes nothing; work is batched.
 *
 * Evidence: BACKEND INTEGRATION on an isolated *_test database. The clock is a TEST FIXTURE: `now` is passed into the sweep (a fake
 * clock), and rows are inserted with explicit accepted_at / created_at instead of waiting a year. "Never logged" is checked on the
 * real logger output captured in-process.
 */

const NOW = new Date("2027-03-15T10:00:00.000Z");
const CUTOFF = ipUaRetentionCutoff(NOW); // 2026-03-15T10:00:00.000Z
const IP = "203.0.113.77";
const UA = "g9-retention-test-agent/1.0";
const MS = 1;
const DAY = 24 * 60 * 60 * 1000;

const termsIds: string[] = [];
const auditIds: string[] = [];

async function terms(acceptedAt: Date, over: { ip?: string | null; ua?: string | null; hold?: Date | null } = {}) {
  const r = await prisma.ptTermsAcceptance.create({
    data: {
      userId: randomUUID(), version: `v-${randomUUID()}`, source: "RECONFIRM", acceptedAt,
      ipAddress: over.ip === undefined ? IP : over.ip,
      userAgent: over.ua === undefined ? UA : over.ua,
      legalHoldUntil: over.hold ?? null,
    },
  });
  termsIds.push(r.id);
  return r;
}
async function audit(createdAt: Date, over: { ip?: string | null; ua?: string | null; hold?: Date | null } = {}) {
  const r = await prisma.auditLog.create({
    data: {
      actorUserId: randomUUID(), action: "G9_RETENTION_TEST", entityType: AuditEntityType.PT_PROFILE, entityId: randomUUID(), metadata: { keep: "me" }, createdAt,
      ipAddress: over.ip === undefined ? IP : over.ip,
      userAgent: over.ua === undefined ? UA : over.ua,
      legalHoldUntil: over.hold ?? null,
    },
  });
  auditIds.push(r.id);
  return r;
}
const t = (id: string) => prisma.ptTermsAcceptance.findUniqueOrThrow({ where: { id } });
const a = (id: string) => prisma.auditLog.findUniqueOrThrow({ where: { id } });
/** the sweep also touches rows of other tests sharing the database; count only what these tests created */
const mine = async () => ({
  terms: await prisma.ptTermsAcceptance.count({ where: { id: { in: termsIds }, OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }] } }),
  audit: await prisma.auditLog.count({ where: { id: { in: auditIds }, OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }] } }),
});

dbTest.after(async () => {
  await prisma.ptTermsAcceptance.deleteMany({ where: { id: { in: termsIds } } });
  await prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } });
  await prisma.$disconnect();
});

nodeTest("the retention is 12 calendar months, UTC: the cutoff for a fake 'now'", () => {
  assert.equal(IP_UA_RETENTION_MONTHS, 12);
  assert.equal(CUTOFF.toISOString(), "2026-03-15T10:00:00.000Z");
  assert.equal(ipUaRetentionCutoff(new Date("2028-02-29T00:00:00.000Z")).toISOString().slice(0, 10), "2027-03-01", "leap-day 'now': JS month arithmetic, deterministic");
  assert.equal(ipUaRetentionCutoff(new Date("2027-01-31T12:00:00.000Z")).toISOString(), "2026-01-31T12:00:00.000Z");
});

dbTest("fake clock: a row exactly at the 12-month boundary is KEPT, one ms older is scrubbed, 11 months and a day old is kept - on both tables", async () => {
  const keepAtBoundary = await terms(CUTOFF);
  const scrubOneMsOlder = await terms(new Date(CUTOFF.getTime() - MS));
  const keepNewer = await terms(new Date(CUTOFF.getTime() + DAY));
  const aKeepAtBoundary = await audit(CUTOFF);
  const aScrub = await audit(new Date(CUTOFF.getTime() - MS));
  const aKeepNewer = await audit(new Date(CUTOFF.getTime() + DAY));

  const before = NOW; // a fake clock: nothing about the real date matters
  const res = await runIpUaRetentionSweep(before);
  assert.equal(res.skipped, false);
  assert.ok(res.termsScrubbed >= 1 && res.auditScrubbed >= 1);

  for (const id of [keepAtBoundary.id, keepNewer.id]) assert.deepEqual([(await t(id)).ipAddress, (await t(id)).userAgent], [IP, UA], "within 12 months -> untouched");
  for (const id of [aKeepAtBoundary.id, aKeepNewer.id]) assert.deepEqual([(await a(id)).ipAddress, (await a(id)).userAgent], [IP, UA]);
  const scrubbed = await t(scrubOneMsOlder.id);
  assert.deepEqual([scrubbed.ipAddress, scrubbed.userAgent], [null, null], "older than 12 months -> BOTH columns NULL");
  const aScrubbed = await a(aScrub.id);
  assert.deepEqual([aScrubbed.ipAddress, aScrubbed.userAgent], [null, null]);
});

dbTest("the row itself is never deleted and nothing else on it changes (who accepted which version when; what happened to which entity)", async () => {
  const old = await terms(new Date(CUTOFF.getTime() - 30 * DAY));
  const oldAudit = await audit(new Date(CUTOFF.getTime() - 30 * DAY));
  const beforeT = await t(old.id);
  const beforeA = await a(oldAudit.id);
  await runIpUaRetentionSweep(NOW);
  const afterT = await t(old.id);
  const afterA = await a(oldAudit.id);
  assert.deepEqual({ ...afterT, ipAddress: IP, userAgent: UA }, beforeT, "only the two columns differ");
  assert.deepEqual({ ...afterA, ipAddress: IP, userAgent: UA }, beforeA);
  assert.deepEqual(afterA.metadata, { keep: "me" });
  assert.equal(afterT.acceptedAt.getTime(), beforeT.acceptedAt.getTime());
});

dbTest("a row with only an IP, or only a user agent, is scrubbed completely; a row with neither is left alone (and costs no update)", async () => {
  const onlyIp = await terms(new Date(CUTOFF.getTime() - DAY), { ua: null });
  const onlyUa = await terms(new Date(CUTOFF.getTime() - DAY), { ip: null });
  const none = await terms(new Date(CUTOFF.getTime() - DAY), { ip: null, ua: null });
  await runIpUaRetentionSweep(NOW);
  for (const id of [onlyIp.id, onlyUa.id, none.id]) assert.deepEqual([(await t(id)).ipAddress, (await t(id)).userAgent], [null, null]);
});

dbTest("legal hold: a row whose legal_hold_until is in the future is SKIPPED on both tables; once the hold lapsed or is cleared the next run scrubs it", async () => {
  const held = await terms(new Date(CUTOFF.getTime() - 40 * DAY), { hold: new Date(NOW.getTime() + 30 * DAY) });
  const lapsed = await terms(new Date(CUTOFF.getTime() - 40 * DAY), { hold: new Date(NOW.getTime() - 1) });
  const exactlyNow = await terms(new Date(CUTOFF.getTime() - 40 * DAY), { hold: new Date(NOW.getTime()) });
  const aHeld = await audit(new Date(CUTOFF.getTime() - 40 * DAY), { hold: new Date(NOW.getTime() + 30 * DAY) });
  const aFree = await audit(new Date(CUTOFF.getTime() - 40 * DAY));
  await runIpUaRetentionSweep(NOW);
  assert.deepEqual([(await t(held.id)).ipAddress, (await t(held.id)).userAgent], [IP, UA], "held -> evidence kept");
  assert.deepEqual([(await a(aHeld.id)).ipAddress, (await a(aHeld.id)).userAgent], [IP, UA]);
  assert.deepEqual([(await t(lapsed.id)).ipAddress, (await t(lapsed.id)).userAgent], [null, null], "hold already over -> scrubbed");
  assert.deepEqual([(await t(exactlyNow.id)).ipAddress, (await t(exactlyNow.id)).userAgent], [null, null], "hold ending exactly now is over");
  assert.deepEqual([(await a(aFree.id)).ipAddress, (await a(aFree.id)).userAgent], [null, null]);
  // the hold lapses (time passes): the next run scrubs it
  await runIpUaRetentionSweep(new Date(NOW.getTime() + 31 * DAY));
  assert.deepEqual([(await t(held.id)).ipAddress, (await t(held.id)).userAgent], [null, null], "hold over -> scrubbed by the next run");
  assert.deepEqual([(await a(aHeld.id)).ipAddress, (await a(aHeld.id)).userAgent], [null, null]);
});

dbTest("idempotent: a second (and third) run changes nothing and reports nothing for the rows already scrubbed; data of kept rows is untouched", async () => {
  const old = await terms(new Date(CUTOFF.getTime() - 5 * DAY));
  const young = await terms(new Date(CUTOFF.getTime() + 5 * DAY));
  const first = await runIpUaRetentionSweep(NOW);
  assert.ok(first.termsScrubbed >= 1);
  const snapshot = JSON.stringify([await t(old.id), await t(young.id)]);
  const second = await runIpUaRetentionSweep(NOW);
  const third = await runIpUaRetentionSweep(NOW);
  assert.deepEqual([second.termsScrubbed, second.auditScrubbed, third.termsScrubbed, third.auditScrubbed], [0, 0, 0, 0], "nothing left to scrub");
  assert.equal(JSON.stringify([await t(old.id), await t(young.id)]), snapshot);
  assert.deepEqual(await mine().then((m) => m.terms > 0 || m.audit > 0), true, "(rows of the 'young'/held tests still carry their data: the sweep did not over-reach)");
});

dbTest("batched: with batch=10 and a cap of 2 batches a run scrubs at most 20 rows; later runs drain the rest; the overlap guard skips a concurrent run in the same process", async () => {
  await prisma.ptTermsAcceptance.deleteMany({ where: { id: { in: termsIds } } });
  termsIds.length = 0;
  await prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } });
  auditIds.length = 0;
  // clear the rest of the database's old rows first so the counts below are exact (isolated test database)
  await runIpUaRetentionSweep(NOW, { batch: 500, maxBatches: 200 });
  for (let i = 0; i < 25; i++) await terms(new Date(CUTOFF.getTime() - (i + 1) * DAY));
  const r1 = await runIpUaRetentionSweep(NOW, { batch: 10, maxBatches: 2 });
  assert.equal(r1.termsScrubbed, 20);
  assert.equal((await mine()).terms, 5);
  // a second run started while the first is still going is skipped, not doubled
  const [x, y] = await Promise.all([runIpUaRetentionSweep(NOW, { batch: 10, maxBatches: 2 }), runIpUaRetentionSweep(NOW, { batch: 10, maxBatches: 2 })]);
  assert.equal([x, y].filter((r) => r.skipped).length, 1, "exactly one of two overlapping runs is skipped");
  assert.equal((await mine()).terms, 0, "the backlog is drained");
  assert.equal([x, y].reduce((s, r) => s + r.termsScrubbed, 0), 5);
});

dbTest("two sweeps racing on the same rows (two instances): every row is scrubbed exactly once, nothing is lost or double counted", async () => {
  await runIpUaRetentionSweep(NOW, { batch: 500, maxBatches: 200 });
  const ids: string[] = [];
  for (let i = 0; i < 30; i++) ids.push((await terms(new Date(CUTOFF.getTime() - (i + 1) * DAY))).id);
  // the in-process guard is bypassed by running the statements the sweep runs, concurrently, from two connections
  const scrubAll = () =>
    prisma.ptTermsAcceptance.updateMany({
      where: {
        AND: [
          { id: { in: ids } },
          { acceptedAt: { lt: CUTOFF } },
          { OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }] },
          { OR: [{ legalHoldUntil: null }, { legalHoldUntil: { lte: NOW } }] },
        ],
      },
      data: { ipAddress: null, userAgent: null },
    });
  const [r1, r2] = await Promise.all([scrubAll(), scrubAll()]);
  assert.equal(r1.count + r2.count, 30, "each row is changed by exactly one of the two");
  assert.equal((await mine()).terms, 0);
});

dbTest("admin tooling: the hold script's functions place and clear a hold; the sweep honours both; only a FUTURE instant with a zone is accepted", async () => {
  assert.equal(parseHoldUntil("clear"), null);
  for (const bad of ["", "tomorrow", "2027-12-31", "2027-12-31T00:00:00", "2000-01-01T00:00:00Z"]) assert.equal(parseHoldUntil(bad, NOW), "invalid", bad);
  const until = parseHoldUntil("2027-12-31T00:00:00Z", NOW);
  assert.ok(until instanceof Date && until.toISOString() === "2027-12-31T00:00:00.000Z");

  const row = await terms(new Date(CUTOFF.getTime() - 10 * DAY));
  assert.equal(await setLegalHold("terms", row.id, until as Date), 1);
  await runIpUaRetentionSweep(NOW);
  assert.equal((await t(row.id)).ipAddress, IP, "held by the tool -> kept");
  assert.equal(await setLegalHold("terms", row.id, null), 1);
  await runIpUaRetentionSweep(NOW);
  assert.equal((await t(row.id)).ipAddress, null, "hold cleared -> scrubbed");
  assert.equal(await setLegalHold("terms", randomUUID(), until as Date), 0, "unknown row: nothing changed");

  const arow = await audit(new Date(CUTOFF.getTime() - 10 * DAY));
  assert.equal(await setLegalHold("audit", arow.id, until as Date), 1);
  await runIpUaRetentionSweep(NOW);
  assert.equal((await a(arow.id)).userAgent, UA);
});

dbTest("no public API sets or returns the hold: no controller, route, middleware or model mentions legal_hold_until; only the admin tool and the sweep (and the schema docs) do", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = path.join(__dirname, "..");
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "generated" || e.name === "__tests__") continue;
        walk(p);
      } else if (/\.ts$/.test(e.name) && /legalHoldUntil|legal_hold_until/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(src, p).replace(/\\/g, "/"));
    }
  };
  walk(src);
  const code = hits.filter((h) => h !== "services/pt-terms.ts"); // pt-terms.ts only names it in a server-side documentation string that is never served
  assert.deepEqual(code.sort(), ["scripts/ip-ua-legal-hold.ts", "services/ip-ua-retention.service.ts"], "controllers/routes never mention it");
  assert.equal(hits.some((h) => /^(controllers|routes|middleware|models)/.test(h)), false);
});

dbTest("never logged: a sweep that scrubs rows logs counts only - no IP, no user agent; and a failed audit write logs the entry WITHOUT ip/user agent", async () => {
  await terms(new Date(CUTOFF.getTime() - 3 * DAY));
  await audit(new Date(CUTOFF.getTime() - 3 * DAY));
  const lines: string[] = [];
  const names = ["info", "warn", "error", "debug"] as const;
  const originals = names.map((n) => (logger as any)[n].bind(logger));
  names.forEach((n) => {
    (logger as any)[n] = (...args: unknown[]) => {
      lines.push(JSON.stringify(args, (_k, v) => (v instanceof Error ? { message: v.message } : v)));
    };
  });
  const originalCreate = auditRepository.create;
  try {
    await runIpUaRetentionSweep(NOW);
    (auditRepository as any).create = async () => {
      throw new Error("db down");
    };
    await auditService.record({
      actorUserId: "u1", action: "G9_X", entityType: AuditEntityType.PT_PROFILE, entityId: "e1", metadata: { k: 1 }, ipAddress: IP, userAgent: UA,
    });
  } finally {
    (auditRepository as any).create = originalCreate;
    names.forEach((n, i) => ((logger as any)[n] = originals[i]));
  }
  const text = lines.join("\n");
  assert.ok(/IpUaRetention\] cleared IP\/user agent on \d+/.test(text), "the sweep reported counts");
  assert.ok(/failed to write audit entry/.test(text), "the failed audit write was logged");
  assert.ok(text.includes("G9_X") && text.includes("e1"), "the rest of the entry is still there to replay it");
  assert.equal(text.includes(IP), false, "no IP in the log");
  assert.equal(text.includes(UA), false, "no user agent in the log");
  assert.equal(/ipAddress|userAgent/.test(text), false, "not even the field names");
});
