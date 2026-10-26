/**
 * Test helpers for db-clean (TEST FIXTURE / BACKEND INTEGRATION). Everything runs on the TEST container (localhost:55433) against
 * databases gymcoach_<svc>_dbclean_test that this file creates (schema cloned from the dev databases with pg_dump --schema-only, so
 * the structure is the real one) and drops again. It never connects to the dev server for writing (schema-only dump = read).
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const pg = require('pg');
export const SERVICES = ['auth', 'user', 'fitness', 'ai', 'chat', 'payment', 'gym'];
export const SUFFIX = '_dbclean_test';
export const TEST = { host: 'localhost', port: 55433, user: 'gymcoach_test', password: 'gymcoach_test_password' };
export const db = (svc, suffix = SUFFIX) => `gymcoach_${svc}${suffix}`;
export const TEST_CONTAINER = 'gymcoach-test-postgres-test-1';
export const DEV_CONTAINER = 'gymcoach-postgres';

export async function client(database) {
  const c = new pg.Client({ ...TEST, database });
  await c.connect();
  return c;
}

/** (Re)create the seven databases and clone the dev schema into them (schema only). */
export async function createDatabases(suffix = SUFFIX) {
  colCache.clear();
  const adm = await client('postgres');
  for (const s of SERVICES) {
    await adm.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db(s, suffix)}'`);
    await adm.query(`DROP DATABASE IF EXISTS "${db(s, suffix)}"`);
    await adm.query(`CREATE DATABASE "${db(s, suffix)}"`);
    const dump = spawnSync('docker', ['exec', '-e', 'PGPASSWORD=gymcoach_password', DEV_CONTAINER, 'pg_dump', '-U', 'gymcoach', '-s', '--no-owner', '--no-privileges', `gymcoach_${s}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (dump.status !== 0) throw new Error(`schema dump of gymcoach_${s} failed: ${dump.stderr}`);
    const load = spawnSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=gymcoach_test_password', TEST_CONTAINER, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'gymcoach_test', '-d', db(s, suffix)], { input: dump.stdout, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (load.status !== 0) throw new Error(`schema load of ${db(s, suffix)} failed: ${load.stderr}`);
  }
  await adm.end();
}
export async function dropDatabases(suffix = SUFFIX) {
  const adm = await client('postgres');
  for (const s of SERVICES) {
    await adm.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db(s, suffix)}'`);
    await adm.query(`DROP DATABASE IF EXISTS "${db(s, suffix)}"`);
    await adm.query(`DROP DATABASE IF EXISTS "${db(s, suffix)}_restorecheck"`);
  }
  await adm.end();
}


let fillSeq = 0;
const colCache = new Map();
async function required(c, table) {
  const key = `${c.database}.${table}`;
  if (colCache.has(key)) return colCache.get(key);
  const r = await c.query(
    `SELECT a.attname, t.typname, t.typtype, t.oid AS toid, t.typelem FROM pg_attribute a JOIN pg_class k ON k.oid = a.attrelid JOIN pg_namespace n ON n.oid = k.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND k.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND d.adbin IS NULL`,
    [table],
  );
  colCache.set(key, r.rows);
  return r.rows;
}
async function filler(c, col) {
  if (col.typtype === 'e') return (await c.query('SELECT enumlabel FROM pg_enum WHERE enumtypid = $1 ORDER BY enumsortorder LIMIT 1', [col.toid])).rows[0].enumlabel;
  if (col.typname.startsWith('_')) return '{}';
  switch (col.typname) {
    case 'text': case 'varchar': return `x${++fillSeq}`;
    case 'int2': case 'int4': case 'int8': case 'float4': case 'float8': case 'numeric': return 0;
    case 'bool': return false;
    case 'timestamp': case 'timestamptz': return new Date().toISOString();
    case 'date': return '2026-01-01';
    case 'jsonb': case 'json': return '{}';
    default: throw new Error(`no filler for ${col.typname} (${col.attname})`);
  }
}
/** Insert one row, filling every NOT NULL column that has no default. */
export async function ins(c, table, values) {
  const req = await required(c, table);
  const row = { ...values };
  for (const col of req) if (!(col.attname in row)) row[col.attname] = await filler(c, col);
  const cols = Object.keys(row);
  const sql = `INSERT INTO "${table}" (${cols.map((x) => `"${x}"`).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`;
  await c.query(sql, cols.map((k) => row[k]));
}

export const ID = {
  keepA: 'u-keep-admin', keepB: 'u-keep-john',
  del1: 'u-del-1', del2: 'u-del-2', del3: 'u-del-3',
};
export const EMAIL = { keepA: 'admin@example.com', keepB: 'john.doe@example.com', del1: 'del1@x.test', del2: 'del2@x.test', del3: 'del3@x.test' };

