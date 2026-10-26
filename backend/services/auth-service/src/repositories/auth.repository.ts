import { PrismaClient, Role } from "../generated/prisma";
import { logger } from "@gym-coach/shared";

export const prisma = new PrismaClient();

export const authRepository = {
  // `role` narrows to one role (e.g. the admin "Quản lý gym & owner" page listing only
  // GYM_OWNER accounts) — omitted, the original "everyone but ADMIN" behavior is unchanged.
  // `isActive` was missing from this select entirely, which is why the generic admin user
  // list hardcoded every row to "Active" (see gateway's /admin/users) — real disable/enable
  // state existed in the column but no list endpoint ever surfaced it.
  listUsers: (role?: Role) =>
    prisma.user.findMany({
      where: role ? { role } : { role: { not: "ADMIN" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    }),

  /**
   * C4-01 / C1-01 — find an account by email regardless of letter case.
   *
   * 1. exact spelling first (indexed; also how a legacy case-duplicate pair is told apart),
   * 2. otherwise a case-insensitive match, accepted only when it is unambiguous.
   *
   * If several accounts differ only by case (legacy duplicates created before emails were
   * normalised) and none is the exact spelling, this refuses with 409 EMAIL_CASE_AMBIGUOUS and
   * logs a warning — it never guesses which account is meant and never merges or deletes any.
   */
  async findUserByEmail(email: string) {
    const exact = await prisma.user.findUnique({ where: { email } });
    if (exact) return exact;
    const matches = await prisma.user.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      take: 3,
    });
    if (matches.length > 1) {
      logger.warn(
        { matchedAccounts: matches.length },
        "Several accounts share this email ignoring letter case; refusing to pick one",
      );
      throw {
        status: 409,
        code: "EMAIL_CASE_AMBIGUOUS",
        message:
          "Có nhiều tài khoản trùng email này (chỉ khác chữ hoa/chữ thường). Hãy nhập email đúng như lúc đăng ký hoặc liên hệ hỗ trợ.",
      };
    }
    return matches[0] ?? null;
  },

  findUserById: (id: string) =>
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        // isActive added by users_isactive migration. Returned to internal callers
        // (chat-eligibility) so they can deny chat when a user is disabled.
        isActive: true,
      },
    }),

  findUserWithPasswordById: (id: string) =>
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        password: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    }),

  findUsersByIds: (ids: string[]) =>
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, email: true },
    }),

  updateUserById: (
    id: string,
    data: { firstName?: string | null; lastName?: string | null },
  ) =>
    prisma.user.update({
      where: { id },
      data: {
        ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    }),

  // Any successful password change clears mustChangePassword — a forced first-login change
  // and a normal voluntary one both go through this same call, so both clear it the same way.
  updateUserPasswordById: (id: string, password: string) =>
    prisma.user.update({
      where: { id },
      data: { password, mustChangePassword: false },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    }),

  updateUserRoleById: (id: string, role: Role) =>
    prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    }),

  updateUser: (id: string, data: { isActive?: boolean }) =>
    prisma.user.update({
      where: { id },
      data: {
        ...(data.isActive !== undefined
          ? ({ isActive: data.isActive } as any)
          : {}),
      },
      select: { id: true, email: true, role: true, isActive: true },
    }) as any,

  createUser: (data: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    role: Role;
    mustChangePassword?: boolean;
  }) => prisma.user.create({ data }),

  createRefreshToken: (data: {
    token: string;
    userId: string;
    expiresAt: Date;
  }) => prisma.refreshToken.create({ data }),

  findRefreshToken: (token: string) =>
    prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    }),

  deleteRefreshToken: (id: string) =>
    prisma.refreshToken.delete({ where: { id } }),

  deleteRefreshTokenByValue: (token: string) =>
    prisma.refreshToken.deleteMany({ where: { token } }),

  deleteRefreshTokensByUserId: (userId: string) =>
    prisma.refreshToken.deleteMany({ where: { userId } }),

  // ── Đặt lại mật khẩu bằng link (Phase 2) ────────────────────────────────
  createPasswordResetToken: (data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestedBy?: string | null;
  }) => prisma.passwordResetToken.create({ data }),

  findPasswordResetByHash: (tokenHash: string) =>
    prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } }),

  markPasswordResetUsed: (id: string) =>
    prisma.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } }),

  /** Claim the single-use link and change credentials atomically. A failed write rolls back the claim. */
  consumePasswordReset: (id: string, userId: string, password: string) =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id, userId, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return null;
      const user = await tx.user.update({
        where: { id: userId },
        data: { password, mustChangePassword: false },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
      });
      await tx.refreshToken.deleteMany({ where: { userId } });
      return user;
    }),

  /** Vô hiệu hoá mọi link đặt lại còn hiệu lực của một người — dùng khi phát hành link mới. */
  invalidatePasswordResets: (userId: string) =>
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),

  /** Link đặt lại gần nhất của một người — cho thời gian chờ của yêu cầu tự phục vụ (GAP-4). */
  findLatestPasswordResetForUser: (userId: string) =>
    prisma.passwordResetToken.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    }),

  createAuditLog: (data: {
    userId: string;
    action: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: any;
  }) => prisma.auditLog.create({ data }),

  findEmailVerificationByEmail: (email: string) =>
    prisma.emailVerification.findUnique({ where: { email } }),

  upsertEmailVerification: (data: {
    email: string;
    passwordHash: string;
    firstName?: string | null;
    lastName?: string | null;
    otpHash: string;
    expiresAt: Date;
    sentAt: Date;
  }) =>
    prisma.emailVerification.upsert({
      where: { email: data.email },
      create: {
        email: data.email,
        passwordHash: data.passwordHash,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        otpHash: data.otpHash,
        expiresAt: data.expiresAt,
        sentAt: data.sentAt,
      },
      update: {
        passwordHash: data.passwordHash,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        otpHash: data.otpHash,
        expiresAt: data.expiresAt,
        sentAt: data.sentAt,
        attempts: 0,
      },
    }),

  incrementEmailVerificationAttempts: (email: string) =>
    prisma.emailVerification.update({
      where: { email },
      data: { attempts: { increment: 1 } },
    }),

  deleteEmailVerification: (email: string) =>
    prisma.emailVerification.delete({ where: { email } }),
};
