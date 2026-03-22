import { Router } from 'express';
import { authController } from '../controllers/auth.controller';

const router = Router();

router.post('/register', authController.register);
router.post('/register/verify', authController.verifyRegistration);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.post('/verify', authController.verify);
router.patch('/me', authController.updateMe);
router.get('/users', authController.listUsers);
router.patch('/users/:userId/role', authController.updateUserRole);
router.patch('/internal/users/:userId/role', authController.updateUserRoleInternal);

export default router;