/** The standard data set. Returns open clients keyed by service. */
export async function seedData(suffix = SUFFIX) {
  const c = {};
  for (const s of SERVICES) c[s] = await client(db(s, suffix));
  // ---- auth
  for (const [k, id] of Object.entries(ID)) {
    await ins(c.auth, 'users', { id, email: EMAIL[k], password: 'h', firstName: k, lastName: 'T', role: k === 'keepA' ? 'ADMIN' : 'CUSTOMER', isActive: true });
    await ins(c.auth, 'audit_logs', { id: `al-${id}`, userId: id, action: 'LOGIN' });
    await ins(c.auth, 'audit_logs', { id: `al2-${id}`, userId: id, action: 'LOGOUT' });
    await ins(c.auth, 'refresh_tokens', { id: `rt-${id}`, token: `tok-${id}`, userId: id, expiresAt: new Date(Date.now() + 1e9).toISOString() });
  }
  await ins(c.auth, 'email_verifications', { id: 'ev-keep', email: EMAIL.keepA });
  await ins(c.auth, 'email_verifications', { id: 'ev-del', email: 'gone@x.test' });
  // ---- user
  for (const [k, id] of Object.entries(ID)) await ins(c.user, 'user_profiles', { id: `up-${id}`, userId: id, email: EMAIL[k], firstName: k, lastName: 'T' });
  const contract = async (id, pt, client_, status = 'ACTIVE') => ins(c.user, 'contracts', { id, pt_user_id: pt, client_user_id: client_, status, source: 'INDEPENDENT' });
  await contract('ct-keep', ID.keepB, ID.keepA); // both preserved: kept
  await contract('ct-mixed', ID.keepB, ID.del1); // one preserved + one deleted: deleted
  await contract('ct-del', ID.del2, ID.del1);
  await contract('ct-del-dup', ID.del2, ID.del1, 'CANCELLED'); // second contract of the same pair (a live duplicate is now blocked by contracts_one_live_per_pair), both deleted
  for (const ct of ['ct-keep', 'ct-mixed', 'ct-del']) {
    await ins(c.user, 'sessions', { id: `se-${ct}`, contract_id: ct, client_user_id: ct === 'ct-keep' ? ID.keepA : ID.del1, pt_user_id: ct === 'ct-keep' ? ID.keepB : ID.del2 });
    await ins(c.user, 'session_reviews', { id: `sr-${ct}`, session_id: `se-${ct}`, contract_id: ct, client_user_id: ID.del1, rating: 5 });
    await ins(c.user, 'client_reviews', { id: `cr-${ct}`, session_id: `se-${ct}`, contract_id: ct, pt_user_id: ID.del2, rating: 5 });
  }
  await ins(c.user, 'pt_service_packages', { id: 'pk-keep', pt_user_id: ID.keepB, name: 'p' });
  await ins(c.user, 'pt_service_packages', { id: 'pk-del', pt_user_id: ID.del2, name: 'p' });
  await ins(c.user, 'notifications', { id: 'nt-keep', user_id: ID.keepA, text: 'x' });
  await ins(c.user, 'notifications', { id: 'nt-del', user_id: ID.del1, text: 'x' });
  await ins(c.user, 'vietnam_provinces', { code: 1, name: 'P', name_normalized: 'p', codename: 'p', division_type: 'x' });
  // ---- chat
  const conv = async (id, users) => {
    await ins(c.chat, 'conversations', { id });
    for (const [i, u] of users.entries()) await ins(c.chat, 'conversation_participants', { id: `cp-${id}-${i}`, conversationId: id, userId: u });
    await ins(c.chat, 'messages', { id: `m-${id}`, conversationId: id, senderId: users[0], content: 'hi' });
  };
  await conv('cv-keep', [ID.keepA, ID.keepB]);
  await conv('cv-mixed', [ID.keepA, ID.del1]);
  await conv('cv-del', [ID.del1, ID.del2]);
  // ---- gym
  await ins(c.gym, 'gym_brands', { id: 'br-keep', owner_id: ID.keepA, name: 'K' });
  await ins(c.gym, 'gym_brands', { id: 'br-del', owner_id: ID.del1, name: 'D' });
  await ins(c.gym, 'gyms', { id: 'gy-keep', owner_id: ID.keepA, name: 'K', brand_id: 'br-keep' });
  await ins(c.gym, 'gyms', { id: 'gy-del1', owner_id: ID.del1, name: 'D1', brand_id: 'br-del' });
  await ins(c.gym, 'gyms', { id: 'gy-del2', owner_id: ID.del1, name: 'D2', brand_id: 'br-del' });
  await ins(c.gym, 'amenities', { id: 'am-1', slug: 'a1', name: 'A1', name_normalized: 'a1' });
  await ins(c.gym, 'amenities', { id: 'am-2', slug: 'a2', name: 'A2', name_normalized: 'a2' });
  for (const [g, a] of [['gy-keep', 'am-1'], ['gy-keep', 'am-2'], ['gy-del1', 'am-1'], ['gy-del1', 'am-2'], ['gy-del2', 'am-1']]) await ins(c.gym, 'gym_amenities', { gym_id: g, amenity_id: a });
  await ins(c.gym, 'gym_photos', { id: 'ph-keep', gym_id: 'gy-keep', file_name: 'a.jpg' });
  await ins(c.gym, 'gym_photos', { id: 'ph-del', gym_id: 'gy-del1', file_name: 'b.jpg' });
  await ins(c.gym, 'gym_membership_plans', { id: 'mp-keep', brand_id: 'br-keep', name: 'p' });
  await ins(c.gym, 'gym_membership_plans', { id: 'mp-del', brand_id: 'br-del', name: 'p' });
  await ins(c.gym, 'gym_membership_contracts', { id: 'mc-keep', gym_id: 'gy-keep', plan_id: 'mp-keep', client_id: ID.keepB });
  await ins(c.gym, 'gym_membership_contracts', { id: 'mc-mixed', gym_id: 'gy-keep', plan_id: 'mp-keep', client_id: ID.del1 });
  await ins(c.gym, 'gym_membership_contracts', { id: 'mc-del', gym_id: 'gy-del1', plan_id: 'mp-del', client_id: ID.del2 });
  await ins(c.gym, 'gym_partners', { id: 'gp-keep', legal_name: 'K' });
  await ins(c.gym, 'gym_partners', { id: 'gp-del', legal_name: 'D' });
  await ins(c.gym, 'gym_partner_accounts', { id: 'gpa-keep', partner_id: 'gp-keep', user_id: ID.keepA });
  await ins(c.gym, 'gym_partner_accounts', { id: 'gpa-del', partner_id: 'gp-del', user_id: ID.del1 });
  await ins(c.gym, 'partner_audit_logs', { id: 'pal-keep', partner_id: 'gp-keep' });
  await ins(c.gym, 'partner_audit_logs', { id: 'pal-del', partner_id: 'gp-del' });
  // ---- payment
  const wallet = (id, type, owner) => ins(c.payment, 'wallets', { id, owner_type: type, owner_id: owner });
  await wallet('w-plat', 'PLATFORM', 'platform');
  await wallet('w-keepA', 'CLIENT', ID.keepA);
  await wallet('w-del1', 'CLIENT', ID.del1);
  await wallet('w-gym-keep', 'GYM', 'gy-keep');
  await wallet('w-gym-del', 'GYM', 'gy-del1');
  const tx = (id, payer) => ins(c.payment, 'payment_transactions', { id, payer_id: payer, amount: 100 });
  await tx('tx-keep', ID.keepA);
  await tx('tx-del', ID.del1);
  await tx('tx-pinned', ID.del1); // payer is deleted but a surviving wallet holds its ledger entry
  await ins(c.payment, 'wallet_ledger_entries', { id: 'le-keep', wallet_id: 'w-keepA', transaction_id: 'tx-keep' });
  await ins(c.payment, 'wallet_ledger_entries', { id: 'le-del', wallet_id: 'w-del1', transaction_id: 'tx-del' });
  await ins(c.payment, 'wallet_ledger_entries', { id: 'le-pinned', wallet_id: 'w-keepA', transaction_id: 'tx-pinned' });
  await ins(c.payment, 'wallet_ledger_entries', { id: 'le-pinned2', wallet_id: 'w-del1', transaction_id: 'tx-pinned' });
  // ---- fitness / ai (partner-owned)
  await ins(c.fitness, 'workouts', { id: 'wo-keep', user_id: ID.keepA, name: 'w' });
  await ins(c.fitness, 'workouts', { id: 'wo-del', user_id: ID.del1, name: 'w' });
  await ins(c.fitness, 'body_metrics', { id: 'bm-del', user_id: ID.del1 });
  await ins(c.ai, 'chat_sessions', { id: 'cs-keep', user_id: ID.keepA });
  await ins(c.ai, 'chat_sessions', { id: 'cs-del', user_id: ID.del1 });
  return c;
}

export async function closeAll(c) {
  await Promise.all(Object.values(c).map((x) => x.end().catch(() => {})));
}
export async function count(c, table) {
  return Number((await c.query(`SELECT count(*) FROM "${table}"`)).rows[0].count);
}
export async function counts(suffix = SUFFIX) {
  const out = {};
  for (const s of SERVICES) {
    const c = await client(db(s, suffix));
    const t = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).rows.map((r) => r.tablename);
    out[s] = {};
    for (const n of t) out[s][n] = await count(c, n);
    await c.end();
  }
  return out;
}
