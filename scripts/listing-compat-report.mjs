#!/usr/bin/env node
/**
 * Listing Management B3 - the evidence report for switching LISTING_LEGACY_CLIENT_COMPAT off (plan section 4, 12.14 item 4,
 * 12.15 items 3-4). READ ONLY: it opens ONE `BEGIN READ ONLY` transaction on the gym-service database, runs SELECT / WITH
 * statements only and rolls back. It never switches the flag: it reports, Ngai decides.
 *
 *   node scripts/listing-compat-report.mjs <DATABASE_URL> [--days=14] [--schema=<name>] [--json]
 *   (DATABASE_URL may also come from the environment.)  Exit code: 0 = eligible, 3 = not eligible, 1 = error.
 *
 * Window (12.15 item 3):   windowStart = max( migration finished_at, firstWriterAt, last WRITER_ABSENT + 1 second )
 *   firstWriterAt = min(seen_at) of compat_writer_heartbeats with writer_version = 'v1'. No heartbeat at all ->
 *   "khong chung minh duoc lich su trien khai" (not eligible).
 *
 * "DU DIEU KIEN" is printed ONLY when all of these hold:
 *   1. now - windowStart >= <days> days.
 *   2. No WRITER_ABSENT in the window (nor in the last <days> days).
 *   3. No heartbeat gap > 30 minutes inside the window while writes happened (a write = gyms / gym_partners updated_at or any
 *      legacy_compat_events row). Window start and "now" count as boundaries.
 *   4. Zero legacy activity in the window (events whose outcome is not NON_CLIENT), zero gyms / gym_partners with
 *      legacy_client_at in the window, zero client_compat_events (telemetry) in the window.
 *   5. Reconciliation, BOTH directions (anti-join): every ACCEPTED event in the window has an entity whose legacy_client_at is >= its
 *      occurred_at; every entity with legacy_client_at in the window has an ACCEPTED event at exactly that instant.
 *      REJECTED_422 and REJECTED_OTHER (any other 4xx refusal of an old-client request) have no entity update, so they are NOT
 *      inconsistencies - but being in the window they count as legacy activity and already break condition 4.
 */
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const DEFAULT_DAYS = 14;
const MAX_HEARTBEAT_GAP_MINUTES = 30;

