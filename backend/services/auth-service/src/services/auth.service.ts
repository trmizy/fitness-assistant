import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import { logger } from "@gym-coach/shared";
import { authRepository } from "../repositories/auth.repository";
import type { Role } from "../generated/prisma";
import { relayPtActiveStateChange } from "./pt-deactivation-relay.service";
import type {
  ChangePasswordDto,
  RegisterStartDto,
  RegisterVerifyDto,
  UpdateMeDto,
  UpdateUserRoleDto,
} from "../models/auth.models";
import { sendOtpEmail, sendPlainEmail } from "./email.service";

// Self-service password reset (GAP-4). Shorter than the 24h an admin-issued partner link gets: a
// link the user asked for themselves is used within minutes, and a compromised inbox should not
// hold a live credential for a day.
const SELF_RESET_TTL_HOURS = Number(process.env.SELF_RESET_TTL_HOURS || 1);
const SELF_RESET_COOLDOWN_SECONDS = Number(
  process.env.SELF_RESET_COOLDOWN_SECONDS || 60,
);
/** One answer for every email, registered or not — see authService.requestPasswordReset. */
const PASSWORD_RESET_REQUEST_MESSAGE =
  "Nếu email này có tài khoản, chúng tôi đã gửi liên kết đặt lại mật khẩu.";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ACCESS_TOKEN_SECRET =
  process.env.JWT_SECRET || "dev_jwt_secret_change_in_production";
const REFRESH_TOKEN_SECRET =
  process.env.JWT_REFRESH_SECRET || "refresh-secret-key-change-in-production";
const ACCESS_TOKEN_EXPIRY =
  (process.env.JWT_ACCESS_EXPIRY as SignOptions["expiresIn"]) || "15m";
const REFRESH_TOKEN_EXPIRY =
  (process.env.JWT_REFRESH_EXPIRY as SignOptions["expiresIn"]) || "7d";
const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const OTP_RESEND_SECONDS = Number(process.env.OTP_RESEND_SECONDS || 60);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

function generateAccessToken(
  userId: string,
  role: string,
  email: string,
): string {
  return jwt.sign({ userId, role, email }, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

function generateRefreshToken(userId: string): string {
  return jwt.sign({ userId, jti: crypto.randomUUID() }, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

function makeRefreshExpiry(): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt;
}

/**
 * Đăng nhập ngay sau khi một tài khoản vừa được tạo (đăng ký OTP, đối tác tự đăng ký): cấp cặp
 * token và ghi refresh token — cùng đúng những gì verifyRegistration vốn tự làm.
 */
export async function issueSessionFor(user: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
}) {
  const accessToken = generateAccessToken(user.id, user.role, user.email);
  const refreshToken = generateRefreshToken(user.id);
  await authRepository.createRefreshToken({
    token: refreshToken,
    userId: user.id,
    expiresAt: makeRefreshExpiry(),
  });
  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
    accessToken,
    refreshToken,
  };
}

function makeOtpExpiry(): Date {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);
  return expiresAt;
}

