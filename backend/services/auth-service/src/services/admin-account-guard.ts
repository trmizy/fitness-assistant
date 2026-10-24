import { prisma } from "../repositories/auth.repository";

/**
 * Read-only helper behind the "an admin can't lock themselves out" rules (B42).
 * Kept in its own module so the (shared, other-session-owned) auth repository/service stay
 * untouched, and exposed as an object so tests can patch the count.
 */
export const adminAccountGuard = {
  countActiveAdmins: (): Promise<number> =>
    prisma.user.count({ where: { role: "ADMIN", isActive: true } }),
};