/** Every statement this script can run. The CI test asserts each one is a SELECT / WITH (read only). */
export const QUERIES = {
  migration: `SELECT max(finished_at) AS finished_at FROM _prisma_migrations
               WHERE migration_name LIKE '%amenity_catalog_listing_revisions' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  now: `SELECT now() AS now`,
  firstWriter: `SELECT min(seen_at) AS first_writer_at, max(seen_at) AS last_seen_at, count(*)::int AS n
                 FROM compat_writer_heartbeats WHERE writer_version = 'v1'`,
  lastWriterAbsent: `SELECT max(occurred_at) AS last_at FROM legacy_compat_events WHERE outcome = 'WRITER_ABSENT'`,
  writerAbsentSince: `SELECT count(*)::int AS n FROM legacy_compat_events WHERE outcome = 'WRITER_ABSENT' AND occurred_at >= $1`,
  heartbeatsInWindow: `SELECT seen_at FROM compat_writer_heartbeats WHERE writer_version = 'v1' AND seen_at >= $1 AND seen_at <= $2 ORDER BY seen_at`,
  writesBetween: `SELECT
                    (SELECT count(*) FROM gyms WHERE (updated_at AT TIME ZONE 'UTC') > $1 AND (updated_at AT TIME ZONE 'UTC') < $2)
                  + (SELECT count(*) FROM gym_partners WHERE (updated_at AT TIME ZONE 'UTC') > $1 AND (updated_at AT TIME ZONE 'UTC') < $2)
                  + (SELECT count(*) FROM legacy_compat_events WHERE occurred_at > $1 AND occurred_at < $2) AS n`,
  activityByOutcome: `SELECT outcome::text AS outcome, action, count(*)::int AS n FROM legacy_compat_events
                       WHERE occurred_at >= $1 AND outcome <> 'NON_CLIENT' GROUP BY 1, 2 ORDER BY 1, 2`,
  partnerLegacyClient: `SELECT count(*)::int AS n FROM gym_partners WHERE legacy_client_at >= $1`,
  gymLegacyClient: `SELECT count(*)::int AS n FROM gyms WHERE legacy_client_at >= $1`,
  telemetry: `SELECT outcome::text AS outcome, count(*)::int AS n FROM client_compat_events WHERE created_at >= $1 GROUP BY 1 ORDER BY 1`,
  acceptedWithoutEntity: `SELECT e.id, e.entity_type::text AS entity_type, e.entity_id, e.occurred_at
                            FROM legacy_compat_events e
                            LEFT JOIN gym_partners p ON e.entity_type = 'GYM_PARTNER' AND p.id = e.entity_id
                            LEFT JOIN gyms g         ON e.entity_type = 'GYM'         AND g.id = e.entity_id
                           WHERE e.outcome = 'ACCEPTED' AND e.occurred_at >= $1
                             AND (COALESCE(p.legacy_client_at, g.legacy_client_at) IS NULL
                                  OR COALESCE(p.legacy_client_at, g.legacy_client_at) < e.occurred_at)
                           ORDER BY e.occurred_at LIMIT 50`,
  entityWithoutEvent: `SELECT 'GYM' AS entity_type, g.id AS entity_id, g.legacy_client_at FROM gyms g
                        WHERE g.legacy_client_at >= $1
                          AND NOT EXISTS (SELECT 1 FROM legacy_compat_events e WHERE e.entity_type = 'GYM' AND e.entity_id = g.id
                                             AND e.outcome = 'ACCEPTED' AND e.occurred_at = g.legacy_client_at)
                       UNION ALL
                       SELECT 'GYM_PARTNER', p.id, p.legacy_client_at FROM gym_partners p
                        WHERE p.legacy_client_at >= $1
                          AND NOT EXISTS (SELECT 1 FROM legacy_compat_events e WHERE e.entity_type = 'GYM_PARTNER' AND e.entity_id = p.id
                                             AND e.outcome = 'ACCEPTED' AND e.occurred_at = p.legacy_client_at)
                       ORDER BY 3 LIMIT 50`,
};

const DAY_MS = 86_400_000;
const iso = (d) => (d instanceof Date ? d.toISOString() : String(d));

/**
 * Pure evaluation over an open client (already inside a READ ONLY transaction). Returns
 * { eligible, reasons[], windowStart, now, ... } - no printing, no writes.
 */
export async function evaluateCompatEvidence(client, opts = {}) {
  const days = opts.days ?? DEFAULT_DAYS;
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  const reasons = [];
  const detail = {};

  const now = opts.now ?? (await q(QUERIES.now))[0].now;
  const migrationAt = (await q(QUERIES.migration))[0]?.finished_at ?? null;
  const writer = (await q(QUERIES.firstWriter))[0];
  const firstWriterAt = writer?.first_writer_at ?? null;
  const lastAbsentAt = (await q(QUERIES.lastWriterAbsent))[0]?.last_at ?? null;
  Object.assign(detail, { migrationAt, firstWriterAt, lastWriterAbsentAt: lastAbsentAt, heartbeatCount: writer?.n ?? 0 });

  if (!migrationAt) {
    reasons.push('Không tìm thấy migration amenity_catalog_listing_revisions đã chạy xong trong _prisma_migrations — không có mốc bắt đầu.');
  }
  if (!firstWriterAt) {
    reasons.push('Không chứng minh được lịch sử triển khai: chưa có nhịp tim (compat_writer_heartbeats) của writer v1 nào.');
  }
  if (!migrationAt || !firstWriterAt) return finish(false);

  const candidates = [new Date(migrationAt), new Date(firstWriterAt)];
  if (lastAbsentAt) candidates.push(new Date(new Date(lastAbsentAt).getTime() + 1000));
  const windowStart = new Date(Math.max(...candidates.map((d) => d.getTime())));
  const nowDate = new Date(now);
  const elapsedDays = (nowDate.getTime() - windowStart.getTime()) / DAY_MS;
  Object.assign(detail, { windowStart, now: nowDate, elapsedDays });

  // 1. the window is long enough
  if (elapsedDays < days) {
    reasons.push(
      `Cửa sổ chứng minh mới ${elapsedDays.toFixed(2)} ngày (bắt đầu ${iso(windowStart)}), cần ít nhất ${days} ngày` +
        (lastAbsentAt && windowStart.getTime() === new Date(new Date(lastAbsentAt).getTime() + 1000).getTime()
          ? ` — cửa sổ bị đặt lại bởi WRITER_ABSENT lúc ${iso(lastAbsentAt)}.`
          : '.'),
    );
  }

  // 2. no WRITER_ABSENT in the window / in the last <days> days
  const lookback = new Date(Math.min(windowStart.getTime(), nowDate.getTime() - days * DAY_MS));
  const absent = (await q(QUERIES.writerAbsentSince, [lookback]))[0].n;
  detail.writerAbsentInWindow = absent;
  if (absent > 0) reasons.push(`Có ${absent} sự kiện WRITER_ABSENT (ghi vào gyms / gym_partners mà không qua writer) từ ${iso(lookback)}.`);

  // 3. no heartbeat gap > 30 minutes while writes happened
  const beats = (await q(QUERIES.heartbeatsInWindow, [windowStart, nowDate])).map((r) => new Date(r.seen_at));
  const points = [windowStart, ...beats, nowDate];
  const gaps = [];
  for (let i = 1; i < points.length; i++) {
    const gapMin = (points[i].getTime() - points[i - 1].getTime()) / 60_000;
    if (gapMin <= MAX_HEARTBEAT_GAP_MINUTES) continue;
    const writes = (await q(QUERIES.writesBetween, [points[i - 1], points[i]]))[0].n;
    if (Number(writes) > 0) gaps.push({ from: points[i - 1], to: points[i], minutes: Math.round(gapMin), writes: Number(writes) });
  }
  detail.heartbeatGapsWithWrites = gaps;
  for (const g of gaps) {
    reasons.push(`Nhịp tim ngắt ${g.minutes} phút (${iso(g.from)} → ${iso(g.to)}) trong khi vẫn có ${g.writes} lần ghi — không chứng minh được writer chạy suốt.`);
  }

  // 4. zero legacy activity (events, entities, telemetry)
  const activity = await q(QUERIES.activityByOutcome, [windowStart]);
  const partnersLegacy = (await q(QUERIES.partnerLegacyClient, [windowStart]))[0].n;
  const gymsLegacy = (await q(QUERIES.gymLegacyClient, [windowStart]))[0].n;
  const telemetry = await q(QUERIES.telemetry, [windowStart]);
  Object.assign(detail, { activity, partnersLegacy, gymsLegacy, telemetry });
  if (activity.length > 0) {
    reasons.push(`Còn hoạt động tương thích trong cửa sổ: ${activity.map((a) => `${a.outcome}/${a.action}=${a.n}`).join(', ')}.`);
  }
  if (partnersLegacy > 0) reasons.push(`${partnersLegacy} hồ sơ (gym_partners) có legacy_client_at trong cửa sổ.`);
  if (gymsLegacy > 0) reasons.push(`${gymsLegacy} chi nhánh (gyms) có legacy_client_at trong cửa sổ.`);
  if (telemetry.length > 0) {
    reasons.push(`Telemetry client_compat_events khác 0 trong cửa sổ: ${telemetry.map((t) => `${t.outcome}=${t.n}`).join(', ')}.`);
  }

  // 5. reconciliation, both directions
  const accepted = await q(QUERIES.acceptedWithoutEntity, [windowStart]);
  const orphans = await q(QUERIES.entityWithoutEvent, [windowStart]);
  Object.assign(detail, { acceptedWithoutEntity: accepted, entityWithoutEvent: orphans });
  if (accepted.length > 0 || orphans.length > 0) {
    reasons.push(
      `Dữ liệu không nhất quán — không đạt điều kiện: ${accepted.length} sự kiện ACCEPTED mà thực thể không có legacy_client_at tương ứng` +
        ` (vd: ${accepted.slice(0, 3).map((a) => `${a.entity_type}:${a.entity_id}`).join(', ') || '—'}), ` +
        `${orphans.length} thực thể có legacy_client_at mà không có sự kiện ACCEPTED đúng thời điểm` +
        ` (vd: ${orphans.slice(0, 3).map((o) => `${o.entity_type}:${o.entity_id}`).join(', ') || '—'}).`,
    );
  }
  return finish(reasons.length === 0);

  function finish(eligible) {
    return { eligible, reasons, days, ...detail };
  }
}

/** Opens one READ ONLY transaction, evaluates, rolls back. */
export async function runReport(databaseUrl, opts = {}) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    if (opts.schema) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(opts.schema)) throw new Error('--schema không hợp lệ');
      await client.query(`SET LOCAL search_path TO "${opts.schema}"`);
    }
    return await evaluateCompatEvidence(client, opts);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

export function formatReport(r) {
  const lines = [];
  lines.push('=== Báo cáo bằng chứng tắt cờ LISTING_LEGACY_CLIENT_COMPAT (chỉ đọc) ===');
  lines.push(`Migration chạy xong : ${r.migrationAt ? iso(r.migrationAt) : '—'}`);
  lines.push(`Nhịp tim v1 đầu tiên: ${r.firstWriterAt ? iso(r.firstWriterAt) : '—'}  (${r.heartbeatCount ?? 0} nhịp)`);
  lines.push(`WRITER_ABSENT gần nhất: ${r.lastWriterAbsentAt ? iso(r.lastWriterAbsentAt) : 'chưa có'}`);
  if (r.windowStart) {
    lines.push(`Cửa sổ bắt đầu      : ${iso(r.windowStart)}  (đã ${r.elapsedDays.toFixed(2)} / ${r.days} ngày)`);
  }
  lines.push('');
  if (r.eligible) {
    lines.push('ĐỦ ĐIỀU KIỆN');
    lines.push('(Báo cáo không tự tắt cờ. Ngài quyết định; điều kiện 1 — APK mới đã phát hành — nằm ngoài dữ liệu này.)');
  } else {
    // NOT the phrase "KHÔNG ĐỦ ĐIỀU KIỆN": it would contain the eligible phrase and fool a grep.
    lines.push('CHƯA THỂ TẮT CỜ — các điều kiện bên dưới chưa đạt');
    for (const reason of r.reasons) lines.push(`  - ${reason}`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const out = { days: DEFAULT_DAYS, json: false, schema: undefined, url: undefined };
  for (const a of argv) {
    if (a === '--json') out.json = true;
    else if (a.startsWith('--days=')) out.days = Number(a.slice(7));
    else if (a.startsWith('--schema=')) out.schema = a.slice(9);
    else if (a.startsWith('--database-url=')) out.url = a.slice(15);
    else if (!a.startsWith('--') && !out.url) out.url = a;
    else throw new Error(`Tham số không hợp lệ: ${a}`);
  }
  out.url = out.url || process.env.DATABASE_URL;
  if (!out.url) throw new Error('Thiếu DATABASE_URL (tham số đầu tiên hoặc biến môi trường).');
  if (!Number.isFinite(out.days) || out.days <= 0) throw new Error('--days không hợp lệ');
  return out;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = await runReport(args.url, { days: args.days, schema: args.schema });
    console.log(args.json ? JSON.stringify(report, null, 2) : formatReport(report));
    process.exitCode = report.eligible ? 0 : 3;
  } catch (e) {
    console.error(`Lỗi: ${e.message}`);
    process.exitCode = 1;
  }
}
