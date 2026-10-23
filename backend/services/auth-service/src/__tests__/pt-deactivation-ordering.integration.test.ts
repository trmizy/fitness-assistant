/**
 * PT-lock slice 1 — the relay's ordering against the real PtDeactivationCall table.
 *
 * Evidence labels: BACKEND INTEGRATION against the isolated gymcoach_auth_test database (migrations
 * applied with `prisma migrate deploy`; never the dev database — auth-service's .env points at dev,
 * so pass DATABASE_URL explicitly):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_auth_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/pt-deactivation-ordering.integration.test.ts
 * user-service is NOT running: `callUserService` is replaced at the dependency boundary
 * (TEST FIXTURE for that half) and records what would have been sent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/auth.repository";
import { defaultRelayDeps, relayPtActiveStateChange, type RelayDeps } from "../services/pt-deactivation-relay.service";
import { runPtDeactivationRelaySweep } from "../services/pt-deactivation-relay-sweep.service";

// D57-6-5: the database NAME (not the whole URL - the user name gymcoach_test also contains "_test") must end with _test.
const dbName = (() => {
  try {
    return decodeURIComponent(new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
})();
const usable = /_test$/.test(dbName);
const skip = usable ? false : `Refusing to touch a database: DATABASE_URL must point at a database whose name ends with "_test" (got "${dbName || "<unset>"}").`;

/** Real DB for the rows; a recording stand-in for user-service. */
function deps(sent: string[], behave: (action: string) => Promise<{ stale?: boolean } | void> = async () => {}): RelayDeps {
  return {
    ...defaultRelayDeps,
    callUserService: async (pt, action, _admin, _reason, seq) => {
      sent.push(`${action}:${pt}:${seq}`);
      return behave(action);
    },
  };
}

const rowsOf = (pt: string) => prisma.ptDeactivationCall.findMany({ where: { ptUserId: pt }, orderBy: { seq: "asc" } });

test("seq is allocated by the database and increases across commands", { skip }, async () => {
  const pt = randomUUID();
  const sent: string[] = [];
  try {
    await relayPtActiveStateChange(pt, "DEACTIVATE", "admin-1", "r1", deps(sent));
    await relayPtActiveStateChange(pt, "REACTIVATE", "admin-1", undefined, deps(sent));
    const rows = await rowsOf(pt);
    assert.equal(rows.length, 2);
    assert.ok(rows[1].seq > rows[0].seq);
    assert.deepEqual(sent, [`DEACTIVATE:${pt}:${rows[0].seq}`, `REACTIVATE:${pt}:${rows[1].seq}`]);
    assert.deepEqual(rows.map((r) => r.status), ["SETTLED", "SETTLED"]);
    assert.equal(rows[0].reason, "r1");
    assert.equal(rows[1].reason, null);
  } finally {
    await prisma.ptDeactivationCall.deleteMany({ where: { ptUserId: pt } });
  }
});

test("lock FAILS → admin unlocks → the sweep retires the old lock and NEVER re-sends it", { skip }, async () => {
  const pt = randomUUID();
  const sent: string[] = [];
  try {
    // 1. lock — user-service unreachable → row FAILED
    await relayPtActiveStateChange(pt, "DEACTIVATE", "admin-1", "gian lận", deps(sent, async () => {
      throw new Error("user-service unreachable");
    }));
    // 2. unlock — delivered fine
    await relayPtActiveStateChange(pt, "REACTIVATE", "admin-1", undefined, deps(sent));
    sent.length = 0;

    // 3. the sweep ticks (several times, as it does every 5 minutes)
    const first = await runPtDeactivationRelaySweep(deps(sent));
    const second = await runPtDeactivationRelaySweep(deps(sent));

    const rows = await rowsOf(pt);
    assert.deepEqual(rows.map((r) => [r.action, r.status]), [["DEACTIVATE", "SUPERSEDED"], ["REACTIVATE", "SETTLED"]]);
    assert.deepEqual(sent, [], "the stale DEACTIVATE is not sent, on any tick");
    assert.ok(first.superseded >= 1);
    assert.equal(second.superseded, 0, "the retired row is not picked up again");
    assert.equal(rows.length, 2, "the sweep creates no new rows");
  } finally {
    await prisma.ptDeactivationCall.deleteMany({ where: { ptUserId: pt } });
  }
});

