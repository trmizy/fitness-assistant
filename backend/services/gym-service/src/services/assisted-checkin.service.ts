import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { Prisma, type AssistedCheckInMethod, type PartnerAccountRole } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { gymService } from './gym.service';
import { authClient } from '../clients/auth.client';
import { profileClient } from '../clients/profile.client';
import { resolveDisplayNames } from './display-name.service';
import { applyMemberCheckIn, lockMembershipForCheckIn, COOLDOWN_MS } from './checkin-core';
import { hasPassedEndDate, hasVisitsLeft } from './membership-eligibility.service';
import { hasPermission } from './partner-permissions';
import { localDateOf, windowOfLocalDate } from '../utils/local-day';
import {
  assistedCheckinResultView, exceptionView, formatMemberCode, memberSearchResultView, nameMatchesPrefix,
  normalizeMemberCode, type MemberDisplayStatus, type MemberSearchResult,
} from './assisted-checkin.views';

/**
 * D15c — lễ tân (và quản lý / chủ) CHECK-IN HỘ một hội viên không dùng được QR (quên điện thoại, hết pin).
 *
 * Nguyên tắc (quyết định của chủ sở hữu):
 *   • KHÔNG có hệ thống điểm danh thứ hai: lượt vào là một dòng gym_check_ins (source = ASSISTED), tạo bởi CHÍNH mã luật
 *     của luồng QR (checkin-core.ts): gói ACTIVE, đúng thương hiệu, còn buổi, trừ buổi đúng như QR, chống quét trùng
 *     60 giây. Lễ tân không gia hạn / thêm buổi / bỏ qua hết hạn / sửa-xoá lịch sử.
 *   • Biết tên hoặc SĐT KHÔNG đủ. Phải qua MỘT trong các phương thức xác minh (ASSISTED_CHECKIN_METHODS, mặc định
 *     PHOTO_MATCH,MEMBER_OTP) hoặc ngoại lệ do quản lý duyệt.
 *   • Mọi lần tra cứu / gửi OTP / nhập sai / check-in / từ chối / quyết định ngoại lệ ghi vào gym_assisted_checkin_events
 *     (chỉ-thêm). Khoá idempotency (requestId): cùng khoá + cùng nội dung = phát lại, khác nội dung = 409.
 */

// ── cấu hình (đọc lúc gọi để đổi được bằng env mà không phải khởi động lại trong test) ─────────────────────────────────
export type AutoMethod = 'MEMBER_OTP' | 'PHOTO_MATCH';
const AUTO_METHODS: readonly AutoMethod[] = ['PHOTO_MATCH', 'MEMBER_OTP'];

/** `ASSISTED_CHECKIN_METHODS` = danh sách phân tách bằng dấu phẩy. Không đặt → PHOTO_MATCH,MEMBER_OTP. Giá trị lạ bị bỏ. */
export function enabledAutoMethods(raw: string | undefined = process.env.ASSISTED_CHECKIN_METHODS): AutoMethod[] {
  if (raw === undefined) return [...AUTO_METHODS];
  const wanted = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return AUTO_METHODS.filter((m) => wanted.includes(m));
}

const num = (name: string, dflt: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};
const otpTtlSeconds = () => num('ASSISTED_CHECKIN_OTP_TTL_SECONDS', 300);
const otpMaxAttempts = () => num('ASSISTED_CHECKIN_OTP_MAX_ATTEMPTS', 5);
const otpResendSeconds = () => num('ASSISTED_CHECKIN_OTP_RESEND_SECONDS', 60);
const otpDailyLimit = () => num('ASSISTED_CHECKIN_OTP_DAILY_LIMIT', 5);
const searchPerMinute = () => num('ASSISTED_CHECKIN_SEARCH_PER_MINUTE', 30);

const SECRET = () => process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

// ── lỗi có mã ────────────────────────────────────────────────────────────────────────────────────────────────────────
export class AssistedCheckinError extends Error {
  status: number;
  code: string;
  audited = false;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code: string, status: number) => new AssistedCheckinError(code, status);

const CODE_RE = /^[A-Z][A-Z0-9_]+$/;
/** Mã lỗi nghiệp vụ của một exception (của chính module này hoặc của checkin-core: NOT_ACTIVE, TOO_SOON...). */
export function businessCodeOf(e: any): { code: string; status: number } | null {
  if (e instanceof AssistedCheckinError) return { code: e.code, status: e.status };
  if (e && typeof e.message === 'string' && CODE_RE.test(e.message) && typeof e.status === 'number') return { code: e.message, status: e.status };
  return null;
}

export interface StaffActor {
  /** Người đang đăng nhập (nhân viên thật) - KHÔNG phải principal (chủ). */
  userId: string;
  role: PartnerAccountRole;
  /** Chủ sở hữu của đối tác - dùng để chứng minh chi nhánh thuộc đúng đối tác (getOwnedGym). */
  principalUserId: string;
}

const SEARCHABLE_STATUSES = ['ACTIVE', 'EXPIRED', 'PENDING_ISSUE'] as const;
const STATUS_RANK: Record<string, number> = { ACTIVE: 0, EXPIRED: 1, PENDING_ISSUE: 2 };

