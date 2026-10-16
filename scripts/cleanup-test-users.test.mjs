/**
 * Tests for scripts/cleanup-test-users.mjs. Evidence label: BACKEND INTEGRATION against the ISOLATED databases
 * gymcoach_{auth,user,fitness,ai,chat}_cleanup_test in the test container (localhost:55433); the script is run as a real child
 * process (its real argument parsing, guards and SQL). Fixtures are created by SQL (TEST FIXTURE) in the shape seed-test-users.mjs
 * writes (e-mail pattern, role, seed-script REGISTER audit log).
 *
 * Setup once (user-service etc. migrate deploy against each database; see _warroom/sessions/S_d65.md), then:
 *   node --test scripts/cleanup-test-users.test.mjs
 * The test refuses to run against anything but those five *_cleanup_test names on localhost:55433, and skips if they are missing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cleanup-test-users.mjs');
const SUFFIX = '_cleanup_test';
const SERVICES = ['auth', 'user', 'fitness', 'ai', 'chat'];
const CONN = { host: 'localhost', port: 55433, user: 'gymcoach_test', password: 'gymcoach_test_password' };
const uid = () => crypto.randomUUID();

const clients = {};
let skipReason = null;
try {
  for (const s of SERVICES) {
    const c = new Client({ ...CONN, database: `gymcoach_${s}${SUFFIX}` });
    await c.connect();
    clients[s] = c;
  }
} catch (e) {
  skipReason = `isolated cleanup test databases not reachable: ${e.message}`;
}
const skip = skipReason ?? false;
test.after(async () => {
  for (const c of Object.values(clients)) await c.end().catch(() => {});
});

function runScript(args = [], env = {}) {
  const base = { ...process.env, POSTGRES_HOST: 'localhost', POSTGRES_PORT: String(CONN.port), POSTGRES_USER: CONN.user, POSTGRES_PASSWORD: CONN.password };
  delete base.NODE_ENV;
  delete base.CLEANUP_EXTRA_HOSTS;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...base, ...env }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const SAFE = [`--db-suffix=${SUFFIX}`];

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SEED_UA = 'Mozilla/5.0 (Seed Script)';
const now = new Date();

async function reset() {
  await clients.auth.query('TRUNCATE users CASCADE');
  await clients.user.query('TRUNCATE contracts, user_profiles, notifications, inbody_entries, pt_availability, pt_restrictions, session_settlements CASCADE');
  await clients.fitness.query('TRUNCATE workouts CASCADE');
  await clients.ai.query('TRUNCATE conversations, workout_plans CASCADE');
  await clients.chat.query('TRUNCATE conversations CASCADE');
}

async function mkUser(email, { role, seeded = true } = {}) {
  const id = uid();
  const r = role ?? (email.startsWith('testpt') ? 'PT' : 'CUSTOMER');
  await clients.auth.query(`INSERT INTO users (id,email,password,"firstName","lastName",role,"createdAt","updatedAt") VALUES ($1,$2,'x','F','L',$3::"Role",$4,$4)`, [id, email, r, now]);
  await clients.auth.query(`INSERT INTO audit_logs (id,"userId",action,"userAgent","createdAt") VALUES ($1,$2,'LOGIN','Chrome',$3)`, [uid(), id, now]);
  if (seeded) await clients.auth.query(`INSERT INTO audit_logs (id,"userId",action,"userAgent","createdAt") VALUES ($1,$2,'REGISTER',$3,$4)`, [uid(), id, SEED_UA, now]);
  await clients.user.query(`INSERT INTO user_profiles (id,"userId","updatedAt") VALUES ($1,$2,$3)`, [uid(), id, now]);
  await clients.user.query(`INSERT INTO inbody_entries (id,user_id,weight,body_fat,muscle_mass,updated_at,date_only) VALUES ($1,$2,70,20,30,$3,$4::date)`, [uid(), id, now, '2026-01-01']);
  await clients.user.query(`INSERT INTO notifications (id,user_id,text,event_type,entity_type,entity_id,updated_at) VALUES ($1,$2,'n','CONTRACT_REQUESTED','CONTRACT','c',$3)`, [uid(), id, now]);
  await clients.fitness.query(`INSERT INTO workouts (id,user_id,name,updated_at) VALUES ($1,$2,'w',$3)`, [uid(), id, now]);
  await clients.ai.query(`INSERT INTO workout_plans (id,user_id,name,goal,duration,days_per_week,plan,updated_at) VALUES ($1,$2,'p','g',4,3,'{}',$3)`, [uid(), id, now]);
  if (r === 'PT') {
    await clients.user.query(`INSERT INTO pt_availability (id,pt_user_id,day_of_week,start_time,end_time,updated_at) VALUES ($1,$2,'MONDAY','08:00','12:00',$3)`, [uid(), id, now]);
  }
  return id;
}

async function mkContract(pt, client, extra = {}) {
  const id = uid();
  const cols = { id, pt_user_id: pt, client_user_id: client, package_name: 'pkg', total_sessions: 10, updated_at: now, status: 'ACTIVE', ...extra };
  const keys = Object.keys(cols);
  await clients.user.query(`INSERT INTO contracts (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map((k) => cols[k]));
  await clients.user.query(
    `INSERT INTO sessions (id,contract_id,client_user_id,pt_user_id,scheduled_start_at,scheduled_end_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5,$5)`,
    [uid(), id, client, pt, now],
  );
  return id;
}

/** returns ids by name */
async function seedWorld() {
  await reset();
  const W = {};
  // A - plain, fully deletable: PT 002 with clients 001 + 002
  W.ptA = await mkUser('testpt002@example.com');
  W.a1 = await mkUser('testuser001@example.com');
  W.a2 = await mkUser('testuser002@example.com');
  W.cA1 = await mkContract(W.ptA, W.a1);
  W.cA2 = await mkContract(W.ptA, W.a2, { status: 'COMPLETED' });
  // B - PT 001 has a CONTRACT-scope restriction (+ extension) and a settlement row with an obligation; client 003 + a plain contract of client 004
  W.ptB = await mkUser('testpt001@example.com');
  W.b1 = await mkUser('testuser003@example.com');
  W.b2 = await mkUser('testuser004@example.com');
  W.cB1 = await mkContract(W.ptB, W.b1);
  W.cB2 = await mkContract(W.ptB, W.b2); // plain, but its PT is kept
  W.restriction = uid();
  await clients.user.query(`INSERT INTO pt_restrictions (id,pt_user_id,type,imposed_by,updated_at,scope,contract_id) VALUES ($1,$2,'TEMPORARY_SUSPENSION','admin',$3,'CONTRACT',$4)`, [W.restriction, W.ptB, now, W.cB1]);
  W.extension = uid();
  await clients.user.query(`INSERT INTO pt_restriction_contract_extensions (id,restriction_id,contract_id,blocked_ms,previous_end_date,new_end_date) VALUES ($1,$2,$3,1000,$4,$4)`, [W.extension, W.restriction, W.cB1, now]);
  W.settlement = uid();
  await clients.user.query(`INSERT INTO session_settlements (id,kind,idempotency_key,contract_id,status,attempts,updated_at) VALUES ($1,'SESSION_RELEASE',$2,$3,'FAILED',2,$4)`, [W.settlement, `SESSION_RELEASE:${uid()}`, W.cB1, now]);
  // C - a fixture client with a contract to a REAL PT (never a fixture): kept
  W.realPt = await mkUser('real.pt@gymini.example.org', { role: 'PT', seeded: false });
  W.c1 = await mkUser('testuser006@example.com');
  W.cC = await mkContract(W.realPt, W.c1);
  // D - a contract with a payment transaction: kept (both fixture users)
  W.ptD = await mkUser('testpt003@example.com');
  W.d1 = await mkUser('testuser007@example.com');
  W.cD = await mkContract(W.ptD, W.d1, { payment_transaction_id: 'txn-1' });
  // E - e-mail pattern but no seed signature: never touched; so is a wrong-role account
  W.unproven = await mkUser('testuser005@example.com', { seeded: false });
  W.wrongRole = await mkUser('testuser008@example.com', { role: 'PT' });
  // F - a settlement row whose contract is already gone (the kind of orphan the sweep skips): must not be touched
  W.orphan = uid();
  await clients.user.query(`INSERT INTO session_settlements (id,kind,idempotency_key,contract_id,status,attempts,last_error,updated_at) VALUES ($1,'SESSION_RELEASE',$2,$3,'FAILED',1,'payment-service unreachable',$4)`, [W.orphan, `SESSION_RELEASE:${uid()}`, uid(), now]);
  // chat: A1<->PT A (fixtures only: deleted), A2<->real PT (mixed: kept)
  W.chatFixture = uid();
  W.chatMixed = uid();
  for (const [cid, members] of [[W.chatFixture, [W.ptA, W.a1]], [W.chatMixed, [W.a2, W.realPt]]]) {
    await clients.chat.query(`INSERT INTO conversations (id,"updatedAt") VALUES ($1,$2)`, [cid, now]);
    for (const m of members) await clients.chat.query(`INSERT INTO conversation_participants (id,"conversationId","userId") VALUES ($1,$2,$3)`, [uid(), cid, m]);
    await clients.chat.query(`INSERT INTO messages (id,"conversationId","senderId",content) VALUES ($1,$2,$3,'hi')`, [uid(), cid, members[0]]);
  }
  return W;
}

