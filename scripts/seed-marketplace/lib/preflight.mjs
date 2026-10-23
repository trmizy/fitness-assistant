import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SeedGuardError, ALL_SERVICES } from './guard.mjs';

const referenceTables = {
  auth: [], user: ['vietnam_provinces', 'vietnam_wards'],
  fitness: ['muscles'], ai: ['knowledge_sources'], chat: [], payment: [],
  gym: ['amenities', 'platform_commission_rates', 'compat_writer_heartbeats'],
};
const quote = name => `"${name.replaceAll('"', '""')}"`;
export async function allTableCounts(pools) {
  const out = {};
  for (const [service, pool] of Object.entries(pools)) {
    const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    for (const { tablename } of rows) {
      const r = await pool.query(`SELECT count(*)::int n FROM public.${quote(tablename)}`);
      out[`${service}.${tablename}`] = r.rows[0].n;
    }
  }
  return out;
}

export function assertEmptyBusinessTables(counts) {
  const nonempty = Object.entries(counts).filter(([key, count]) => {
    const [service, table] = key.split('.');
    return count > 0 && table !== '_prisma_migrations' && !referenceTables[service]?.includes(table);
  });
  if (nonempty.length) throw new SeedGuardError('FRESH_NOT_EMPTY', `Fresh target contains rows: ${nonempty.map(([k,n]) => `${k}=${n}`).join(', ')}`);
}

export function targetFingerprint(target) {
  return createHash('sha256').update(JSON.stringify({ host: target.host, port: target.port, dbs: target.dbs })).digest('hex');
}

/** Local receipt binds an explicitly checked empty target to subsequent ensure-only runs.
 * It never authorizes a different host/port/database set. No credentials are persisted. */
export async function checkFreshTarget(target, pools, { reseed = false, receiptDir = 'scripts/seed-marketplace/.runtime' } = {}) {
  if (ALL_SERVICES.some(s => !pools[s])) throw new SeedGuardError('NO_TARGET', 'Fresh checks require all seven databases.');
  const fingerprint = targetFingerprint(target);
  const file = path.join(receiptDir, `${fingerprint}.json`);
  if (reseed) {
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (receipt?.fingerprint !== fingerprint || !receipt?.checkedEmptyAt) throw new SeedGuardError('FRESH_RECEIPT_REQUIRED', 'No matching empty-database receipt; cannot reseed this target.');
    return receipt;
  }
  const counts = await allTableCounts(pools);
  // payment-service bootstraps its empty custodial wallet before accepting requests.
  // Only empty PLATFORM system wallets are reference rows; user wallets always block.
  const businessCounts = { ...counts };
  businessCounts['payment.wallets'] = (await pools.payment.query("SELECT count(*)::int n FROM wallets WHERE owner_type <> 'PLATFORM' OR owner_id NOT IN ('ESCROW','REVENUE') OR available_balance <> 0 OR pending_balance <> 0 OR locked_balance <> 0 OR holdback_balance <> 0")).rows[0].n;
  assertEmptyBusinessTables(businessCounts);
  const receipt = { fingerprint, checkedEmptyAt: new Date().toISOString(), dbs: target.dbs, initialCounts: counts };
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2));
  return receipt;
}
