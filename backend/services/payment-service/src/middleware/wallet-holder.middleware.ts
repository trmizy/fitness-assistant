import type { NextFunction, Request, Response } from 'express';

/**
 * SECURITY_BUSINESS_HANDOFF item 8 (owner decision): `/me/wallet` and `/me/withdrawals` are the CLIENT (buyer) wallet, or the PT's
 * withdrawal of earnings. A GYM_OWNER account never had a wallet of its own here (the branch wallet is GYM-owned and goes through
 * gym-service's owner-verified proxy) - yet any authenticated role used to be mapped to a CLIENT wallet, so a gym-owner login silently got
 * an empty CLIENT wallet created and notifications linking to /client/wallet.
 *
 * Allowlist, fail-closed: only the two roles that can hold such a wallet pass. A dual PT + client person is ONE auth user with role
 * `PT` (auth-service Role = CUSTOMER | PT | ADMIN | GYM_OWNER; the JWT/verify payload carries exactly that one value), so the PT keeps
 * both the CLIENT wallet (GET /me/wallet) and the PT earnings flow. Scoped to the /me wallet routes only - NOT a gateway-wide requireRoles.
 */
export const WALLET_HOLDER_ROLES: readonly string[] = ['CUSTOMER', 'PT'];

export function canHoldClientWallet(role: unknown): boolean {
  return typeof role === 'string' && WALLET_HOLDER_ROLES.includes(role);
}

export function requireWalletHolderRole(req: Request, res: Response, next: NextFunction): void {
  if (!canHoldClientWallet(req.user?.role)) {
    res.status(403).json({
      success: false,
      error: { code: 'WALLET_ROLE_NOT_SUPPORTED', message: 'Loại tài khoản này không có ví khách hàng.' },
    });
    return;
  }
  next();
}