const TABLES = {
  auth: ['users', 'audit_logs'],
  user: ['contracts', 'sessions', 'user_profiles', 'inbody_entries', 'notifications', 'pt_availability', 'pt_restrictions', 'pt_restriction_contract_extensions', 'session_settlements'],
  fitness: ['workouts'],
  ai: ['workout_plans'],
  chat: ['conversations', 'conversation_participants', 'messages'],
};
async function snapshot() {
  const out = {};
  for (const [svc, tabs] of Object.entries(TABLES)) {
    for (const t of tabs) out[`${svc}.${t}`] = (await clients[svc].query(`SELECT to_jsonb(x) AS j FROM "${t}" x ORDER BY 1`)).rows.map((r) => JSON.stringify(r.j)).sort();
  }
  return out;
}
const exists = async (svc, table, id) => (await clients[svc].query(`SELECT 1 FROM "${table}" WHERE id = $1`, [id])).rowCount === 1;
const userExists = async (id) => (await exists('auth', 'users', id)) ;

// ── guards ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("refuses when NODE_ENV=production (exit 1), even with --apply and a safe database name", { skip }, async () => {
  const W = await seedWorld();
  const before = await snapshot();
  const r = runScript([...SAFE, '--apply'], { NODE_ENV: 'production' });
  assert.equal(r.code, 1);
  assert.match(r.err, /REFUSED: NODE_ENV=production/);
  assert.deepEqual(await snapshot(), before);
  assert.ok(W);
});

