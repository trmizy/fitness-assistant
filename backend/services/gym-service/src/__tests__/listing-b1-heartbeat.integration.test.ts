/**
 * BACKEND INTEGRATION - Listing Management B1: the compat_writer_heartbeats writer (startup row, interval rows,
 * best-effort failure handling) against the isolated test database.
 */
import assert from 'node:assert/strict';
import { guardedTest as test, skip } from './test-db-guard';

let prisma: typeof import('../repositories/prisma').prisma;
let hb: typeof import('../services/compat-writer-heartbeat.service');

test.before(async () => {
  if (skip) return;
  prisma = (await import('../repositories/prisma')).prisma;
  hb = await import('../services/compat-writer-heartbeat.service');
});

test.after(async () => {
  if (skip) return;
  hb.stopCompatWriterHeartbeat();
  await prisma.compatWriterHeartbeat.deleteMany({ where: { instanceId: hb.COMPAT_INSTANCE_ID } });
  await prisma.$disconnect();
});

const mine = () => prisma.compatWriterHeartbeat.findMany({ where: { instanceId: hb.COMPAT_INSTANCE_ID }, orderBy: { seenAt: 'asc' } });
const until = async (cond: () => Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
};

test('instance id is stable per process: host:pid:uuid', () => {
  assert.match(hb.COMPAT_INSTANCE_ID, /^.+:\d+:[0-9a-f-]{36}$/);
  assert.ok(hb.COMPAT_INSTANCE_ID.includes(`:${process.pid}:`));
});

test('interval: env COMPAT_WRITER_HEARTBEAT_INTERVAL_MS, default 600000, junk falls back', () => {
  const saved = process.env.COMPAT_WRITER_HEARTBEAT_INTERVAL_MS;
  try {
    delete process.env.COMPAT_WRITER_HEARTBEAT_INTERVAL_MS;
    assert.equal(hb.heartbeatIntervalMs(), 600000);
    process.env.COMPAT_WRITER_HEARTBEAT_INTERVAL_MS = '1500';
    assert.equal(hb.heartbeatIntervalMs(), 1500);
    for (const junk of ['abc', '0', '-5', '']) {
      process.env.COMPAT_WRITER_HEARTBEAT_INTERVAL_MS = junk;
      assert.equal(hb.heartbeatIntervalMs(), 600000, junk);
    }
  } finally {
    if (saved === undefined) delete process.env.COMPAT_WRITER_HEARTBEAT_INTERVAL_MS;
    else process.env.COMPAT_WRITER_HEARTBEAT_INTERVAL_MS = saved;
  }
});

test('recordCompatWriterHeartbeat writes {instance_id, git_sha, writer_version v1, seen_at ~ now}; GIT_SHA env or "unknown"', async () => {
  const savedSha = process.env.GIT_SHA;
  try {
    delete process.env.GIT_SHA;
    assert.equal(await hb.recordCompatWriterHeartbeat(), true);
    process.env.GIT_SHA = 'abc1234';
    assert.equal(await hb.recordCompatWriterHeartbeat(), true);
  } finally {
    if (savedSha === undefined) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = savedSha;
  }
  const rows = await mine();
  assert.deepEqual(rows.map((r) => r.gitSha), ['unknown', 'abc1234']);
  for (const r of rows) {
    assert.equal(r.writerVersion, 'v1');
    assert.ok(Math.abs(Date.now() - r.seenAt.getTime()) < 60_000);
  }
  await prisma.compatWriterHeartbeat.deleteMany({ where: { instanceId: hb.COMPAT_INSTANCE_ID } });
});

test('start writes the STARTUP row immediately, then one row per interval; stop ends it', async () => {
  const saved = process.env.COMPAT_WRITER_HEARTBEAT_INTERVAL_MS;
  process.env.COMPAT_WRITER_HEARTBEAT_INTERVAL_MS = '200';
  let stop: (() => void) | undefined;
  try {
    stop = hb.startCompatWriterHeartbeat();
    assert.ok(await until(async () => (await mine()).length >= 1), 'startup row');
    assert.ok(await until(async () => (await mine()).length >= 3), 'interval rows');
    stop();
    await new Promise((r) => setTimeout(r, 150)); // let an in-flight insert land
    const n = (await mine()).length;
    await new Promise((r) => setTimeout(r, 600));
    assert.equal((await mine()).length, n, 'no more rows after stop');
    const rows = await mine();
    assert.ok(rows.every((r) => r.writerVersion === 'v1'));
  } finally {
    stop?.();
    if (saved === undefined) delete process.env.COMPAT_WRITER_HEARTBEAT_INTERVAL_MS;
    else process.env.COMPAT_WRITER_HEARTBEAT_INTERVAL_MS = saved;
  }
});

test('a failing insert is swallowed (returns false, never throws), and later beats recover', async () => {
  const original = prisma.compatWriterHeartbeat.create;
  let calls = 0;
  (prisma.compatWriterHeartbeat as any).create = async () => {
    calls += 1;
    throw new Error('db down');
  };
  try {
    assert.equal(await hb.recordCompatWriterHeartbeat(), false);
    assert.equal(calls, 1);
    // The interval path must survive failures too (no unhandled rejection).
    process.env.COMPAT_WRITER_HEARTBEAT_INTERVAL_MS = '50';
    const stop = hb.startCompatWriterHeartbeat();
    await new Promise((r) => setTimeout(r, 300));
    stop();
    assert.ok(calls >= 3, `expected repeated attempts, got ${calls}`);
  } finally {
    delete process.env.COMPAT_WRITER_HEARTBEAT_INTERVAL_MS;
    (prisma.compatWriterHeartbeat as any).create = original;
  }
  assert.equal(await hb.recordCompatWriterHeartbeat(), true);
});

test('the lambda job "compat-writer-heartbeat" records one beat', async () => {
  const before = (await mine()).length;
  const { runGymServiceJob } = await import('../jobs-lambda');
  assert.deepEqual(await runGymServiceJob({ job: 'compat-writer-heartbeat' }), { recorded: true });
  assert.equal((await mine()).length, before + 1);
});
