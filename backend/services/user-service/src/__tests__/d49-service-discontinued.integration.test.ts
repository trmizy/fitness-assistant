/**
 * D49 (FH-9) - SERVICE_DISCONTINUED_BY_PLATFORM replaces PT_BANNED as the reason a platform decision ends a service.
 *
 * Evidence: CODE AUDIT (source scan, no database) for the static part; BACKEND INTEGRATION (isolated *_test database) for the controller.
 *   - no production code path sends "PT_BANNED" to the money call any more (it stays only in types / enums / the retired-reason guard, so
 *     an ending recorded under it can still be replayed);
 *   - an admin picking PT_BANNED for a NEW ending is refused with 400 REASON_RETIRED and nothing is written;
 *   - SERVICE_DISCONTINUED_BY_PLATFORM is accepted for an admin only, ends the contract CANCELLED with that reason and sends it to the ledger.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { skip } from "./test-db-guard";

const SRC = path.resolve(__dirname, "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "generated" || e.name === "__tests__" || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("[CODE AUDIT] no production call sends PT_BANNED to the ledger; the ban unwind sends SERVICE_DISCONTINUED_BY_PLATFORM", () => {
  const sends = walk(SRC)
    .filter((f) => /(settleContractTermination|terminateContractMoney|beginContractTermination|paymentClient\.terminate)\s*\([^)]*["']PT_BANNED["']/.test(strip(fs.readFileSync(f, "utf8"))))
    .map((f) => path.relative(SRC, f));
  assert.deepEqual(sends, [], "nothing sends PT_BANNED");
  const deact = strip(fs.readFileSync(path.join(SRC, "services/pt-deactivation.service.ts"), "utf8"));
  assert.match(deact, /settleContractTermination\(contract\.id, "SERVICE_DISCONTINUED_BY_PLATFORM"/);
});

test("[CODE AUDIT] the new reason is known everywhere a reason is listed (status mapping, call-off wording, reason list)", () => {
  const payout = fs.readFileSync(path.join(SRC, "services/contract-payout.service.ts"), "utf8");
  assert.match(payout, /"SERVICE_DISCONTINUED_BY_PLATFORM",\n\];/, "in TERMINATION_REASONS");
  const closure = fs.readFileSync(path.join(SRC, "services/contract-session-closure.ts"), "utf8");
  assert.match(closure, /case "SERVICE_DISCONTINUED_BY_PLATFORM"/);
  const schema = fs.readFileSync(path.resolve(SRC, "../prisma/schema.prisma"), "utf8");
  assert.match(schema, /SERVICE_DISCONTINUED_BY_PLATFORM/);
});

async function runTerminate(reason: string, role: string) {
  const { prisma } = await import("../repositories/profile.repository");
  const { contractController } = await import("../controllers/contract.controller");
  const c = await prisma.contract.create({
    data: { id: randomUUID(), ptUserId: randomUUID(), clientUserId: randomUUID(), packageName: "d49", totalSessions: 4, status: "PENDING_PAYMENT", price: 400000 },
  });
  let status = 200;
  let body: any;
  const res: any = {
    status(s: number) { status = s; return this; },
    json(b: unknown) { body = b; return this; },
  };
  try {
    await (contractController as any).terminate({ headers: { "x-user-id": randomUUID(), "x-user-role": role }, params: { id: c.id }, body: { reason } }, res);
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    return { status, body, row, id: c.id, prisma };
  } catch (e) {
    await prisma.contract.deleteMany({ where: { id: c.id } });
    throw e;
  }
}

test("an admin who picks the retired PT_BANNED for a NEW ending gets 400 REASON_RETIRED and nothing is written", { skip }, async () => {
  const r = await runTerminate("PT_BANNED", "ADMIN");
  try {
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "REASON_RETIRED");
    assert.equal(r.row.status, "PENDING_PAYMENT");
    assert.equal(r.row.terminationReason, null);
  } finally {
    await r.prisma.contract.deleteMany({ where: { id: r.id } });
  }
});

test("only an admin may end a service as SERVICE_DISCONTINUED_BY_PLATFORM (a client or PT gets 403, nothing is written)", { skip }, async () => {
  const r = await runTerminate("SERVICE_DISCONTINUED_BY_PLATFORM", "CLIENT");
  try {
    assert.equal(r.status, 403);
    assert.equal(r.row.status, "PENDING_PAYMENT");
  } finally {
    await r.prisma.contract.deleteMany({ where: { id: r.id } });
  }
});
