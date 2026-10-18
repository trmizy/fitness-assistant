/**
 * D25 - who has confirmed the PT terms, and the two questions the rest of the service asks:
 *   - `hasAcceptedCurrent(userId)`  -> may this PT accept a NEW client contract (acceptContract's gate)
 *   - `accept(userId, version)`     -> record a confirmation (idempotent; only the CURRENT version can be confirmed)
 *
 * The record is `PtTermsAcceptance` (append-only, one row per user and version). It is the single source of truth:
 * nothing is cached on UserProfile or on the contract, and nothing here touches a contract, a session or money.
 */
import { PrismaClient, Prisma, AuditEntityType } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { auditService } from "./audit.service";
import { PT_TERMS_VERSION, publicPtTerms } from "./pt-terms";


export type PtTermsSource = "APPLICATION" | "RECONFIRM";

/** 409 refusal carried by acceptContract (and by the accept endpoint for a stale version). */
export const PT_TERMS_NOT_ACCEPTED = "PT_TERMS_NOT_ACCEPTED";
export const PT_TERMS_VERSION_MISMATCH = "PT_TERMS_VERSION_MISMATCH";

function codedErr(message: string, status: number, code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

export const ptTermsService = {
  /** Has this user confirmed the CURRENT version? (a row for exactly this version - never "any version") */
  async hasAcceptedCurrent(userId: string, db: Pick<PrismaClient, "ptTermsAcceptance"> = prisma): Promise<boolean> {
    const row = await db.ptTermsAcceptance.findUnique({
      where: { userId_version: { userId, version: PT_TERMS_VERSION } },
      select: { id: true },
    });
    return row !== null;
  },

  /**
   * acceptContract's gate. Refuses with 409 PT_TERMS_NOT_ACCEPTED (body carries the current version) and writes
   * nothing. Called before any contract state, PDF, notification or money step.
   */
  async assertAcceptedCurrent(userId: string): Promise<void> {
    if (await this.hasAcceptedCurrent(userId)) return;
    throw codedErr(
      "Bạn cần xác nhận Điều khoản dành cho Huấn luyện viên (phiên bản mới nhất) trước khi chấp nhận hợp đồng mới.",
      409,
      PT_TERMS_NOT_ACCEPTED,
      { termsVersion: PT_TERMS_VERSION },
    );
  },

  /**
   * What the clients render: the served text plus this user's standing.
   *  - accepted:  confirmed the current version
   *  - acceptedVersion/acceptedAt: the latest confirmation of ANY version (null if never) - lets the banner say
   *    "terms were updated" vs "please confirm"
   */
  async getForUser(userId: string, isPt: boolean) {
    const [current, latest] = await Promise.all([
      prisma.ptTermsAcceptance.findUnique({
        where: { userId_version: { userId, version: PT_TERMS_VERSION } },
        select: { acceptedAt: true },
      }),
      prisma.ptTermsAcceptance.findFirst({
        where: { userId },
        orderBy: { acceptedAt: "desc" },
        select: { version: true, acceptedAt: true },
      }),
    ]);
    const accepted = current !== null;
    return {
      ...publicPtTerms(),
      accepted,
      acceptedAt: current?.acceptedAt ?? null,
      previouslyAcceptedVersion: !accepted ? (latest?.version ?? null) : null,
      // An approved PT who has not confirmed the current version: the clients show the re-confirmation banner.
      mustReconfirm: isPt && !accepted,
    };
  },

  /**
   * Record that `userId` confirmed `version`. Only the CURRENT version can be confirmed (an old or unknown one is a
   * 409 with the current version in the body). Idempotent: confirming twice keeps the first record and returns it.
   */
  async accept(
    userId: string,
    version: string | undefined,
    source: PtTermsSource,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
    db: Pick<PrismaClient, "ptTermsAcceptance"> = prisma,
  ) {
    if (version !== PT_TERMS_VERSION) {
      throw codedErr(
        "Điều khoản đã được cập nhật. Hãy mở lại để đọc phiên bản mới nhất.",
        409,
        PT_TERMS_VERSION_MISMATCH,
        { termsVersion: PT_TERMS_VERSION },
      );
    }
    let created = false;
    let row = await db.ptTermsAcceptance.findUnique({ where: { userId_version: { userId, version } } });
    if (!row) {
      try {
        row = await db.ptTermsAcceptance.create({
          data: { userId, version, source, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null },
        });
        created = true;
      } catch (e) {
        // A concurrent identical confirmation won the unique key: that IS the idempotent answer.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          row = await db.ptTermsAcceptance.findUnique({ where: { userId_version: { userId, version } } });
        } else {
          throw e;
        }
      }
    }
    if (created) {
      await auditService.record({
        actorUserId: userId,
        action: "PT_TERMS_ACCEPTED",
        entityType: AuditEntityType.PT_PROFILE,
        entityId: userId,
        metadata: { version, source },
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      });
    }
    return { version: row!.version, acceptedAt: row!.acceptedAt, accepted: true as const };
  },
};