test("refuses a database name that is not allowed (not _test, not a known dev name), a prod-looking _test name, and the dev databases without --allow-dev-db", { skip }, async () => {
  const before = await snapshot();
  for (const [args, re] of [
    [['--db-suffix=_copy', '--apply'], /database name "gymcoach_auth_copy" \(auth\) is not allowed/],
    [['--db-suffix=_prod_test', '--apply'], /contains prod \/ staging \/ live/],
    [['--db-suffix=_staging_test'], /contains prod \/ staging \/ live/],
    [['--apply'], /"gymcoach_auth" is a local DEV database - pass --allow-dev-db/],
    [[], /"gymcoach_auth" is a local DEV database/],
    [['--db-suffix=_x;drop', '--apply'], /may contain only letters, digits and underscore/],
  ]) {
    const r = runScript(args);
    assert.equal(r.code, 1, `${args.join(' ')}: ${r.err}`);
    assert.match(r.err, re, args.join(' '));
  }
  assert.deepEqual(await snapshot(), before, "nothing changed");
});

test("refuses a non-local host, accepts it only when explicitly listed; refuses --apply together with --dry-run", { skip }, async () => {
  let r = runScript([...SAFE, '--apply'], { POSTGRES_HOST: 'db.internal.example.com' });
  assert.equal(r.code, 1);
  assert.match(r.err, /host "db.internal.example.com" is not local/);
  r = runScript([...SAFE, '--apply', '--dry-run']);
  assert.equal(r.code, 1);
  assert.match(r.err, /mutually exclusive/);
});

// ── dry-run / apply ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("DRY RUN is the default: prints the plan and writes NOTHING in any of the five databases", { skip }, async () => {
  const W = await seedWorld();
  const before = await snapshot();
  const r = runScript(SAFE);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /DRY RUN \(nothing is written\)/);
  assert.match(r.out, /fixture accounts proven \(email pattern \+ role \+ seed signature\): 9\n/);
  assert.match(r.out, /fixture accounts that WILL be removed: 3; contracts that will be removed: 2; chat conversations: 1 \(1 kept/);
  assert.match(r.out, /UNPROVEN accounts[\s\S]*testuser005@example\.com[\s\S]*no seed-script REGISTER/);
  assert.match(r.out, /testuser008@example\.com[\s\S]*role is PT, expected CUSTOMER/);
  assert.match(r.out, /would delete:/);
  assert.match(r.out, /Dry run only/);
  assert.deepEqual(await snapshot(), before, "dry-run: every table is byte-identical");
  const dry2 = runScript([...SAFE, '--dry-run']);
  assert.equal(dry2.code, 0);
  assert.deepEqual(await snapshot(), before);
  assert.ok(W);
});

