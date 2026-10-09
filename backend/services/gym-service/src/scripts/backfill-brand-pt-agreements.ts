/**
 * Điền dữ liệu thoả thuận Gym–PT cấp THƯƠNG HIỆU từ các dòng cũ cấp chi nhánh
 * (docs/GYM_PT_BRAND_PARTNERSHIP_AUDIT.md §C.4–C.5). Chỉ chạm các bảng/cột do migration
 * 20261010000000_brand_pt_agreements thêm vào; KHÔNG sửa điều khoản (tỷ lệ, status, accepted_at...)
 * của bất kỳ dòng gym_pt_collaborations nào. Chưa có mã dịch vụ nào đọc kết quả.
 *
 * Cách dùng (chạy trong backend/services/gym-service, cần DATABASE_URL):
 *   ./node_modules/.bin/tsx src/scripts/backfill-brand-pt-agreements.ts                     # chạy thử (mặc định, không ghi DB)
 *   ./node_modules/.bin/tsx src/scripts/backfill-brand-pt-agreements.ts --apply             # ghi thật
 *   ./node_modules/.bin/tsx src/scripts/backfill-brand-pt-agreements.ts --rollback          # chạy thử việc lùi
 *   ./node_modules/.bin/tsx src/scripts/backfill-brand-pt-agreements.ts --rollback --apply  # lùi thật
 *   thêm --report <đường-dẫn.json> để chọn nơi ghi báo cáo xung đột
 *   (mặc định: ./brand-pt-agreement-conflicts-<mode>-<thời-điểm>.json trong thư mục hiện tại).
 *
 * Quy tắc cho từng cặp (brand, PT) — chỉ xét dòng ACCEPTED, chưa bị thay thế, thuộc gym có thương hiệu:
 *   - 1 dòng sạch (effective_at NULL)                      -> 1 thoả thuận ACCEPTED/MIGRATED, cùng 3 tỷ lệ
 *   - nhiều dòng sạch, cùng bảng tỷ lệ                     -> 1 thoả thuận, accepted_at = sớm nhất
 *   - nhiều dòng sạch, KHÁC bảng tỷ lệ                     -> XUNG ĐỘT: không tạo thoả thuận, không chọn tỷ lệ nào
 *   - vừa có dòng sạch vừa có dòng đang chấm dứt           -> XUNG ĐỘT
 *   - chỉ có dòng đang chấm dứt (effective_at != NULL)     -> bỏ qua
 *   - cặp đã có thoả thuận ACCEPTED ở bảng mới             -> bỏ qua (chỉ mục duy nhất sẽ từ chối tạo thêm)
 *   Dòng PENDING/COUNTERED, TERMINATED/REJECTED/EXPIRED và dòng của gym không thương hiệu không bao giờ bị chạm.
 */
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { Prisma, PrismaClient } from '../generated/prisma';

// ───────────────────────────── Kiểu dữ liệu ─────────────────────────────

export type PairClass =
  | 'SINGLE'
  | 'IDENTICAL'
  | 'CONFLICT_RATES'
  | 'CONFLICT_MIXED'
  | 'WINDING_DOWN_ONLY'
  | 'ALREADY_COVERED';

export type PairAction =
  | 'CREATE_AGREEMENT'
  | 'RECORD_CONFLICT'
  | 'UPDATE_CONFLICT'
  | 'NONE_CONFLICT_ALREADY_RECORDED'
  | 'SKIP_WINDING_DOWN'
  | 'SKIP_ALREADY_COVERED';

export interface LegacyRowSummary {
  collaborationId: string;
  gymId: string;
  proposedPtRate: string;
  proposedGymRate: string;
  platformRate: string;
  acceptedAt: Date | null;
  windingDown: boolean;
}

export interface PairOutcome {
  brandId: string;
  ptUserId: string;
  class: PairClass;
  action: PairAction;
  legacyCollaborationIds: string[];
  /** Có khi action = CREATE_AGREEMENT và đã chạy thật (mã thoả thuận vừa tạo). */
  agreementId?: string;
  rates?: { pt: string; gym: string; platform: string };
  acceptedAt?: Date;
}

