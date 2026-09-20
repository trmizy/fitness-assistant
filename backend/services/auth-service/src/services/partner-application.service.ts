import bcrypt from "bcryptjs";
import crypto from "crypto";
import { logger } from "@gym-coach/shared";
import { authRepository } from "../repositories/auth.repository";
import { partnerApplicationRepository as repo } from "../repositories/partner-application.repository";
import { issueSessionFor } from "./auth.service";
import { sendPlainEmail } from "./email.service";

/**
 * Đối tác Gym tự đăng ký — GYM_PARTNER_SELF_ONBOARDING_SPEC.md, GYM_PARTNER_SECURITY_MODEL.md §3–§5.
 *
 *   start        email → (nếu hợp lệ) gửi link có token trong FRAGMENT
 *   verify       POST token → VALID | EXPIRED | USED | INVALID, kèm setupToken ngắn hạn khi VALID
 *   setPassword  setupToken + mật khẩu → tạo User GYM_OWNER + cấp phiên
 *
 * Token email và setupToken chỉ tồn tại ở dạng băm trong DB. Cooldown và trần số email/ngày theo
 * email đọc từ chính bảng token (đếm các dòng gần đây) nên đúng cả khi có nhiều instance — khác
 * middleware in-memory của các endpoint gửi email cũ.
 */

const TOKEN_TTL_HOURS = Number(process.env.PARTNER_APPLICATION_TTL_HOURS || 24);
const SETUP_TTL_MINUTES = Number(process.env.PARTNER_APPLICATION_SETUP_TTL_MINUTES || 15);
const COOLDOWN_SECONDS = Number(process.env.PARTNER_APPLICATION_COOLDOWN_SECONDS || 60);
const MAX_PER_DAY = Number(process.env.PARTNER_APPLICATION_MAX_PER_DAY || 10);

export type PartnerApplicationVerifyStatus = "VALID" | "EXPIRED" | "USED" | "INVALID";