function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export const authService = {
  async listUsers(role?: Role) {
    return authRepository.listUsers(role);
  },

  async register(data: RegisterStartDto) {
    const existing = await authRepository.findUserByEmail(data.email);
    // BUG-001 / TC-AUTH-02: must be a hard 409 conflict, not 400 — clearer for
    // the frontend to distinguish "already verified" from "validation error".
    if (existing) throw { status: 409, message: "Email đã đăng ký" };

    const previous = await authRepository.findEmailVerificationByEmail(
      data.email,
    );
    if (previous?.sentAt) {
      const secondsSinceLastSend =
        (Date.now() - previous.sentAt.getTime()) / 1000;
      if (secondsSinceLastSend < OTP_RESEND_SECONDS) {
        throw {
          status: 429,
          message: `OTP recently sent. Please wait ${Math.ceil(
            OTP_RESEND_SECONDS - secondsSinceLastSend,
          )}s`,
        };
      }
    }

    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const passwordHash = await bcrypt.hash(data.password, 10);
    const expiresAt = makeOtpExpiry();
    const sentAt = new Date();

    await authRepository.upsertEmailVerification({
      email: data.email,
      passwordHash,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      otpHash,
      expiresAt,
      sentAt,
    });

    const emailResult = await sendOtpEmail(
      data.email,
      otp,
      data.firstName,
      OTP_EXPIRY_MINUTES,
    );

    const response: {
      message: string;
      email: string;
      expiresInMinutes: number;
      devOtp?: string;
    } = {
      message: "OTP sent",
      email: data.email,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    };

    if (!emailResult.delivered && process.env.NODE_ENV !== "production") {
      response.devOtp = otp;
    }

    return response;
  },

  async verifyRegistration(data: RegisterVerifyDto) {
    const record = await authRepository.findEmailVerificationByEmail(
      data.email,
    );
    if (!record) throw { status: 400, message: "OTP not found" };

    if (record.expiresAt < new Date()) {
      throw { status: 400, message: "OTP expired" };
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      throw { status: 429, message: "OTP attempts exceeded" };
    }

    const otpHash = hashOtp(data.otp);
    if (otpHash !== record.otpHash) {
      await authRepository.incrementEmailVerificationAttempts(data.email);
      throw { status: 400, message: "Invalid OTP" };
    }

    const existing = await authRepository.findUserByEmail(data.email);
    if (existing) {
      await authRepository.deleteEmailVerification(data.email);
      throw { status: 400, message: "Email already registered" };
    }

    const user = await authRepository.createUser({
      email: record.email,
      password: record.passwordHash,
      firstName: record.firstName ?? undefined,
      lastName: record.lastName ?? undefined,
      role: "CUSTOMER",
    });

    await authRepository.deleteEmailVerification(data.email);

    const accessToken = generateAccessToken(user.id, user.role, user.email);
    const refreshToken = generateRefreshToken(user.id);
    await authRepository.createRefreshToken({
      token: refreshToken,
      userId: user.id,
      expiresAt: makeRefreshExpiry(),
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      accessToken,
      refreshToken,
    };
  },

  /**
   * GAP-5 — re-issue the registration code for a sign-up still waiting on verification.
   *
   * Works only on an existing pending row. That row already holds the hashed password and name
   * from the original POST /auth/register, so a resend can never change what account gets
   * created — it only replaces the code. Calling register() again used to be the only way to get a
   * new code, which meant retyping the password; the cooldown is the same one register() enforces.
   * upsertEmailVerification resets `attempts`, so someone locked out by wrong guesses on the old
   * code starts clean with the new one.
   */
  async resendRegistrationOtp(email: string) {
    const existing = await authRepository.findUserByEmail(email);
    if (existing) throw { status: 409, message: "Email đã đăng ký" };

    const pending = await authRepository.findEmailVerificationByEmail(email);
    if (!pending) {
      throw {
        status: 404,
        message: "Không có đăng ký nào đang chờ xác minh cho email này",
      };
    }

    const secondsSinceLastSend = (Date.now() - pending.sentAt.getTime()) / 1000;
    if (secondsSinceLastSend < OTP_RESEND_SECONDS) {
      throw {
        status: 429,
        message: `Mã vừa được gửi. Vui lòng đợi ${Math.ceil(
          OTP_RESEND_SECONDS - secondsSinceLastSend,
        )}s`,
      };
    }

    const otp = generateOtp();
    await authRepository.upsertEmailVerification({
      email: pending.email,
      passwordHash: pending.passwordHash,
      firstName: pending.firstName,
      lastName: pending.lastName,
      otpHash: hashOtp(otp),
      expiresAt: makeOtpExpiry(),
      sentAt: new Date(),
    });

    const emailResult = await sendOtpEmail(
      pending.email,
      otp,
      pending.firstName ?? undefined,
      OTP_EXPIRY_MINUTES,
    );

    const response: {
      message: string;
      email: string;
      expiresInMinutes: number;
      resendAfterSeconds: number;
      devOtp?: string;
    } = {
      message: "OTP sent",
      email: pending.email,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
      resendAfterSeconds: OTP_RESEND_SECONDS,
    };

    if (!emailResult.delivered && process.env.NODE_ENV !== "production") {
      response.devOtp = otp;
    }

    return response;
  },

  /**
   * GAP-4 — self-service "forgot password": email a reset LINK, never a password.
   *
   * Reuses issuePasswordResetToken (hashed, single-use, invalidates older links) and the web's
   * existing /dat-lai-mat-khau/:token page, which already calls POST /auth/password-reset — so the
   * step that actually changes a password is the same code path admin-issued partner links use.
   *
   * Answers identically whether the account is missing, disabled, or inside the cooldown: any
   * difference would let anyone probe which emails are registered. The one exception is
   * `devResetLink`, returned only outside production when SMTP is not configured — the same
   * trade-off register() already makes with `devOtp`, so a dev stack without mail can be exercised.
   *
   * `linkBaseUrl` must come from server configuration, never from the request — see
   * authController.requestPasswordReset for why.
   */
  async requestPasswordReset(email: string, linkBaseUrl: string) {
    const result: { message: string; devResetLink?: string } = {
      message: PASSWORD_RESET_REQUEST_MESSAGE,
    };

    const user = await authRepository.findUserByEmail(email);
    if (!user || !user.isActive) return result;

    const latest = await authRepository.findLatestPasswordResetForUser(user.id);
    if (
      latest &&
      (Date.now() - latest.createdAt.getTime()) / 1000 < SELF_RESET_COOLDOWN_SECONDS
    ) {
      return result;
    }

    const { rawToken, expiresAt } = await this.issuePasswordResetToken(
      user.id,
      undefined,
      SELF_RESET_TTL_HOURS,
    );

    const link = `${linkBaseUrl.replace(/\/$/, "")}/dat-lai-mat-khau/${rawToken}`;
    const minutes = Math.round(SELF_RESET_TTL_HOURS * 60);
    const greeting = user.firstName ? `Xin chào ${user.firstName},` : "Xin chào,";

    try {
      const emailResult = await sendPlainEmail({
        to: user.email,
        subject: "Đặt lại mật khẩu Gymini",
        text: [
          greeting,
          "",
          "Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.",
          `Mở liên kết sau để đặt mật khẩu mới (hiệu lực ${minutes} phút, chỉ dùng được một lần):`,
          link,
          "",
          "Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn giữ nguyên.",
        ].join("\n"),
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.5;">
            <p>${escapeHtml(greeting)}</p>
            <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.</p>
            <p><a href="${link}">Đặt mật khẩu mới</a> — hiệu lực ${minutes} phút, chỉ dùng được một lần.</p>
            <p>Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn giữ nguyên.</p>
          </div>
        `,
      });

      logger.info({ userId: user.id, expiresAt }, "Self-service password reset link issued");

      if (!emailResult.delivered && process.env.NODE_ENV !== "production") {
        result.devResetLink = link;
      }
    } catch (error) {
      // A mail failure must not change the response: a 500 here, returned only for emails that
      // HAVE an account, would be exactly the enumeration signal the uniform answer avoids. The
      // issued link is simply never delivered; the user can ask again after the cooldown.
      logger.error({ err: error, userId: user.id }, "Self-service password reset email failed");
    }

    return result;
  },

  async login(email: string, password: string) {
    const user = await authRepository.findUserByEmail(email);
    if (!user) throw { status: 401, message: "Invalid credentials" };

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) throw { status: 401, message: "Invalid credentials" };

    // BUG-002 / TC-AUTH-10: disabled accounts cannot log in. `isActive` is added
    // by the `users_isactive` migration; if the column doesn't exist yet (e.g. pre-
    // migration container), the value is undefined → treat as active.
    if ((user as any).isActive === false) {
      throw { status: 403, message: "Tài khoản đã bị vô hiệu hóa" };
    }

    const accessToken = generateAccessToken(user.id, user.role, user.email);
    const refreshToken = generateRefreshToken(user.id);
    await authRepository.createRefreshToken({
      token: refreshToken,
      userId: user.id,
      expiresAt: makeRefreshExpiry(),
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        mustChangePassword: (user as any).mustChangePassword ?? false,
      },
      accessToken,
      refreshToken,
    };
  },

  // Admin disable/enable. Returns the updated user (without password).
  //
  // Money-flow plan 2.6: locking a PT's account used to only ever flip this flag, leaving
  // their live contracts, booked sessions, and searchable profile untouched — user-service's
  // ptDeactivationService.deactivatePT existed with a ready internal endpoint for exactly this,
  // but nothing called it. `deps.relay` (defaulting to the real cross-service call) is
  // best-effort: a failure is recorded for retry (see pt-deactivation-relay.service.ts) rather
  // than thrown here, because the account lock/unlock itself is the primary action and must
  // not be blocked or rolled back by a secondary one failing.
  async setUserActive(
    userId: string,
    isActive: boolean,
    adminId: string,
    reason?: string,
    deps: { relay: typeof relayPtActiveStateChange } = { relay: relayPtActiveStateChange },
  ) {
    const updated = await authRepository.updateUser(userId, {
      isActive,
    } as any);
    if ((updated as any).role === "PT") {
      try {
        await deps.relay(userId, isActive ? "REACTIVATE" : "DEACTIVATE", adminId, reason);
      } catch (e) {
        // Defense in depth — the real relay already swallows its own failures internally
        // (recording them for the sweep to retry), but a custom `deps.relay` must not be able
        // to undo the account lock either.
        logger.error({
          error: "PT deactivation relay threw unexpectedly — account lock still applied",
          userId,
          message: (e as Error).message,
        });
      }
    }
    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      isActive: (updated as any).isActive ?? true,
    };
  },

  async refresh(refreshToken: string) {
    try {
      jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
    } catch {
      throw { status: 401, message: "Invalid refresh token" };
    }

    const storedToken = await authRepository.findRefreshToken(refreshToken);
    if (!storedToken) throw { status: 401, message: "Refresh token not found" };

    if (storedToken.expiresAt < new Date()) {
      await authRepository.deleteRefreshToken(storedToken.id);
      throw { status: 401, message: "Refresh token expired" };
    }

    if ((storedToken.user as any).isActive === false) {
      await authRepository.deleteRefreshToken(storedToken.id);
      throw { status: 403, message: "Tài khoản đã bị vô hiệu hóa" };
    }

    const accessToken = generateAccessToken(
      storedToken.user.id,
      storedToken.user.role,
      storedToken.user.email,
    );
    const newRefreshToken = generateRefreshToken(storedToken.user.id);
    await authRepository.deleteRefreshToken(storedToken.id);
    await authRepository.createRefreshToken({
      token: newRefreshToken,
      userId: storedToken.user.id,
      expiresAt: makeRefreshExpiry(),
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      userId: storedToken.user.id,
    };
  },

  async logout(refreshToken: string): Promise<string | undefined> {
    const deleted =
      await authRepository.deleteRefreshTokenByValue(refreshToken);
    if (deleted.count > 0) {
      try {
        const decoded: any = jwt.decode(refreshToken);
        if (decoded?.userId) return decoded.userId;
      } catch {
        // ignore decode errors
      }
    }
    return undefined;
  },

  async verifyToken(token: string) {
    let decoded: any;
    try {
      decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
    } catch {
      throw { status: 401, message: "Invalid token" };
    }

    const user = await authRepository.findUserById(decoded.userId);
    if (!user) throw { status: 401, message: "User not found" };
    if ((user as any).isActive === false) {
      throw { status: 403, message: "Tài khoản đã bị vô hiệu hóa" };
    }
    return user;
  },

  async updateMe(token: string, data: UpdateMeDto) {
    const user = await this.verifyToken(token);
    const updated = await authRepository.updateUserById(user.id, {
      ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
      ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
    });

    return {
      user: {
        id: updated.id,
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        role: updated.role,
      },
    };
  },

  async changePassword(token: string, data: ChangePasswordDto) {
    const verified = await this.verifyToken(token);
    const user = await authRepository.findUserWithPasswordById(verified.id);
    if (!user) throw { status: 401, message: "User not found" };

    const validPassword = await bcrypt.compare(
      data.currentPassword,
      user.password,
    );
    if (!validPassword) {
      throw { status: 401, message: "Current password is incorrect" };
    }

    const samePassword = await bcrypt.compare(data.newPassword, user.password);
    if (samePassword) {
      throw { status: 400, message: "New password must be different" };
    }

    const passwordHash = await bcrypt.hash(data.newPassword, 10);
    const updated = await authRepository.updateUserPasswordById(
      user.id,
      passwordHash,
    );

    await authRepository.deleteRefreshTokensByUserId(user.id);

    return {
      user: {
        id: updated.id,
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        role: updated.role,
      },
    };
  },

  async updateUserRole(userId: string, data: UpdateUserRoleDto) {
    const updated = await authRepository.updateUserRoleById(userId, data.role);
    return {
      user: {
        id: updated.id,
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        role: updated.role,
      },
    };
  },

  // ── Phase 2: đặt lại mật khẩu bằng link, buộc đăng xuất, lập tài khoản từ thư mời ──

  /**
   * Phát hành link đặt lại mật khẩu. Trả về token GỐC đúng một lần cho phía gọi để dựng
   * link — chỉ băm được lưu lại.
   *
   * Mọi link cũ còn hiệu lực bị vô hiệu hoá: phát hành link mới mà để link cũ sống tiếp
   * nghĩa là mỗi lần quản trị viên bấm nút lại thêm một credential trôi nổi.
   */
  async issuePasswordResetToken(userId: string, requestedBy?: string, ttlHours = 24) {
    const user = await authRepository.findUserById(userId);
    if (!user) throw { status: 404, message: "Không tìm thấy người dùng" };

    await authRepository.invalidatePasswordResets(userId);

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await authRepository.createPasswordResetToken({
      userId,
      tokenHash,
      expiresAt,
      requestedBy: requestedBy ?? null,
    });

    return { rawToken, expiresAt, user: { id: user.id, email: user.email, firstName: user.firstName } };
  },

  /**
   * Đổi mật khẩu bằng token đặt lại. Khác changePassword ở chỗ không cần mật khẩu cũ —
   * bằng chứng danh tính chính là việc cầm được token gửi tới hộp thư của họ.
   *
   * Dùng xong đánh dấu usedAt ngay (một lần duy nhất) và huỷ mọi phiên đăng nhập đang mở:
   * nếu lý do đặt lại là tài khoản bị chiếm, để phiên của kẻ chiếm sống tiếp thì việc đặt
   * lại mật khẩu chẳng giải quyết được gì.
   */
  async resetPasswordWithToken(rawToken: string, newPassword: string) {
    if (!rawToken) throw { status: 400, message: "Thiếu mã đặt lại" };
    if (!newPassword || newPassword.length < 8) {
      throw { status: 400, message: "Mật khẩu mới phải có ít nhất 8 ký tự" };
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const record = await authRepository.findPasswordResetByHash(tokenHash);
    if (!record) throw { status: 404, message: "Liên kết đặt lại không hợp lệ" };
    if (record.usedAt) throw { status: 409, message: "Liên kết này đã được sử dụng" };
    if (record.expiresAt.getTime() <= Date.now()) {
      throw { status: 410, message: "Liên kết đặt lại đã hết hạn" };
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    // updateUserPasswordById cũng xoá luôn cờ mustChangePassword — mọi đường đổi mật khẩu
    // đều đi qua đó nên không cần xử lý riêng ở đây.
    const updated = await authRepository.updateUserPasswordById(record.userId, passwordHash);
    await authRepository.markPasswordResetUsed(record.id);
    await authRepository.deleteRefreshTokensByUserId(record.userId);

    return { user: updated };
  },

  /** Buộc đăng xuất: huỷ mọi refresh token, phiên hiện tại hết hiệu lực khi access token hết hạn. */
  async revokeAllSessions(userId: string) {
    const result = await authRepository.deleteRefreshTokensByUserId(userId);
    return { revoked: result.count };
  },

  /**
   * Lập tài khoản đăng nhập từ một thư mời đối tác đã được xác thực (gym-service gọi qua
   * kênh nội bộ sau khi tự kiểm token của mình).
   *
   * Khác createGymOwnerAccount ở chỗ mật khẩu do CHÍNH NGƯỜI DÙNG đặt trong luồng nhận
   * thư mời — không có mật khẩu tạm nào được sinh ra, không có gì để gửi qua email, nên
   * mustChangePassword để false: họ vừa tự đặt mật khẩu xong, bắt đổi lại là vô nghĩa.
   */
  async createInvitedAccount(data: {
    email: string;
    password: string;
    firstName: string;
    lastName?: string;
  }) {
    const email = data.email.trim().toLowerCase();
    const existing = await authRepository.findUserByEmail(email);
    if (existing) throw { status: 409, message: "Email đã được sử dụng" };
    if (!data.password || data.password.length < 8) {
      throw { status: 400, message: "Mật khẩu phải có ít nhất 8 ký tự" };
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await authRepository.createUser({
      email,
      password: passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      role: "GYM_OWNER" as any,
      mustChangePassword: false,
    });

    return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role };
  },

  // "Quản lý gym & owner" — admin editing another user's display name. Deliberately reuses
  // updateUserById (same repo call self-service updateMe uses) rather than adding a parallel
  // one: the only thing that differs from updateMe is WHO the target id comes from (an admin
  // acting on someone else's account vs. a user's own token), which is already enforced at
  // the controller layer, not here. Email is intentionally not editable here — it doubles as
  // the login credential, so a typo would lock the owner out with no self-service recovery
  // (they'd have no working email to reset a password against).
  async updateUserNameAsAdmin(userId: string, data: { firstName?: string; lastName?: string }) {
    const updated = await authRepository.updateUserById(userId, data);
    return { user: updated };
  },
};