/** Một phần tử của báo cáo xung đột. Chỉ mã định danh + tỷ lệ — không tên/email/số điện thoại. */
export interface ConflictReportEntry {
  brand_id: string;
  pt_user_id: string;
  legacy_rows: Array<{
    collaboration_id: string;
    gym_id: string;
    proposed_pt_rate: string;
    proposed_gym_rate: string;
    platform_rate: string;
    accepted_at: string | null;
  }>;
}

export interface BackfillFailure {
  brandId: string;
  ptUserId: string;
  error: string;
}

export interface BackfillResult {
  mode: 'dry-run' | 'apply';
  /** Số CẶP (brand, PT) theo lớp. */
  pairCounts: Record<PairClass, number>;
  /** Số DÒNG cũ không thuộc diện chuyển đổi (không bao giờ bị chạm). */
  untouchedRowCounts: {
    openNegotiations: number; // PENDING + COUNTERED
    terminated: number;
    otherClosed: number; // REJECTED + EXPIRED
    brandlessGyms: number; // mọi trạng thái, gym.brand_id NULL
    alreadySuperseded: number; // ACCEPTED đã được một lần chạy trước gộp vào thoả thuận
  };
  /** Mã các dòng thuộc gym không thương hiệu (để người vận hành xử lý tay). */
  brandlessCollaborationIds: string[];
  pairs: PairOutcome[];
  conflictReport: ConflictReportEntry[];
  failures: BackfillFailure[];
}

export interface BackfillOptions {
  /** Mặc định false = chạy thử, không ghi gì vào DB. */
  apply?: boolean;
  /**
   * Giới hạn phạm vi theo PT (mặc định: toàn bộ DB). Dành cho kiểm thử chạy song song trên DB dùng chung
   * — để một bài test không chuyển đổi/xoá dữ liệu của bài khác. CLI không bật tuỳ chọn này.
   */
  ptUserIds?: string[];
  /** Mốc thời gian dùng cho superseded_at / resolved_at (mặc định now). */
  now?: Date;
  /**
   * Chỉ dành cho kiểm thử: chạy TRONG transaction của cặp, sau khi đã ghi và trước khi commit.
   * Ném lỗi ở đây để kiểm tra rằng một cặp lỗi bị hoàn tác hết mà không chặn các cặp khác.
   */
  beforeCommit?: (pair: { brandId: string; ptUserId: string }) => Promise<void>;
}

export interface RollbackResult {
  mode: 'dry-run' | 'apply';
  migratedAgreements: number;
  legacyRowsToClear: number;
  conflictRows: number;
}

export class RollbackRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RollbackRefusedError';
  }
}

type Db = PrismaClient | Prisma.TransactionClient;

// ───────────────────────────── Phân loại (thuần, không I/O) ─────────────────────────────

const rateTable = (r: LegacyRowSummary) => `${r.proposedPtRate}|${r.proposedGymRate}|${r.platformRate}`;
const fmt = (d: Prisma.Decimal) => d.toFixed(4);

/** Quyết định lớp + hành động cho một cặp, từ các dòng cũ chưa bị thay thế. Hàm thuần để dễ kiểm thử. */
export function classifyPair(
  rows: LegacyRowSummary[],
  coveredByAgreement: boolean,
  openConflict: { legacyCollaborationIds: string[] } | null,
): { class: PairClass; action: PairAction } {
  const clean = rows.filter((r) => !r.windingDown);
  const winding = rows.filter((r) => r.windingDown);

  if (coveredByAgreement) return { class: 'ALREADY_COVERED', action: 'SKIP_ALREADY_COVERED' };
  if (clean.length === 0) return { class: 'WINDING_DOWN_ONLY', action: 'SKIP_WINDING_DOWN' };

  let cls: PairClass;
  if (winding.length > 0) cls = 'CONFLICT_MIXED';
  else if (clean.length === 1) cls = 'SINGLE';
  else if (new Set(clean.map(rateTable)).size === 1) cls = 'IDENTICAL';
  else cls = 'CONFLICT_RATES';

  if (cls === 'SINGLE' || cls === 'IDENTICAL') return { class: cls, action: 'CREATE_AGREEMENT' };

  if (!openConflict) return { class: cls, action: 'RECORD_CONFLICT' };
  const sameIds =
    [...openConflict.legacyCollaborationIds].sort().join(',') === rows.map((r) => r.collaborationId).sort().join(',');
  return { class: cls, action: sameIds ? 'NONE_CONFLICT_ALREADY_RECORDED' : 'UPDATE_CONFLICT' };
}