function err(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return { status, code, message, ...extra };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Chỉ dùng cho E2E: token gốc không được lưu nên không có cách nào khác lấy lại link. */
function devEchoEnabled(): boolean {
  return process.env.PARTNER_APPLICATION_DEV_ECHO === "true" && process.env.NODE_ENV !== "production";
}

async function deliverLink(email: string, link: string, tokenId: string): Promise<boolean> {
  try {
    const result = await sendPlainEmail({
      to: email,
      subject: "Xác minh email để trở thành đối tác Gymini",
      text: [
        "Xin chào,",
        "",
        "Cảm ơn bạn đã quan tâm đến việc đưa phòng tập lên Gymini.",
        `Mở liên kết sau để xác minh email và tạo mật khẩu (hiệu lực ${TOKEN_TTL_HOURS} giờ):`,
        link,
        "",
        "Nếu bạn không yêu cầu, hãy bỏ qua email này — sẽ không có tài khoản nào được tạo.",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;">
          <p>Xin chào,</p>
          <p>Cảm ơn bạn đã quan tâm đến việc đưa phòng tập lên Gymini.</p>
          <p><a href="${escapeHtml(link)}">Xác minh email và tạo mật khẩu</a> — hiệu lực ${TOKEN_TTL_HOURS} giờ.</p>
          <p>Nếu bạn không yêu cầu, hãy bỏ qua email này — sẽ không có tài khoản nào được tạo.</p>
        </div>
      `,
    });
    return result.delivered;
  } catch (error) {
    // Không log link/token; chỉ id của dòng để truy vết.
    logger.error({ err: error, tokenId }, "Partner application email failed");
    return false;
  }
}

export const partnerApplicationService = {
  /**
   * `linkBaseUrl` phải đến từ cấu hình server, không bao giờ từ request — xem
   * authController.requestPasswordReset để biết vì sao (password-reset poisoning).
   */
  async start(email: string, linkBaseUrl: string) {
    const existing = await authRepository.findUserByEmail(email);
    if (existing) {
      // Quyết định của Ngài: chặn ngay ở bước nhập email. Thông điệp cố ý không nói tài khoản đó
      // thuộc vai trò nào (Customer / PT / Admin) ngoài trường hợp đã là đối tác.
      if (existing.role === "GYM_OWNER") {
        throw err(
          409,
          "EMAIL_ALREADY_PARTNER",
          "Email này đã có tài khoản đối tác. Hãy đăng nhập để tiếp tục hồ sơ.",
        );
      }
      throw err(
        409,
        "EMAIL_IN_USE",
        "Email này đã được dùng cho một tài khoản Gymini khác. Hãy dùng email khác cho hồ sơ đối tác, hoặc liên hệ hỗ trợ.",
      );
    }

    const now = Date.now();
    const recent = await repo.listRecentByEmail(email, new Date(now - 24 * 60 * 60 * 1000));

    const latest = recent[0];
    if (latest) {
      const sinceLast = (now - latest.createdAt.getTime()) / 1000;
      if (sinceLast < COOLDOWN_SECONDS) {
        const retryAfterSeconds = Math.ceil(COOLDOWN_SECONDS - sinceLast);
        throw err(429, "RESEND_COOLDOWN", `Vui lòng đợi ${retryAfterSeconds} giây trước khi gửi lại.`, {
          retryAfterSeconds,
        });
      }
    }
    if (recent.length >= MAX_PER_DAY) {
      throw err(429, "DAILY_LIMIT", "Bạn đã yêu cầu quá nhiều lần hôm nay. Hãy thử lại vào ngày mai.");
    }

    const rawToken = newToken();
    const created = await repo.createToken({
      email,
      tokenHash: sha256(rawToken),
      expiresAt: new Date(now + TOKEN_TTL_HOURS * 60 * 60 * 1000),
    });
    // Link cũ (nếu có) chết ngay — không kéo dài hạn của nó.
    await repo.supersedeOthers(email, created.id);

    // Token nằm trong FRAGMENT: không được gửi lên server/CDN/log/Referer khi mở link. Trang
    // đích đọc nó rồi xoá khỏi URL ngay trước khi gọi API.
    const link = `${linkBaseUrl.replace(/\/$/, "")}/partner/apply/verify#token=${rawToken}`;

    // E2E / dev: link được trả thẳng trong response nên KHÔNG gửi email thật tới địa chỉ thử.
    const delivered = devEchoEnabled() ? true : await deliverLink(email, link, created.id);

    const response: {
      status: "SENT" | "DELIVERY_FAILED";
      email: string;
      expiresInHours: number;
      devVerifyLink?: string;
    } = {
      status: delivered ? "SENT" : "DELIVERY_FAILED",
      email,
      expiresInHours: TOKEN_TTL_HOURS,
    };
    if (devEchoEnabled()) response.devVerifyLink = link;
    return response;
  },

  /** POST (không phải GET) để bộ quét email không vô tình "mở" link. KHÔNG tiêu token email. */
  async verify(rawToken: string) {
    const row = await repo.findByTokenHash(sha256(rawToken));
    if (!row) return { status: "INVALID" as PartnerApplicationVerifyStatus };
    if (row.usedAt) return { status: "USED" as PartnerApplicationVerifyStatus };
    if (row.supersededAt || row.expiresAt.getTime() < Date.now()) {
      return { status: "EXPIRED" as PartnerApplicationVerifyStatus };
    }

    // Mỗi lần verify sinh phiên đặt mật khẩu mới; phiên cũ bị ghi đè nên vô hiệu.
    const setupToken = newToken();
    const setupExpiresAt = new Date(Date.now() + SETUP_TTL_MINUTES * 60 * 1000);
    await repo.setSetupSession(row.id, {
      verifiedAt: row.verifiedAt ?? new Date(),
      setupTokenHash: sha256(setupToken),
      setupExpiresAt,
    });

    return {
      status: "VALID" as PartnerApplicationVerifyStatus,
      email: row.email,
      setupToken,
      setupExpiresAt,
    };
  },

  async setPassword(setupToken: string, password: string) {
    const row = await repo.findBySetupTokenHash(sha256(setupToken));
    const SETUP_INVALID = err(
      400,
      "SETUP_INVALID",
      "Phiên tạo mật khẩu không hợp lệ hoặc đã hết hạn. Hãy mở lại liên kết trong email.",
    );
    if (!row || !row.verifiedAt) throw SETUP_INVALID;
    if (row.usedAt) {
      throw err(409, "TOKEN_USED", "Liên kết này đã được sử dụng. Hãy đăng nhập để tiếp tục hồ sơ.");
    }
    if (
      row.supersededAt ||
      row.expiresAt.getTime() < Date.now() ||
      !row.setupExpiresAt ||
      row.setupExpiresAt.getTime() < Date.now()
    ) {
      throw SETUP_INVALID;
    }

    // Có thể có người đăng ký thường bằng đúng email này trong lúc chờ.
    if (await authRepository.findUserByEmail(row.email)) {
      throw err(
        409,
        "EMAIL_IN_USE",
        "Email này đã được dùng cho một tài khoản Gymini khác. Hãy dùng email khác cho hồ sơ đối tác.",
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let user;
    try {
      user = await repo.createApplicantAccount({ tokenId: row.id, email: row.email, passwordHash });
    } catch (error: any) {
      if (error?.code === "P2002") {
        throw err(409, "EMAIL_IN_USE", "Email này đã được dùng cho một tài khoản Gymini khác.");
      }
      throw error;
    }
    if (!user) {
      throw err(409, "TOKEN_USED", "Liên kết này đã được sử dụng. Hãy đăng nhập để tiếp tục hồ sơ.");
    }

    logger.info({ userId: user.id }, "Partner application account created");
    return issueSessionFor(user);
  },
};
