import { prisma } from "./auth.repository";

/**
 * Bảng partner_application_tokens sống TRƯỚC khi có User, nên không có FK. Mọi truy vấn ở đây
 * chỉ nhận/trả băm (sha256) — token gốc không bao giờ vào tầng này.
 */
export const partnerApplicationRepository = {
  /** Các dòng gần đây của một email, mới nhất trước — nguồn cho cooldown + trần số email/ngày. */
  listRecentByEmail: (email: string, since: Date) =>
    prisma.partnerApplicationToken.findMany({
      where: { email, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
    }),

  createToken: (data: { email: string; tokenHash: string; expiresAt: Date }) =>
    prisma.partnerApplicationToken.create({ data }),

  /** "Gửi lại": link cũ chết ngay (không kéo dài hạn của nó). */
  supersedeOthers: (email: string, keepId: string) =>
    prisma.partnerApplicationToken.updateMany({
      where: { email, usedAt: null, supersededAt: null, id: { not: keepId } },
      data: { supersededAt: new Date() },
    }),

  findByTokenHash: (tokenHash: string) =>
    prisma.partnerApplicationToken.findUnique({ where: { tokenHash } }),

  findBySetupTokenHash: (setupTokenHash: string) =>
    prisma.partnerApplicationToken.findUnique({ where: { setupTokenHash } }),

  /** Đánh dấu đã mở link + cấp phiên đặt mật khẩu mới (phiên cũ, nếu có, bị ghi đè = vô hiệu). */
  setSetupSession: (
    id: string,
    data: { verifiedAt: Date; setupTokenHash: string; setupExpiresAt: Date },
  ) => prisma.partnerApplicationToken.update({ where: { id }, data }),

  /**
   * Một transaction trên MỘT datastore: "chiếm" token (chỉ khi chưa dùng/chưa bị thay) rồi tạo
   * User GYM_OWNER. Trả null nếu token đã bị chiếm bởi lần gọi khác (2 tab / bấm đúp) — người
   * gọi phải coi đó là 409, không được tạo User thứ hai. Hồ sơ đối tác bên gym-service KHÔNG tạo
   * ở đây: chính ứng viên gọi POST /owner/application/bootstrap ngay sau đó.
   */
  createApplicantAccount: (params: { tokenId: string; email: string; passwordHash: string }) =>
    prisma.$transaction(async (tx) => {
      const claimed = await tx.partnerApplicationToken.updateMany({
        where: { id: params.tokenId, usedAt: null, supersededAt: null },
        data: { usedAt: new Date(), setupTokenHash: null, setupExpiresAt: null },
      });
      if (claimed.count !== 1) return null;

      const user = await tx.user.create({
        data: {
          email: params.email,
          password: params.passwordHash,
          role: "GYM_OWNER",
          mustChangePassword: false,
        },
      });
      await tx.partnerApplicationToken.update({
        where: { id: params.tokenId },
        data: { createdUserId: user.id },
      });
      return user;
    }),
};