// ───────────────────────────── Đọc dữ liệu ─────────────────────────────

async function loadPairRows(db: Db, brandId: string, ptUserId: string): Promise<LegacyRowSummary[]> {
  const rows = await db.gymPtCollaboration.findMany({
    where: { ptUserId, status: 'ACCEPTED', supersededByAgreementId: null, gym: { brandId } },
    orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => ({
    collaborationId: r.id,
    gymId: r.gymId,
    proposedPtRate: fmt(r.proposedPtRate),
    proposedGymRate: fmt(r.proposedGymRate),
    platformRate: fmt(r.platformRate),
    // acceptedAt null không nên xảy ra với ACCEPTED; dự phòng bằng created_at để vẫn có mốc.
    acceptedAt: r.acceptedAt ?? r.createdAt,
    windingDown: r.effectiveAt !== null,
  }));
}

function toReportEntry(brandId: string, ptUserId: string, rows: LegacyRowSummary[]): ConflictReportEntry {
  return {
    brand_id: brandId,
    pt_user_id: ptUserId,
    legacy_rows: rows.map((r) => ({
      collaboration_id: r.collaborationId,
      gym_id: r.gymId,
      proposed_pt_rate: r.proposedPtRate,
      proposed_gym_rate: r.proposedGymRate,
      platform_rate: r.platformRate,
      accepted_at: r.acceptedAt ? r.acceptedAt.toISOString() : null,
    })),
  };
}

// ───────────────────────────── Một cặp (brand, PT) ─────────────────────────────

/**
 * Xử lý một cặp. `write=false` -> chỉ tính kế hoạch. Khi `write=true`, `db` PHẢI là transaction của cặp.
 * Chạy lại an toàn: chỉ xét dòng chưa bị thay thế; kiểm thoả thuận ACCEPTED/xung đột OPEN đã có trước khi
 * chèn (chỉ mục duy nhất là chốt chặn cuối, không phải chốt chặn đầu).
 */
async function processPair(
  db: Db,
  brandId: string,
  ptUserId: string,
  write: boolean,
  now: Date,
): Promise<{ outcome: PairOutcome; rows: LegacyRowSummary[] } | null> {
  if (write) {
    // Khoá các dòng cũ của cặp để hai lần chạy đồng thời không cùng quyết định trên dữ liệu cũ.
    await (db as Prisma.TransactionClient).$queryRaw`
      SELECT c.id FROM gym_pt_collaborations c JOIN gyms g ON g.id = c.gym_id
      WHERE g.brand_id = ${brandId} AND c.pt_user_id = ${ptUserId}
      FOR UPDATE OF c`;
  }

  const rows = await loadPairRows(db, brandId, ptUserId);
  if (rows.length === 0) return null; // vừa bị đổi trạng thái/thay thế giữa lúc quét và lúc xử lý

  const covered = await db.gymBrandPtAgreement.findFirst({ where: { brandId, ptUserId, status: 'ACCEPTED' } });
  const openConflict = await db.gymPtAgreementConflict.findFirst({ where: { brandId, ptUserId, status: 'OPEN' } });
  const { class: cls, action } = classifyPair(rows, covered !== null, openConflict);

  const outcome: PairOutcome = {
    brandId,
    ptUserId,
    class: cls,
    action,
    legacyCollaborationIds: rows.map((r) => r.collaborationId),
  };

  if (action === 'CREATE_AGREEMENT') {
    // rows đã sắp theo accepted_at tăng dần -> rows[0] là dòng sớm nhất, dùng làm gốc (proposed_by, round, expires_at).
    const base = rows[0];
    outcome.rates = { pt: base.proposedPtRate, gym: base.proposedGymRate, platform: base.platformRate };
    outcome.acceptedAt = base.acceptedAt ?? undefined;
    if (write) {
      const baseRow = await db.gymPtCollaboration.findUniqueOrThrow({ where: { id: base.collaborationId } });
      const agreement = await db.gymBrandPtAgreement.create({
        data: {
          id: randomUUID(),
          brandId,
          ptUserId,
          proposedPtRate: baseRow.proposedPtRate,
          proposedGymRate: baseRow.proposedGymRate,
          platformRate: baseRow.platformRate,
          status: 'ACCEPTED',
          proposedBy: baseRow.proposedBy,
          round: baseRow.round,
          expiresAt: baseRow.expiresAt,
          acceptedAt: base.acceptedAt,
          origin: 'MIGRATED',
          note: `Chuyển từ ${rows.length} thoả thuận cấp chi nhánh: ${rows.map((r) => r.collaborationId).join(', ')}`,
        },
      });
      outcome.agreementId = agreement.id;
      // SQL thô để KHÔNG đổi updated_at của dòng cũ (@updatedAt của Prisma sẽ làm đổi) — lùi lại phải trả đúng nguyên trạng.
      await db.$executeRaw`
        UPDATE gym_pt_collaborations
        SET superseded_by_agreement_id = ${agreement.id}, superseded_at = ${now}
        WHERE id = ANY(${rows.map((r) => r.collaborationId)}::text[])`;
      if (openConflict) {
        await db.gymPtAgreementConflict.update({
          where: { id: openConflict.id },
          data: { status: 'RESOLVED', resolvedAgreementId: agreement.id, resolvedAt: now },
        });
      }
    }
  } else if (action === 'RECORD_CONFLICT') {
    if (write) {
      await db.gymPtAgreementConflict.create({
        data: { id: randomUUID(), brandId, ptUserId, legacyCollaborationIds: outcome.legacyCollaborationIds },
      });
    }
  } else if (action === 'UPDATE_CONFLICT') {
    if (write && openConflict) {
      await db.gymPtAgreementConflict.update({
        where: { id: openConflict.id },
        data: { legacyCollaborationIds: outcome.legacyCollaborationIds },
      });
    }
  }

  return { outcome, rows };
}

// ───────────────────────────── Điểm vào chính ─────────────────────────────

export async function backfillBrandPtAgreements(
  prisma: PrismaClient,
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const apply = options.apply === true;
  const now = options.now ?? new Date();

  const result: BackfillResult = {
    mode: apply ? 'apply' : 'dry-run',
    pairCounts: {
      SINGLE: 0,
      IDENTICAL: 0,
      CONFLICT_RATES: 0,
      CONFLICT_MIXED: 0,
      WINDING_DOWN_ONLY: 0,
      ALREADY_COVERED: 0,
    },
    untouchedRowCounts: { openNegotiations: 0, terminated: 0, otherClosed: 0, brandlessGyms: 0, alreadySuperseded: 0 },
    brandlessCollaborationIds: [],
    pairs: [],
    conflictReport: [],
    failures: [],
  };

  // 1. Quét toàn bộ để đếm theo lớp dòng và gom danh sách cặp ứng viên (đọc thuần).
  const all = await prisma.gymPtCollaboration.findMany({
    where: options.ptUserIds ? { ptUserId: { in: options.ptUserIds } } : undefined,
    select: {
      id: true,
      status: true,
      ptUserId: true,
      supersededByAgreementId: true,
      gym: { select: { brandId: true } },
    },
  });
  const pairKeys = new Map<string, { brandId: string; ptUserId: string }>();
  for (const c of all) {
    const brandId = c.gym.brandId;
    if (brandId === null) {
      result.untouchedRowCounts.brandlessGyms++;
      result.brandlessCollaborationIds.push(c.id);
      continue;
    }
    if (c.status === 'PENDING' || c.status === 'COUNTERED') result.untouchedRowCounts.openNegotiations++;
    else if (c.status === 'TERMINATED') result.untouchedRowCounts.terminated++;
    else if (c.status === 'REJECTED' || c.status === 'EXPIRED') result.untouchedRowCounts.otherClosed++;
    else if (c.status === 'ACCEPTED') {
      if (c.supersededByAgreementId !== null) result.untouchedRowCounts.alreadySuperseded++;
      else pairKeys.set(`${brandId}|${c.ptUserId}`, { brandId, ptUserId: c.ptUserId });
    }
  }

  // 2. Mỗi cặp một transaction (chạy thật) hoặc chỉ đọc (chạy thử).
  for (const { brandId, ptUserId } of pairKeys.values()) {
    try {
      let processed: { outcome: PairOutcome; rows: LegacyRowSummary[] } | null;
      if (apply) {
        processed = await prisma.$transaction(
          async (tx) => {
            const r = await processPair(tx, brandId, ptUserId, true, now);
            if (r && options.beforeCommit) await options.beforeCommit({ brandId, ptUserId });
            return r;
          },
          { timeout: 30_000 },
        );
      } else {
        processed = await processPair(prisma, brandId, ptUserId, false, now);
      }
      if (!processed) continue;
      result.pairs.push(processed.outcome);
      result.pairCounts[processed.outcome.class]++;
      if (processed.outcome.class === 'CONFLICT_RATES' || processed.outcome.class === 'CONFLICT_MIXED') {
        result.conflictReport.push(toReportEntry(brandId, ptUserId, processed.rows));
      }
    } catch (err) {
      result.failures.push({ brandId, ptUserId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

// ───────────────────────────── Lùi lại ─────────────────────────────

/**
 * Hoàn tác lần điền dữ liệu: xoá thoả thuận MIGRATED, xoá dấu superseded_* trên dòng cũ, xoá dòng xung đột.
 * TỪ CHỐI nếu có bất kỳ thoả thuận NATIVE nào (hoặc thoả thuận MIGRATED đã bị luồng mới thay đổi), vì khi đó
 * xoá là mất dữ liệu thật. Không đụng `termination_initiated_at` của dòng cũ: script này không bao giờ ghi nó,
 * nên giá trị trong đó (nếu có) thuộc về mã mới.
 */
export async function rollbackBrandPtAgreements(
  prisma: PrismaClient,
  options: { apply?: boolean; ptUserIds?: string[] } = {},
): Promise<RollbackResult> {
  const apply = options.apply === true;
  const pt = options.ptUserIds ? { ptUserId: { in: options.ptUserIds } } : {};

  const run = async (db: Db): Promise<RollbackResult> => {
    const native = await db.gymBrandPtAgreement.count({ where: { ...pt, origin: { not: 'MIGRATED' } } });
    if (native > 0) {
      throw new RollbackRefusedError(
        `Từ chối lùi: có ${native} thoả thuận NATIVE (do luồng cấp thương hiệu tạo ra). Xoá sẽ mất dữ liệu thật.`,
      );
    }
    const altered = await db.gymBrandPtAgreement.count({
      where: {
        ...pt,
        origin: 'MIGRATED',
        OR: [
          { status: { not: 'ACCEPTED' } },
          { terminationInitiatedAt: { not: null } },
          { effectiveAt: { not: null } },
          { terminatedAt: { not: null } },
        ],
      },
    });
    if (altered > 0) {
      throw new RollbackRefusedError(
        `Từ chối lùi: ${altered} thoả thuận MIGRATED đã bị luồng mới thay đổi (chấm dứt/đổi trạng thái).`,
      );
    }

    const migratedAgreements = await db.gymBrandPtAgreement.count({ where: { ...pt, origin: 'MIGRATED' } });
    const legacyRowsToClear = await db.gymPtCollaboration.count({
      where: { ...pt, OR: [{ supersededByAgreementId: { not: null } }, { supersededAt: { not: null } }] },
    });
    const conflictRows = await db.gymPtAgreementConflict.count({ where: pt });
    const summary: RollbackResult = {
      mode: apply ? 'apply' : 'dry-run',
      migratedAgreements,
      legacyRowsToClear,
      conflictRows,
    };
    if (!apply) return summary;

    // Thứ tự: bỏ dấu trên dòng cũ (SQL thô, giữ nguyên updated_at) -> xoá xung đột -> xoá thoả thuận.
    const ptFilter = options.ptUserIds ?? null;
    await db.$executeRaw`
      UPDATE gym_pt_collaborations SET superseded_by_agreement_id = NULL, superseded_at = NULL
      WHERE (superseded_by_agreement_id IS NOT NULL OR superseded_at IS NOT NULL)
        AND (${ptFilter}::text[] IS NULL OR pt_user_id = ANY(${ptFilter}::text[]))`;
    await db.gymPtAgreementConflict.deleteMany({ where: pt });
    await db.gymBrandPtAgreement.deleteMany({ where: { ...pt, origin: 'MIGRATED' } });
    return summary;
  };

  // Một transaction ở cả hai chế độ: kiểm tra và xoá cùng thấy một trạng thái.
  return prisma.$transaction((tx) => run(tx), { timeout: 60_000 });
}

// ───────────────────────────── CLI ─────────────────────────────

function describeDatabase(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? ':' + u.port : ''}/${decodeURIComponent(u.pathname.replace(/^\//, ''))}`;
  } catch {
    return '(DATABASE_URL không đọc được — không in ra để tránh lộ mật khẩu)';
  }
}

export function parseArgs(argv: string[]): { apply: boolean; rollback: boolean; report?: string; help: boolean } {
  const out: { apply: boolean; rollback: boolean; report?: string; help: boolean } = {
    apply: false,
    rollback: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--rollback') out.rollback = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--report') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error('--report cần một đường dẫn tệp');
      out.report = v;
    } else throw new Error(`Cờ không hợp lệ: ${a}`);
  }
  return out;
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  if (args.help) {
    console.log(
      'Dùng: tsx src/scripts/backfill-brand-pt-agreements.ts [--apply] [--rollback] [--report <tệp.json>]\n' +
        'Mặc định là CHẠY THỬ (không ghi DB).',
    );
    return 0;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Từ chối chạy: DATABASE_URL chưa được đặt.');
    return 2;
  }
  // In đích TRƯỚC khi làm bất cứ điều gì (không bao giờ in mật khẩu).
  console.log(`CSDL đích: ${describeDatabase(url)}`);
  console.log(
    `Chế độ: ${args.rollback ? 'LÙI LẠI' : 'ĐIỀN DỮ LIỆU'} — ${args.apply ? 'GHI THẬT (--apply)' : 'chạy thử, không ghi gì'}`,
  );

  const { prisma } = await import('../repositories/prisma');
  try {
    if (args.rollback) {
      const r = await rollbackBrandPtAgreements(prisma, { apply: args.apply });
      console.log(
        `${args.apply ? 'Đã lùi' : 'Sẽ lùi'}: ${r.migratedAgreements} thoả thuận MIGRATED, ` +
          `${r.legacyRowsToClear} dòng cũ được bỏ dấu, ${r.conflictRows} dòng xung đột.`,
      );
      return 0;
    }

    const r = await backfillBrandPtAgreements(prisma, { apply: args.apply });
    console.log('\nSố cặp (brand, PT) theo lớp:');
    console.table(r.pairCounts);
    console.log('Số dòng cũ KHÔNG được chuyển đổi (không bị chạm):');
    console.table(r.untouchedRowCounts);
    console.log(`\nHành động ${args.apply ? 'đã thực hiện' : 'dự kiến'} theo cặp:`);
    for (const p of r.pairs) {
      console.log(
        `  brand=${p.brandId} pt=${p.ptUserId} lớp=${p.class} hành động=${p.action} dòng cũ=[${p.legacyCollaborationIds.join(', ')}]` +
          (p.rates ? ` tỷ lệ pt/gym/platform=${p.rates.pt}/${p.rates.gym}/${p.rates.platform}` : ''),
      );
    }
    if (r.brandlessCollaborationIds.length > 0) {
      console.log(
        `\nDòng thuộc gym KHÔNG có thương hiệu (giữ nguyên, cần xử lý tay): ${r.brandlessCollaborationIds.join(', ')}`,
      );
    }
    const reportPath =
      args.report ?? `brand-pt-agreement-conflicts-${r.mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(reportPath, JSON.stringify(r.conflictReport, null, 2) + '\n', 'utf8');
    console.log(`\nBáo cáo xung đột (${r.conflictReport.length} cặp): ${reportPath}`);

    if (r.failures.length > 0) {
      console.error(`\n${r.failures.length} cặp LỖI (đã hoàn tác riêng từng cặp, các cặp khác vẫn được xử lý):`);
      for (const f of r.failures) console.error(`  brand=${f.brandId} pt=${f.ptUserId}: ${f.error}`);
      return 1;
    }
    return 0;
  } catch (e) {
    console.error(e instanceof RollbackRefusedError ? e.message : e);
    return e instanceof RollbackRefusedError ? 3 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}
