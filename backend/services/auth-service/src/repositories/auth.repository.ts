import { PrismaClient, Prisma, Role } from "../generated/prisma";
import { logger } from "@gym-coach/shared";
import type { DashboardSummary } from "../services/admin-dashboard-summary-query";

export const prisma = new PrismaClient();

// Lets a caller run a write inside an existing `prisma.$transaction(async (tx) => ...)`
// by passing `tx` through, instead of every method being hardcoded to the module-level
// singleton. Defaults to the singleton so every existing non-transactional call site is
// unaffected. Used by changePassword/resetPasswordWithToken (auth.service.ts) so a
// password update and its refresh-token revocation commit or roll back together — see
// docs/deployment/AWS_DEV_AUTH_SECURITY_REMEDIATION_2026-09-29.md.
type DbClient = PrismaClient | Prisma.TransactionClient;

export type AdminListedUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Combining diacritical marks U+0300..U+036F (what NFD splits "ễ" into), as a Postgres regex. */
const COMBINING_MARKS = "[\\u0300-\\u036f]";

/** SQL twin of the gateway's `foldAdminSearch`: NFD, drop marks, đ -> d, lower-case. */
function foldSql(expr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`lower(translate(regexp_replace(normalize(${expr}, NFD), ${COMBINING_MARKS}, '', 'g'), 'đĐ', 'dd'))`;
}

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
   * FIX5-ADMIN-PERF — one page of the admin user list, filtered and sorted in the database.
   * Same rows, order (`createdAt` desc, `id` as the tie-break so paging is stable) and role rule as
   * `listUsers` (no `role` = everyone but ADMIN). `search` is matched against the display name
   * (first + last) and the email, lower-case and diacritics-free on BOTH sides, exactly like the
   * gateway's old in-memory `foldAdminSearch` ("nguyen" finds "Nguyễn"). `total` is the number of
   * rows matching the filters, not the page size. `limit` omitted = every matching row (no paging).
   */
  async listUsersPage(q: {
    role?: Role;
    isActive?: boolean;
    /** Already folded (lower-case, no diacritics) by the caller. */
    searchKey?: string | null;
    id?: string;
    ids?: string[];
    page?: number;
    limit?: number;
  }): Promise<{ users: AdminListedUser[]; total: number }> {
    const conds: Prisma.Sql[] = [q.role ? Prisma.sql`"role" = ${q.role}::"Role"` : Prisma.sql`"role" <> 'ADMIN'::"Role"`];
    if (q.isActive !== undefined) conds.push(Prisma.sql`"isActive" = ${q.isActive}`);
    if (q.id) conds.push(Prisma.sql`"id" = ${q.id}`);
    if (q.ids && q.ids.length > 0) conds.push(Prisma.sql`"id" IN (${Prisma.join(q.ids)})`);
    if (q.searchKey) {
      conds.push(
        Prisma.sql`(position(${q.searchKey} in ${foldSql(Prisma.sql`btrim(concat_ws(' ', "firstName", "lastName"))`)}) > 0
          OR position(${q.searchKey} in ${foldSql(Prisma.sql`"email"`)}) > 0)`,
      );
    }
    const where = Prisma.join(conds, " AND ");
    const paged = q.limit !== undefined;
    const limitSql = paged ? Prisma.sql`LIMIT ${q.limit} OFFSET ${((q.page ?? 1) - 1) * (q.limit as number)}` : Prisma.empty;
    const rows = await prisma.$queryRaw<Array<AdminListedUser & { total: bigint }>>(Prisma.sql`
      SELECT "id", "email", "firstName", "lastName", "role", "isActive", "createdAt", "updatedAt",
             count(*) OVER() AS total
      FROM "users"
      WHERE ${where}
      ORDER BY "createdAt" DESC, "id" ASC
      ${limitSql}`);
    if (rows.length > 0) {
      return { users: rows.map(({ total: _t, ...u }) => u), total: Number(rows[0].total) };
    }
    // Empty page: either nothing matches or the page is past the end — only then is a count needed.
    if (!paged) return { users: [], total: 0 };
    const [{ n }] = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT count(*) AS n FROM "users" WHERE ${where}`);
    return { users: [], total: Number(n) };
  },

  /**
   * Admin dashboard numbers for ALL accounts except admins and `excludeIds`, computed in the database in three small queries
   * (totals + roles + trainers, accounts per month, newest accounts). Replaces reading every account into memory: at 37k accounts that
   * answer (~8 MB) exceeds a Lambda's ~6 MB synchronous response. The two id lists travel as ONE JSON parameter each (not one bind
   * parameter per id: Postgres allows 32767), unpacked with jsonb_array_elements_text.
   */
  async dashboardSummary(q: { excludeIds: string[]; ptUserIds: string[]; since: Date; recentLimit: number }): Promise<DashboardSummary> {
    const exclude = JSON.stringify(q.excludeIds);
    const pt = JSON.stringify(q.ptUserIds);
    const base = Prisma.sql`"role" <> 'ADMIN'::"Role" AND "id" NOT IN (SELECT jsonb_array_elements_text(${exclude}::jsonb))`;

    const [totals] = await prisma.$queryRaw<
      Array<{ total: bigint; customers: bigint; pts: bigint; owners: bigint; trainers: bigint; pending: bigint }>
    >(Prisma.sql`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE "role" = 'CUSTOMER'::"Role") AS customers,
             count(*) FILTER (WHERE "role" = 'PT'::"Role") AS pts,
             count(*) FILTER (WHERE "role" = 'GYM_OWNER'::"Role") AS owners,
             count(*) FILTER (WHERE "role" = 'PT'::"Role" OR "id" IN (SELECT jsonb_array_elements_text(${pt}::jsonb))) AS trainers,
             count(*) FILTER (WHERE "role" <> 'PT'::"Role" AND "id" IN (SELECT jsonb_array_elements_text(${pt}::jsonb))) AS pending
      FROM "users"
      WHERE ${base}`);

    const months = await prisma.$queryRaw<Array<{ ym: string; n: bigint }>>(Prisma.sql`
      -- "createdAt" is timestamp WITHOUT time zone holding UTC: first say "this is UTC", then convert to Vietnam time (the month a signup counts in).
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM') AS ym, count(*) AS n
      FROM "users"
      WHERE ${base} AND "createdAt" >= ${q.since}
      GROUP BY 1`);

    const recent = await prisma.$queryRaw<AdminListedUser[]>(Prisma.sql`
      SELECT "id", "email", "firstName", "lastName", "role", "isActive", "createdAt", "updatedAt"
      FROM "users"
      WHERE ${base}
      ORDER BY "createdAt" DESC, "id" ASC
      LIMIT ${q.recentLimit}`);

    return {
      totalUsers: Number(totals?.total ?? 0),
      roleCounts: { CUSTOMER: Number(totals?.customers ?? 0), PT: Number(totals?.pts ?? 0), GYM_OWNER: Number(totals?.owners ?? 0) },
      trainers: Number(totals?.trainers ?? 0),
      pendingPT: Number(totals?.pending ?? 0),
      monthCounts: Object.fromEntries(months.map((m) => [m.ym, Number(m.n)])),
      recent: recent.map((u) => ({
        id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, isActive: u.isActive, createdAt: u.createdAt.toISOString(),
      })),
    };
  },

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

  /** Dispute: ACTIVE admins for the assignee / hand-over picker. Names only - no email, no other personal field. */
  listActiveAdminsMinimal: (take = 200) =>
    prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take,
      select: { id: true, firstName: true, lastName: true },
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
  updateUserPasswordById: (id: string, password: string, client: DbClient = prisma) =>
    client.user.update({
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

  deleteRefreshTokensByUserId: (userId: string, client: DbClient = prisma) =>
    client.refreshToken.deleteMany({ where: { userId } }),

  // ── Đặt lại mật khẩu bằng link (Phase 2) ────────────────────────────────
  createPasswordResetToken: (data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestedBy?: string | null;
  }) => prisma.passwordResetToken.create({ data }),

  findPasswordResetByHash: (tokenHash: string) =>
    prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } }),

  markPasswordResetUsed: (id: string, client: DbClient = prisma) =>
    client.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } }),

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