test("--apply removes ONLY the identified, history-free fixtures; restriction history, settlement rows, kept contracts and unproven/real accounts all remain", { skip }, async () => {
  const W = await seedWorld();
  const before = await snapshot();
  const r = runScript([...SAFE, '--apply']);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /APPLY/);
  assert.match(r.out, /Cleanup complete\. pt_restrictions, pt_restriction_contract_extensions and session_settlements were not touched/);

  // removed: group A (PT 002 + clients 001, 002), their contracts, their data, the fixture-only chat
  for (const id of [W.ptA, W.a1, W.a2]) assert.equal(await userExists(id), false, "fixture user removed");
  for (const c of [W.cA1, W.cA2]) assert.equal(await exists('user', 'contracts', c), false);
  assert.equal((await clients.user.query(`SELECT count(*)::int n FROM sessions WHERE contract_id = ANY($1)`, [[W.cA1, W.cA2]])).rows[0].n, 0, "their sessions went with the contract");
  for (const t of ['user_profiles', 'inbody_entries', 'notifications', 'pt_availability']) {
    const col = t === 'user_profiles' ? '"userId"' : t === 'pt_availability' ? 'pt_user_id' : 'user_id';
    assert.equal((await clients.user.query(`SELECT count(*)::int n FROM ${t} WHERE ${col} = ANY($1)`, [[W.ptA, W.a1, W.a2]])).rows[0].n, 0, t);
  }
  assert.equal((await clients.fitness.query(`SELECT count(*)::int n FROM workouts WHERE user_id = ANY($1)`, [[W.ptA, W.a1, W.a2]])).rows[0].n, 0);
  assert.equal((await clients.ai.query(`SELECT count(*)::int n FROM workout_plans WHERE user_id = ANY($1)`, [[W.ptA, W.a1, W.a2]])).rows[0].n, 0);
  assert.equal(await exists('chat', 'conversations', W.chatFixture), false, "fixture-only conversation removed");
  assert.equal(await exists('chat', 'conversations', W.chatMixed), true, "a conversation with a real participant is kept");

  // kept: restriction history, extension, settlement rows (obligation + orphan), their contracts and users
  assert.equal(await exists('user', 'pt_restrictions', W.restriction), true, "restriction history remains");
  assert.equal(await exists('user', 'pt_restriction_contract_extensions', W.extension), true, "restriction extension remains");
  assert.equal(await exists('user', 'session_settlements', W.settlement), true, "settlement row with an obligation remains");
  const orphanNow = (await clients.user.query(`SELECT to_jsonb(x) j FROM session_settlements x WHERE id = $1`, [W.orphan])).rows[0].j;
  const orphanBefore = JSON.parse(before['user.session_settlements'].find((j) => JSON.parse(j).id === W.orphan));
  assert.deepEqual(orphanNow, orphanBefore, "an orphan settlement row is byte-identical");
  for (const c of [W.cB1, W.cB2, W.cC, W.cD]) assert.equal(await exists('user', 'contracts', c), true, "kept contract");
  for (const u of [W.ptB, W.b1, W.b2, W.c1, W.ptD, W.d1, W.realPt, W.unproven, W.wrongRole]) assert.equal(await userExists(u), true, "kept account");

  // every table except the deleted rows is unchanged
  const after = await snapshot();
  for (const k of ['user.pt_restrictions', 'user.pt_restriction_contract_extensions', 'user.session_settlements']) assert.deepEqual(after[k], before[k], k);
  assert.match(r.out, /contracts KEPT: 4/);

  // idempotent: a second apply finds nothing more to do and changes nothing
  const again = runScript([...SAFE, '--apply']);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /Nothing to clean up/);
  assert.deepEqual(await snapshot(), after);
});

test("--max-users refuses --apply when more users would be removed than allowed (nothing written)", { skip }, async () => {
  await seedWorld();
  const before = await snapshot();
  const r = runScript([...SAFE, '--apply', '--max-users=2']);
  assert.equal(r.code, 1);
  assert.match(r.err, /3 fixture users would be removed, more than --max-users=2/);
  assert.deepEqual(await snapshot(), before);
});

test("a settlement row on a plain contract keeps that contract and, through the contract graph, every fixture account connected to it", { skip }, async () => {
  const W = await seedWorld();
  await clients.user.query(`INSERT INTO session_settlements (id,kind,idempotency_key,contract_id,status,attempts,updated_at) VALUES ($1,'SESSION_RELEASE',$2,$3,'PENDING',0,$4)`, [uid(), `k-${uid()}`, W.cA1, now]);
  const r = runScript([...SAFE, '--apply']);
  assert.equal(r.code, 0, r.err);
  // the settlement row on cA1 was seen at planning time, so cA1 and its parties were kept (history first)
  assert.equal(await exists('user', 'contracts', W.cA1), true);
  assert.equal(await userExists(W.a1), true);
  assert.equal(await userExists(W.ptA), true, "kept via the contract graph");
  assert.equal(await userExists(W.a2), true, "kept via the shared PT");
});