test("a FAILED lock with no later command is retried IN PLACE and settles that same row", { skip }, async () => {
  const pt = randomUUID();
  const sent: string[] = [];
  try {
    await relayPtActiveStateChange(pt, "DEACTIVATE", "admin-1", "x", deps([], async () => {
      throw new Error("user-service 500: 1 hợp đồng chưa xử lý xong");
    }));
    const [failed] = await rowsOf(pt);
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.attempts, 1);
    assert.match(failed.lastError ?? "", /chưa xử lý xong/);

    const tick = await runPtDeactivationRelaySweep(deps(sent));
    assert.ok(tick.retried >= 1);
    const rows = await rowsOf(pt);
    assert.equal(rows.length, 1, "still one row — the retry did not create another");
    assert.equal(rows[0].id, failed.id);
    assert.equal(rows[0].status, "SETTLED");
    assert.deepEqual(sent, [`DEACTIVATE:${pt}:${failed.seq}`], "re-sent with the SAME seq");
  } finally {
    await prisma.ptDeactivationCall.deleteMany({ where: { ptUserId: pt } });
  }
});

test("a lock FAILED, then a LATER lock — only the later one is sent; duplicates never pile up", { skip }, async () => {
  const pt = randomUUID();
  const sent: string[] = [];
  try {
    await relayPtActiveStateChange(pt, "DEACTIVATE", "admin-1", "first", deps([], async () => {
      throw new Error("down");
    }));
    await relayPtActiveStateChange(pt, "DEACTIVATE", "admin-1", "second", deps([], async () => {
      throw new Error("down");
    }));
    await runPtDeactivationRelaySweep(deps(sent));
    const rows = await rowsOf(pt);
    assert.deepEqual(rows.map((r) => r.status), ["SUPERSEDED", "SETTLED"]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0], `DEACTIVATE:${pt}:${rows[1].seq}`);
  } finally {
    await prisma.ptDeactivationCall.deleteMany({ where: { ptUserId: pt } });
  }
});

test("user-service answering 'stale' retires the row", { skip }, async () => {
  const pt = randomUUID();
  try {
    await relayPtActiveStateChange(pt, "DEACTIVATE", "admin-1", undefined, deps([], async () => ({ stale: true })));
    const rows = await rowsOf(pt);
    assert.equal(rows[0].status, "SUPERSEDED");
  } finally {
    await prisma.ptDeactivationCall.deleteMany({ where: { ptUserId: pt } });
  }
});

test("a PENDING row only becomes sweep-eligible once it has been quiet for a while", { skip }, async () => {
  const pt = randomUUID();
  const sent: string[] = [];
  try {
    const fresh = await prisma.ptDeactivationCall.create({ data: { ptUserId: pt, action: "DEACTIVATE", adminId: "a", status: "PENDING" } });
    await runPtDeactivationRelaySweep(deps(sent));
    assert.deepEqual(sent, [], "a command that is being delivered right now is left alone");

    await prisma.$executeRaw`UPDATE pt_deactivation_calls SET updated_at = now() - interval '10 minutes' WHERE id = ${fresh.id}`;
    await runPtDeactivationRelaySweep(deps(sent));
    assert.deepEqual(sent, [`DEACTIVATE:${pt}:${fresh.seq}`], "a command orphaned by a crash is picked up");
    assert.equal((await rowsOf(pt))[0].status, "SETTLED");
  } finally {
    await prisma.ptDeactivationCall.deleteMany({ where: { ptUserId: pt } });
  }
});
