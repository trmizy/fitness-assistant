import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { loginRateLimit } from "../middleware/loginRateLimit.middleware";

const router = Router();

router.post("/register", authController.register);
router.post("/register/verify", authController.verifyRegistration);
// BUG-021 / TC-SEC-01: throttle repeated failed logins from the same (ip, email).
router.post("/login", loginRateLimit, authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);
router.post("/verify", authController.verify);
router.patch("/me", authController.updateMe);
router.get("/users", authController.listUsers);
router.patch("/users/:userId/role", authController.updateUserRole);
// BUG-002 / BUG-025 / BUG-026: admin can disable / re-enable a user account.
router.patch("/users/:userId/disable", authController.setUserActive);
router.patch("/users/:userId/enable", authController.setUserActive);
router.post("/internal/users/batch", authController.batchGetUsersInternal);
router.get("/internal/users/:userId", authController.getUserInternal);
router.patch(
  "/internal/users/:userId/role",
  authController.updateUserRoleInternal,
);

export default router;