// ── nhật ký chỉ-thêm ──────────────────────────────────────────────────────────────────────────────────────────────────
type EventInput = {
  id?: string;
  eventType: Prisma.GymAssistedCheckInEventUncheckedCreateInput['eventType'];
  gymId: string;
  staffUserId: string;
  staffRole: PartnerAccountRole | null;
  membershipId?: string | null;
  clientId?: string | null;
  method?: AssistedCheckInMethod | null;
  outcome: string;
  reason?: string | null;
  idempotencyKey?: string | null;
  requestHash?: string | null;
  checkinId?: string | null;
  exceptionId?: string | null;
  challengeId?: string | null;
  details?: Record<string, unknown> | null;
};

async function appendEvent(db: Prisma.TransactionClient | typeof prisma, e: EventInput) {
  return db.gymAssistedCheckInEvent.create({
    data: {
      ...e,
      membershipId: e.membershipId ?? null,
      clientId: e.clientId ?? null,
      method: e.method ?? null,
      reason: e.reason ?? null,
      idempotencyKey: e.idempotencyKey ?? null,
      requestHash: e.requestHash ?? null,
      checkinId: e.checkinId ?? null,
      exceptionId: e.exceptionId ?? null,
      challengeId: e.challengeId ?? null,
      details: (e.details ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/** Ghi nhật ký NGOÀI giao dịch (từ chối / thất bại): lỗi ghi nhật ký không được che mất lỗi gốc. */
async function appendEventSafe(e: EventInput) {
  try {
    await appendEvent(prisma, e);
  } catch (err) {
    logger.error({ err: (err as Error).message, eventType: e.eventType, outcome: e.outcome }, '[AssistedCheckin] ghi nhật ký thất bại');
  }
}

// ── giới hạn tra cứu (chống dò hội viên hàng loạt) ───────────────────────────────────────────────────────────────────
const searchHits = new Map<string, number[]>();
export function __resetSearchLimiter() {
  searchHits.clear();
}
function consumeSearchQuota(staffUserId: string, now = Date.now()) {
  const recent = (searchHits.get(staffUserId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= searchPerMinute()) {
    searchHits.set(staffUserId, recent);
    throw fail('SEARCH_RATE_LIMITED', 429);
  }
  recent.push(now);
  searchHits.set(staffUserId, recent);
}

// ── hội viên & điều kiện ─────────────────────────────────────────────────────────────────────────────────────────────
type GymLite = { id: string; brandId: string | null; status: string; operationalStatus: string; name: string };
type MemberRow = Prisma.GymMembershipContractGetPayload<{ include: { plan: true } }>;

async function loadOwnedGym(actor: StaffActor, gymId: string): Promise<GymLite & { brandId: string }> {
  const gym = (await gymService.getOwnedGym(gymId, actor.principalUserId)) as unknown as GymLite;
  if (!gym.brandId) throw fail('GYM_HAS_NO_BRAND', 409); // gym không thuộc thương hiệu nào: không có hội viên (như QR)
  return gym as GymLite & { brandId: string };
}

/** Hội viên theo membershipId, CHỈ khi gói thuộc đúng thương hiệu của chi nhánh này. Không thì 404 (không lộ nơi khác). */
async function loadMember(gym: GymLite & { brandId: string }, membershipId: string): Promise<MemberRow> {
  const m = await prisma.gymMembershipContract.findFirst({
    where: { id: membershipId, status: { in: [...SEARCHABLE_STATUSES] }, plan: { brandId: gym.brandId } },
    include: { plan: true },
  });
  if (!m) throw fail('MEMBER_NOT_FOUND', 404);
  return m;
}

function displayStatusOf(m: Pick<MemberRow, 'status' | 'endDate' | 'totalVisits' | 'usedVisits'>, now = new Date()): MemberDisplayStatus {
  if (m.status === 'PENDING_ISSUE') return 'SUSPENDED';
  if (m.status === 'ACTIVE' && !hasPassedEndDate(m.endDate, now) && hasVisitsLeft(m.totalVisits, m.usedVisits)) return 'ACTIVE';
  return 'EXPIRED';
}

/** Cùng điều kiện với luồng QR (đọc, không khoá) - để lễ tân biết trước, không phải để thay thế khoá thật. */
function blockedReasonOf(m: MemberRow, gym: GymLite, recentCheckin: boolean, now = new Date()): string | null {
  if (gym.status !== 'APPROVED' || gym.operationalStatus !== 'OPEN') return 'GYM_NOT_ACTIVE';
  if (m.status !== 'ACTIVE' || hasPassedEndDate(m.endDate, now)) return 'NOT_ACTIVE';
  if (!hasVisitsLeft(m.totalVisits, m.usedVisits)) return 'VISIT_LIMIT_REACHED';
  if (recentCheckin) return 'TOO_SOON';
  return null;
}

async function recentCheckinIds(membershipIds: string[]): Promise<Set<string>> {
  if (membershipIds.length === 0) return new Set();
  const rows = await prisma.gymCheckIn.findMany({
    where: { membershipId: { in: membershipIds }, createdAt: { gte: new Date(Date.now() - COOLDOWN_MS) } },
    select: { membershipId: true },
  });
  return new Set(rows.map((r) => r.membershipId));
}

function remainingVisitsOf(m: { totalVisits: number | null; usedVisits: number }): number | null {
  return m.totalVisits == null ? null : Math.max(0, m.totalVisits - m.usedVisits);
}

// ── tra cứu ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const MAX_RESULTS = 10;
const NAME_CANDIDATE_CAP = 60;

export interface MemberSearchQuery {
  code?: unknown;
  name?: unknown;
  last4?: unknown;
}

export const assistedCheckinService = {
  /** Cấu hình cho giao diện: phương thức nào đang bật, thời hạn OTP. */
  config() {
    return {
      methods: enabledAutoMethods(),
      exceptionEnabled: true,
      otpTtlSeconds: otpTtlSeconds(),
      otpResendSeconds: otpResendSeconds(),
    };
  },

  /**
   * Tra hội viên TRONG thương hiệu của chi nhánh (phạm vi chi nhánh do route kiểm trước).
   * Chỉ hai cách hợp lệ: mã hội viên đầy đủ, hoặc tiền tố tên + 4 ký tự cuối của mã. Tên đơn thuần / SĐT / e-mail KHÔNG
   * dùng được. Kết quả là tập trường tối thiểu (assisted-checkin.views.ts).
   */
  async searchMembers(actor: StaffActor, gymId: string, q: MemberSearchQuery): Promise<{ results: MemberSearchResult[] }> {
    const gym = await loadOwnedGym(actor, gymId);
    consumeSearchQuota(actor.userId);

    const code = normalizeMemberCode(q.code);
    const nameQ = typeof q.name === 'string' ? q.name.trim() : '';
    const last4 = normalizeMemberCode(q.last4);
    let matchedBy: 'CODE' | 'NAME_LAST4';
    if (q.code !== undefined && String(q.code).trim() !== '') {
      if (!/^[0-9A-F]{8}$/.test(code)) throw fail('SEARCH_QUERY_INVALID', 400);
      matchedBy = 'CODE';
    } else if (nameQ.length >= 2 && /^[0-9A-F]{4}$/.test(last4)) {
      matchedBy = 'NAME_LAST4';
    } else {
      throw fail('SEARCH_QUERY_INVALID', 400); // tên đơn thuần / SĐT: không đủ
    }

    const rows = await prisma.gymMembershipContract.findMany({
      where: {
        plan: { brandId: gym.brandId },
        status: { in: [...SEARCHABLE_STATUSES] },
        memberCode: matchedBy === 'CODE' ? code : { endsWith: last4 },
      },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    // Mỗi người một dòng: gói ACTIVE trước, rồi gói mới nhất (cùng thứ tự ưu tiên của luồng QR).
    const best = new Map<string, MemberRow>();
    for (const r of rows) {
      const cur = best.get(r.clientId);
      if (!cur || STATUS_RANK[r.status] < STATUS_RANK[cur.status]) best.set(r.clientId, r);
    }
    let candidates = [...best.values()];
    if (matchedBy === 'NAME_LAST4') candidates = candidates.slice(0, NAME_CANDIDATE_CAP);

    const names = await resolveDisplayNames(candidates.map((c) => c.clientId), { max: NAME_CANDIDATE_CAP });
    if (matchedBy === 'NAME_LAST4') candidates = candidates.filter((c) => nameMatchesPrefix(names.get(c.clientId) ?? '', nameQ));
    candidates = candidates.slice(0, MAX_RESULTS);

    const [recent, photos] = await Promise.all([
      recentCheckinIds(candidates.map((c) => c.id)),
      Promise.all(candidates.map((c) => profileClient.getProfilePhotoUrl(c.clientId))),
    ]);

    const results = candidates.map((c, i) =>
      memberSearchResultView({
        membershipId: c.id,
        displayName: names.get(c.clientId) ?? 'Hội viên',
        memberCode: formatMemberCode(c.memberCode),
        planName: c.plan.name,
        planType: c.totalVisits != null ? 'VISIT_BASED' : 'TIME_BASED',
        status: displayStatusOf(c),
        expiresAt: c.endDate ? c.endDate.toISOString() : null,
        branchScope: 'BRAND',
        coversThisBranch: true,
        remainingVisits: remainingVisitsOf(c),
        photoUrl: photos[i],
        hasPhoto: photos[i] != null,
        canCheckIn: blockedReasonOf(c, gym, recent.has(c.id)) === null,
        blockedReason: blockedReasonOf(c, gym, recent.has(c.id)),
      }),
    );

    // Không lưu từ khoá (tên / mã) - chỉ cách tra và số kết quả.
    await appendEventSafe({
      eventType: 'MEMBER_SEARCH', gymId, staffUserId: actor.userId, staffRole: actor.role, outcome: 'OK',
      details: { matchedBy, resultCount: results.length },
    });
    return { results };
  },

  // ── OTP ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Gửi mã một lần tới e-mail đã đăng ký của hội viên (auth-service /auth/internal/send-email — cùng đường gửi mail của
   * mọi luồng khác). Mã chỉ được băm; gắn với (hội viên, chi nhánh, nhân viên); TTL ngắn; giới hạn thử + gửi lại.
   * Phản hồi KHÔNG chứa mã và KHÔNG chứa địa chỉ e-mail.
   */
  async requestOtp(actor: StaffActor, gymId: string, input: { membershipId: unknown }) {
    const gym = await loadOwnedGym(actor, gymId);
    if (!enabledAutoMethods().includes('MEMBER_OTP')) throw fail('METHOD_DISABLED', 403);
    const membershipId = z.string().min(1).max(64).safeParse(input.membershipId);
    if (!membershipId.success) throw fail('VALIDATION_ERROR', 400);
    const member = await loadMember(gym, membershipId.data);

    const refuse = async (code: string, status: number, extra?: Record<string, unknown>) => {
      await appendEventSafe({
        eventType: 'OTP_FAILED', gymId, staffUserId: actor.userId, staffRole: actor.role, membershipId: member.id,
        clientId: member.clientId, method: 'MEMBER_OTP', outcome: code, details: extra,
      });
      return fail(code, status);
    };

    const blocked = blockedReasonOf(member, gym, (await recentCheckinIds([member.id])).has(member.id));
    if (blocked && blocked !== 'TOO_SOON') throw await refuse(blocked, 409);

    const now = new Date();
    const dayStart = windowOfLocalDate(localDateOf(now)).start;
    const [last, today] = await Promise.all([
      prisma.gymAssistedCheckInChallenge.findFirst({
        where: { membershipId: member.id, gymId, staffUserId: actor.userId }, orderBy: { createdAt: 'desc' },
      }),
      prisma.gymAssistedCheckInChallenge.count({ where: { membershipId: member.id, createdAt: { gte: dayStart } } }),
    ]);
    if (last && now.getTime() - last.createdAt.getTime() < otpResendSeconds() * 1000) throw await refuse('OTP_RESEND_TOO_SOON', 429);
    if (today >= otpDailyLimit()) throw await refuse('OTP_DAILY_LIMIT', 429);

    let email: string | null = null;
    try {
      email = (await authClient.getUser(member.clientId)).email || null;
    } catch {
      email = null;
    }
    if (!email) throw await refuse('MEMBER_EMAIL_UNAVAILABLE', 409);

    const challengeId = randomUUID();
    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(now.getTime() + otpTtlSeconds() * 1000);
    await prisma.gymAssistedCheckInChallenge.create({
      data: {
        id: challengeId, gymId, membershipId: member.id, clientId: member.clientId, staffUserId: actor.userId,
        otpHash: hashOtp(challengeId, otp), expiresAt, maxAttempts: otpMaxAttempts(),
      },
    });

    const minutes = Math.max(1, Math.round(otpTtlSeconds() / 60));
    const sent = await authClient.sendEmail({
      to: email,
      subject: 'Mã xác minh check-in tại quầy',
      text: [
        `Mã xác minh check-in tại ${gym.name}: ${otp}`,
        `Mã có hiệu lực ${minutes} phút và chỉ dùng được một lần.`,
        'Chỉ đọc mã này cho nhân viên quầy khi CHÍNH BẠN đang đứng tại quầy để check-in. Nếu không phải bạn, hãy bỏ qua thư này.',
      ].join('\n'),
    });
    if (!sent) {
      // Mã không tới được hội viên → huỷ hẳn (đóng băng thử thách), để không còn mã "treo" mà không ai biết.
      await prisma.gymAssistedCheckInChallenge.update({ where: { id: challengeId }, data: { consumedAt: new Date() } });
      throw await refuse('OTP_DELIVERY_FAILED', 502, { challengeId });
    }

    await appendEventSafe({
      eventType: 'OTP_SENT', gymId, staffUserId: actor.userId, staffRole: actor.role, membershipId: member.id,
      clientId: member.clientId, method: 'MEMBER_OTP', outcome: 'OK', challengeId,
      details: { expiresAt: expiresAt.toISOString() },
    });
    return { challengeId, expiresAt: expiresAt.toISOString(), ttlSeconds: otpTtlSeconds(), resendAfterSeconds: otpResendSeconds() };
  },

  // ── check-in hộ ────────────────────────────────────────────────────────────────────────────────────────────────────
  async assistedCheckIn(actor: StaffActor, gymId: string, rawInput: unknown) {
    const gym = await loadOwnedGym(actor, gymId);
    const parsed = CHECKIN_INPUT.safeParse(rawInput ?? {});
    if (!parsed.success) throw fail(parsed.error.issues.some((i) => i.path[0] === 'requestId') ? 'IDEMPOTENCY_KEY_REQUIRED' : 'VALIDATION_ERROR', 400);
    const input = parsed.data;

    if (input.method !== 'MANAGER_EXCEPTION' && !enabledAutoMethods().includes(input.method)) {
      throw await refuseCheckin(actor, gymId, input, null, null, fail('METHOD_DISABLED', 403));
    }

    const requestHash = hashRequest(gymId, input);

    // 1. Idempotency: cùng khoá → cùng nội dung thì phát lại / thử lại, khác nội dung thì 409.
    // Khoá chỉ "đóng" khi có một check-in THÀNH CÔNG; lần bị từ chối (nhập sai OTP...) thì thử lại với cùng khoá được.
    const done = await prisma.gymAssistedCheckInEvent.findFirst({
      where: { staffUserId: actor.userId, idempotencyKey: input.requestId, eventType: 'CHECKIN_SUCCEEDED' },
    });
    if (done) {
      if (done.requestHash !== requestHash) {
        await appendEventSafe({
          eventType: 'CHECKIN_REFUSED', gymId, staffUserId: actor.userId, staffRole: actor.role, membershipId: input.membershipId.slice(0, 64),
          method: input.method, outcome: 'IDEMPOTENCY_KEY_REUSED', reason: input.reason, idempotencyKey: input.requestId, requestHash,
        });
        throw fail('IDEMPOTENCY_KEY_REUSED', 409);
      }
      return replayOf(done);
    }

    // 2. Hội viên phải thuộc đúng thương hiệu của chi nhánh.
    let member: MemberRow;
    try {
      member = await loadMember(gym, input.membershipId);
    } catch (e) {
      throw await refuseCheckin(actor, gymId, input, requestHash, null, e);
    }

    try {
      // 3. Xác minh danh tính (lỗi ở đây KHÔNG tạo check-in).
      const proof = await verifyIdentity(actor, gym, member, input);

      // 4. Giao dịch: khoá hội viên → (phát lại?) → tiêu thụ bằng chứng → mã luật dùng chung với QR → ghi sự kiện.
      const out = await prisma.$transaction(async (tx) => {
        const m = await lockMembershipForCheckIn(tx, { gymId, clientId: member.clientId, membershipId: member.id });

        const again = await tx.gymAssistedCheckInEvent.findFirst({
          where: { staffUserId: actor.userId, idempotencyKey: input.requestId, eventType: 'CHECKIN_SUCCEEDED' },
        });
        if (again) return { kind: 'replay' as const, replay: again };

        await proof.consume(tx);
        const eventId = randomUUID();
        const applied = await applyMemberCheckIn(tx, m, {
          gymId, clientId: member.clientId, checkedInBy: actor.userId, source: 'ASSISTED', assistedEventId: eventId,
        });
        const response = {
          checkinId: applied.checkinId, checkedInAt: applied.checkedInAt.toISOString(), usedVisits: applied.usedVisits,
          totalVisits: applied.totalVisits, endDate: applied.endDate ? applied.endDate.toISOString() : null,
          planName: applied.planName, memberCode: formatMemberCode(member.memberCode),
        };
        await appendEvent(tx, {
          id: eventId, eventType: 'CHECKIN_SUCCEEDED', gymId, staffUserId: actor.userId, staffRole: actor.role,
          membershipId: member.id, clientId: member.clientId, method: input.method, outcome: 'OK', reason: input.reason,
          idempotencyKey: input.requestId, requestHash, checkinId: applied.checkinId,
          exceptionId: proof.exceptionId ?? null, challengeId: proof.challengeId ?? null,
          details: { verification: proof.audit, response },
        });
        await proof.afterCheckin?.(tx, applied.checkinId);
        return { kind: 'done' as const, applied, response };
      });

      if (out.kind === 'replay') return replayOf(out.replay);

      const names = await resolveDisplayNames([member.clientId]);
      logger.info(`[AssistedCheckin] gym=${gymId} staff=${actor.userId} role=${actor.role} method=${input.method} visit=${out.applied.usedVisits}`);
      return assistedCheckinResultView({
        ...out.response, source: 'ASSISTED', method: input.method,
        displayName: names.get(member.clientId) ?? 'Hội viên', remainingVisits: remainingVisitsOf(out.applied), replayed: false,
      });
    } catch (e: any) {
      // Hai request song song cùng khoá nhưng khác hội viên: chỉ mục UNIQUE một phần chặn ở DB.
      if (e?.code === 'P2002') throw await refuseCheckin(actor, gymId, input, requestHash, member, fail('IDEMPOTENCY_KEY_REUSED', 409));
      throw await refuseCheckin(actor, gymId, input, requestHash, member, e);
    }
  },

  // ── ngoại lệ ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async requestException(actor: StaffActor, gymId: string, rawInput: unknown) {
    const gym = await loadOwnedGym(actor, gymId);
    const parsed = EXCEPTION_REQUEST_INPUT.safeParse(rawInput ?? {});
    if (!parsed.success) throw fail('VALIDATION_ERROR', 400);
    const { membershipId, reason } = parsed.data;
    const member = await loadMember(gym, membershipId);

    const blocked = blockedReasonOf(member, gym, false);
    if (blocked) {
      await appendEventSafe({
        eventType: 'EXCEPTION_REQUESTED', gymId, staffUserId: actor.userId, staffRole: actor.role, membershipId: member.id,
        clientId: member.clientId, method: 'MANAGER_EXCEPTION', outcome: blocked, reason,
      });
      throw fail(blocked, 409); // ngoại lệ không phải đường vòng để qua hạn / hết buổi / chi nhánh đóng
    }

    await expireStaleExceptions(gymId);
    const now = new Date();
    try {
      const created = await prisma.gymAssistedCheckInException.create({
        data: {
          gymId, membershipId: member.id, clientId: member.clientId, requestedBy: actor.userId, requestReason: reason,
          expiresAt: windowOfLocalDate(localDateOf(now)).end, // hết hạn cuối ngày (Asia/Ho_Chi_Minh)
        },
      });
      await appendEventSafe({
        eventType: 'EXCEPTION_REQUESTED', gymId, staffUserId: actor.userId, staffRole: actor.role, membershipId: member.id,
        clientId: member.clientId, method: 'MANAGER_EXCEPTION', outcome: 'OK', reason, exceptionId: created.id,
      });
      return { id: created.id, status: created.status, expiresAt: created.expiresAt.toISOString() };
    } catch (e: any) {
      if (e?.code === 'P2002') throw fail('EXCEPTION_ALREADY_OPEN', 409);
      throw e;
    }
  },

  /** Quản lý/chủ thấy mọi ngoại lệ của chi nhánh trong ngày; người chỉ có quyền xin thấy ngoại lệ của CHÍNH MÌNH. */
  async listExceptions(actor: StaffActor, gymId: string) {
    await loadOwnedGym(actor, gymId);
    await expireStaleExceptions(gymId);
    const dayStart = windowOfLocalDate(localDateOf(new Date())).start;
    const canApprove = hasPermission(actor.role, 'checkin.exception.approve');
    const rows = await prisma.gymAssistedCheckInException.findMany({
      where: { gymId, createdAt: { gte: dayStart }, ...(canApprove ? {} : { requestedBy: actor.userId }) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (rows.length === 0) return { canApprove, exceptions: [] };

    const members = await prisma.gymMembershipContract.findMany({
      where: { id: { in: rows.map((r) => r.membershipId) } }, include: { plan: { select: { name: true } } },
    });
    const byId = new Map(members.map((m) => [m.id, m]));
    const staffIds = rows.flatMap((r) => [r.requestedBy, r.decidedBy].filter((x): x is string => !!x));
    const names = await resolveDisplayNames([...rows.map((r) => r.clientId), ...staffIds], { max: 300 });
    return {
      canApprove,
      exceptions: rows.map((r) =>
        exceptionView({
          id: r.id, membershipId: r.membershipId, status: r.status,
          displayName: names.get(r.clientId) ?? 'Hội viên', memberCode: formatMemberCode(byId.get(r.membershipId)?.memberCode),
          planName: byId.get(r.membershipId)?.plan.name ?? '', requestReason: r.requestReason,
          requestedByName: names.get(r.requestedBy) ?? 'Nhân viên', createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
          decisionReason: r.decisionReason, decidedByName: r.decidedBy ? names.get(r.decidedBy) ?? 'Quản lý' : null,
          decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null, mine: r.requestedBy === actor.userId,
        }),
      ),
    };
  },

  async decideException(actor: StaffActor, gymId: string, exceptionId: string, decision: 'APPROVE' | 'REJECT', rawReason: unknown) {
    await loadOwnedGym(actor, gymId);
    const reason = z.string().trim().min(5).max(300).safeParse(rawReason);
    if (!reason.success) throw fail('REASON_REQUIRED', 400);
    await expireStaleExceptions(gymId);

    const ex = await prisma.gymAssistedCheckInException.findFirst({ where: { id: exceptionId, gymId } });
    if (!ex) throw fail('EXCEPTION_NOT_FOUND', 404);

    const log = (outcome: string) =>
      appendEventSafe({
        eventType: decision === 'APPROVE' ? 'EXCEPTION_APPROVED' : 'EXCEPTION_REJECTED', gymId, staffUserId: actor.userId,
        staffRole: actor.role, membershipId: ex.membershipId, clientId: ex.clientId, method: 'MANAGER_EXCEPTION', outcome,
        reason: reason.data, exceptionId: ex.id,
      });

    // Bốn mắt: người xin không bao giờ là người duyệt (cũng có CHECK ở DB).
    if (ex.requestedBy === actor.userId) {
      await log('EXCEPTION_SELF_APPROVAL');
      throw fail('EXCEPTION_SELF_APPROVAL', 403);
    }
    if (ex.status === 'EXPIRED') throw fail('EXCEPTION_EXPIRED', 410);
    if (ex.status !== 'PENDING') throw fail('EXCEPTION_ALREADY_DECIDED', 409);

    const now = new Date();
    const res = await prisma.gymAssistedCheckInException.updateMany({
      where: { id: ex.id, status: 'PENDING', expiresAt: { gt: now } },
      data: {
        status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: actor.userId, decidedByRole: actor.role,
        decisionReason: reason.data, decidedAt: now,
      },
    });
    if (res.count !== 1) throw fail('EXCEPTION_ALREADY_DECIDED', 409);
    await log('OK');
    return { id: ex.id, status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' };
  },
};

  /** Ghi một sự kiện CHECKIN_REFUSED (nếu lỗi là lỗi nghiệp vụ chưa được ghi) rồi trả lỗi để ném tiếp. */
async function refuseCheckin(actor: StaffActor, gymId: string, input: CheckinInput, requestHash: string | null, member: MemberRow | null, e: any) {
    const biz = businessCodeOf(e);
    if (!biz) return e; // lỗi hệ thống: để controller xử lý, không giả làm "từ chối"
    if (!(e instanceof AssistedCheckinError && e.audited)) {
      await appendEventSafe({
        eventType: 'CHECKIN_REFUSED', gymId, staffUserId: actor.userId, staffRole: actor.role,
        membershipId: member?.id ?? input.membershipId.slice(0, 64), clientId: member?.clientId ?? null, method: input.method,
        outcome: biz.code, reason: input.reason, idempotencyKey: input.requestId, requestHash,
        exceptionId: input.exceptionId ?? null, challengeId: input.challengeId ?? null,
      });
    }
    return e;
}

async function replayOf(ev: { details: Prisma.JsonValue | null; method: AssistedCheckInMethod | null; clientId: string | null; gymId: string }) {
    const d = (ev.details ?? {}) as { response?: Record<string, any> };
    const r = d.response ?? {};
    const names = ev.clientId ? await resolveDisplayNames([ev.clientId]) : new Map<string, string>();
    return assistedCheckinResultView({
      ...r, source: 'ASSISTED', method: ev.method, displayName: ev.clientId ? names.get(ev.clientId) ?? 'Hội viên' : 'Hội viên',
      remainingVisits: r.totalVisits == null ? null : Math.max(0, r.totalVisits - r.usedVisits), replayed: true,
    });
}


// ── xác minh danh tính ───────────────────────────────────────────────────────────────────────────────────────────────
const REQUEST_ID = z.string().regex(/^[A-Za-z0-9_.:-]{8,100}$/);
const CHECKIN_INPUT = z.object({
  requestId: REQUEST_ID,
  membershipId: z.string().min(1).max(64),
  method: z.enum(['MEMBER_OTP', 'PHOTO_MATCH', 'MANAGER_EXCEPTION']),
  reason: z.string().trim().min(3).max(200),
  challengeId: z.string().min(1).max(64).optional(),
  otp: z.string().regex(/^\d{6}$/).optional(),
  photoMatchAttested: z.boolean().optional(),
  statedMemberCode: z.string().max(32).optional(),
  exceptionId: z.string().min(1).max(64).optional(),
});
type CheckinInput = z.infer<typeof CHECKIN_INPUT>;

const EXCEPTION_REQUEST_INPUT = z.object({
  membershipId: z.string().min(1).max(64),
  reason: z.string().trim().min(5).max(300),
});

function hashOtp(challengeId: string, otp: string): string {
  return createHmac('sha256', SECRET()).update(`${challengeId}:${otp}`).digest('hex');
}

function hashRequest(gymId: string, i: CheckinInput): string {
  const canonical = JSON.stringify({
    g: gymId, m: i.membershipId, k: i.method, r: i.reason, c: i.challengeId ?? null,
    o: i.otp ? createHash('sha256').update(i.otp).digest('hex') : null,
    p: i.photoMatchAttested === true, s: normalizeMemberCode(i.statedMemberCode), e: i.exceptionId ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

interface Proof {
  audit: Record<string, unknown>;
  challengeId?: string;
  exceptionId?: string;
  /** Tiêu thụ bằng chứng TRONG giao dịch check-in (một lần duy nhất). */
  consume(tx: Prisma.TransactionClient): Promise<void>;
  afterCheckin?(tx: Prisma.TransactionClient, checkinId: string): Promise<void>;
}

async function verifyIdentity(actor: StaffActor, gym: GymLite, member: MemberRow, input: CheckinInput): Promise<Proof> {
  const audited = <T extends AssistedCheckinError>(e: T) => {
    e.audited = true;
    return e;
  };

  if (input.method === 'PHOTO_MATCH') {
    // Chỉ khi hội viên CÓ ảnh hồ sơ (kiểm lại ở máy chủ, không tin lời máy khách) VÀ lễ tân cam kết khuôn mặt khớp ảnh VÀ
    // nhập đúng mã hội viên mà hội viên tự nói. Cả hai được ghi lại.
    const photo = await profileClient.getProfilePhotoUrl(member.clientId);
    if (!photo) throw fail('PHOTO_UNAVAILABLE', 409);
    if (input.photoMatchAttested !== true) throw fail('PHOTO_ATTESTATION_REQUIRED', 400);
    const stated = normalizeMemberCode(input.statedMemberCode);
    if (!stated || stated !== normalizeMemberCode(member.memberCode)) throw fail('MEMBER_CODE_MISMATCH', 403);
    return {
      audit: { photoOnFile: true, photoMatchAttested: true, statedMemberCode: formatMemberCode(stated) },
      consume: async () => {},
    };
  }

  if (input.method === 'MEMBER_OTP') {
    if (!input.challengeId || !input.otp) throw fail('OTP_REQUIRED', 400);
    const challengeId = input.challengeId;
    const verdict = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; gym_id: string; membership_id: string; staff_user_id: string; otp_hash: string; expires_at: Date; attempts: number; max_attempts: number; locked_at: Date | null; consumed_at: Date | null }>>`
        SELECT id, gym_id, membership_id, staff_user_id, otp_hash, expires_at, attempts, max_attempts, locked_at, consumed_at
        FROM gym_assisted_checkin_challenges WHERE id = ${challengeId} FOR UPDATE`;
      const c = rows[0];
      // Không phân biệt "không tồn tại" với "của người/chi nhánh/hội viên khác" - không lộ gì.
      if (!c || c.gym_id !== gym.id || c.membership_id !== member.id || c.staff_user_id !== actor.userId) return { code: 'OTP_CHALLENGE_INVALID', status: 403, attempts: null as number | null };
      if (c.consumed_at) return { code: 'OTP_ALREADY_USED', status: 409, attempts: c.attempts };
      if (c.locked_at || c.attempts >= c.max_attempts) return { code: 'OTP_ATTEMPTS_EXCEEDED', status: 429, attempts: c.attempts };
      if (c.expires_at.getTime() <= Date.now()) return { code: 'OTP_EXPIRED', status: 410, attempts: c.attempts };
      const given = Buffer.from(hashOtp(challengeId, input.otp!), 'hex');
      const want = Buffer.from(c.otp_hash, 'hex');
      if (given.length === want.length && timingSafeEqual(given, want)) return { code: null, status: 200, attempts: c.attempts };
      const attempts = c.attempts + 1;
      await tx.gymAssistedCheckInChallenge.update({
        where: { id: challengeId },
        data: { attempts, ...(attempts >= c.max_attempts ? { lockedAt: new Date() } : {}) },
      });
      return { code: attempts >= c.max_attempts ? 'OTP_ATTEMPTS_EXCEEDED' : 'OTP_INVALID', status: attempts >= c.max_attempts ? 429 : 403, attempts };
    });
    if (verdict.code) {
      await appendEventSafe({
        eventType: 'OTP_FAILED', gymId: gym.id, staffUserId: actor.userId, staffRole: actor.role, membershipId: member.id,
        clientId: member.clientId, method: 'MEMBER_OTP', outcome: verdict.code, reason: input.reason,
        idempotencyKey: input.requestId, requestHash: hashRequest(gym.id, input), challengeId,
        details: verdict.attempts == null ? undefined : { attempts: verdict.attempts },
      });
      throw audited(fail(verdict.code, verdict.status));
    }
    return {
      audit: { challengeId, otpVerified: true },
      challengeId,
      consume: async (tx) => {
        const r = await tx.gymAssistedCheckInChallenge.updateMany({
          where: { id: challengeId, consumedAt: null, lockedAt: null, expiresAt: { gt: new Date() } },
          data: { consumedAt: new Date() },
        });
        if (r.count !== 1) throw fail('OTP_ALREADY_USED', 409);
      },
    };
  }

  // MANAGER_EXCEPTION
  if (!input.exceptionId) throw fail('EXCEPTION_REQUIRED', 400);
  const exceptionId = input.exceptionId;
  await expireStaleExceptions(gym.id);
  const ex = await prisma.gymAssistedCheckInException.findFirst({ where: { id: exceptionId, gymId: gym.id, membershipId: member.id } });
  if (!ex) throw fail('EXCEPTION_NOT_FOUND', 404);
  if (ex.status === 'EXPIRED' || ex.expiresAt.getTime() <= Date.now()) throw fail('EXCEPTION_EXPIRED', 410);
  if (ex.status !== 'APPROVED') throw fail(ex.status === 'USED' ? 'EXCEPTION_ALREADY_USED' : 'EXCEPTION_NOT_APPROVED', 409);
  return {
    audit: { exceptionId, requestedBy: ex.requestedBy, approvedBy: ex.decidedBy, approverRole: ex.decidedByRole, approvalReason: ex.decisionReason },
    exceptionId,
    consume: async (tx) => {
      const r = await tx.gymAssistedCheckInException.updateMany({
        where: { id: exceptionId, status: 'APPROVED', expiresAt: { gt: new Date() } },
        data: { status: 'USED' },
      });
      if (r.count !== 1) throw fail('EXCEPTION_ALREADY_USED', 409);
    },
    afterCheckin: async (tx, checkinId) => {
      await tx.gymAssistedCheckInException.update({ where: { id: exceptionId }, data: { usedCheckinId: checkinId } });
    },
  };
}

/** Ngoại lệ chờ duyệt / đã duyệt mà qua cuối ngày → EXPIRED (kèm sự kiện kiểm toán, mỗi cái đúng một lần). */
async function expireStaleExceptions(gymId: string, now: Date = new Date()) {
  const stale = await prisma.gymAssistedCheckInException.findMany({
    where: { gymId, status: { in: ['PENDING', 'APPROVED'] }, expiresAt: { lte: now } },
    take: 100,
  });
  for (const ex of stale) {
    const r = await prisma.gymAssistedCheckInException.updateMany({
      where: { id: ex.id, status: { in: ['PENDING', 'APPROVED'] } },
      data: { status: 'EXPIRED' },
    });
    if (r.count === 1) {
      await appendEventSafe({
        eventType: 'EXCEPTION_EXPIRED', gymId, staffUserId: 'system', staffRole: null, membershipId: ex.membershipId,
        clientId: ex.clientId, method: 'MANAGER_EXCEPTION', outcome: ex.status === 'APPROVED' ? 'APPROVED_UNUSED' : 'PENDING_UNDECIDED', exceptionId: ex.id,
      });
    }
  }
}
