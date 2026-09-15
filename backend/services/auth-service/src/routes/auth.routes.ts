import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { loginRateLimit } from "../middleware/loginRateLimit.middleware";
import { createEmailActionRateLimit } from "../middleware/emailActionRateLimit.middleware";

const router = Router();

router.post("/register", authController.register);
router.post("/register/verify", authController.verifyRegistration);
// GAP-5: re-issue the code for a sign-up still waiting on verification.
router.post(
  "/register/resend",
  createEmailActionRateLimit("register-resend"),
  authController.resendRegistration,
);
// BUG-021 / TC-SEC-01: throttle repeated failed logins from the same (ip, email).
router.post("/login", loginRateLimit, authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);
router.post("/verify", authController.verify);
router.patch("/me", authController.updateMe);
router.patch("/me/password", authController.changePassword);
router.get("/users", authController.listUsers);
router.patch("/users/:userId/role", authController.updateUserRole);
// BUG-002 / BUG-025 / BUG-026: admin can disable / re-enable a user account.
router.patch("/users/:userId/disable", authController.setUserActive);
router.patch("/users/:userId/enable", authController.setUserActive);
// "Quản lý gym & owner" — admin correcting another user's display name.
router.patch("/users/:userId/name", authController.updateUserName);
// Admin-only: create a gym-owner account directly — see authController.createGymOwner.
router.post("/admin/gym-owners", authController.createGymOwner);
// Phase 2 (quản trị đối tác) — người nhận link tự đặt mật khẩu mới, không cần đăng nhập.
router.post("/password-reset", authController.resetPassword);
// GAP-4: người dùng tự yêu cầu link đặt lại cho email của mình — link dẫn tới đúng trang +
// endpoint ở dòng trên.
router.post(
  "/password-reset/request",
  createEmailActionRateLimit("password-reset-request"),
  authController.requestPasswordReset,
);
// Kênh nội bộ cho gym-service: password-reset | revoke-sessions | create-invited-account.
router.post("/internal/partner-auth/:op", authController.partnerAuthInternal);
router.post("/internal/users/batch", authController.batchGetUsersInternal);
router.get("/internal/users/:userId", authController.getUserInternal);
router.post("/internal/send-email", authController.sendEmailInternal);
router.patch(
  "/internal/users/:userId/role",
  authController.updateUserRoleInternal,
);

export default router;
