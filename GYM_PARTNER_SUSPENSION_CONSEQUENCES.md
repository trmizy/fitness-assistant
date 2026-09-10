# GYM_PARTNER_SUSPENSION_CONSEQUENCES.md

Extracted from `docs/quan-ly-doi-tac.md` §4 for the GYM_MANAGEMENT master spec's deliverable
list (§65 "Suspension consequence table as documentation"). This is exactly what the admin
suspend/unsuspend dialog (§49 "Destructive action UX" — impact with real counts, reason,
affected entities, confirmation) must render before an admin can confirm.

Suspension disables the **OWNER account**, not the whole partner —
`partnerService.suspend` only changes `partner.status` and disables login for that one OWNER
account (`authClient.setUserActive`). Every other consequence needs no dedicated code — each
already reads `partner.status` at the exact point it always did:

| Target | Consequence | Enforced by |
|---|---|---|
| OWNER account | ❌ cannot log in | `partnerService.suspend` calls `authClient.setUserActive(false)` |
| MANAGER accounts | ✅ still work | untouched — only the OWNER is disabled |
| New membership sales / renewals | ❌ blocked | `partnerGuard.assertAcceptsNewMoney` in `membershipService.purchase` **and** `retryPay` (renewal = a new sale, same gate) |
| Memberships already ACTIVE | ✅ run to expiry | nothing blocks them — the gate only sits at purchase/payment time |
| Check-in for a member still in term | ✅ works normally | `checkin.service.ts` **deliberately** does not call `partnerGuard` |
| Public search listing | ❌ hidden | `gymService.listApproved`/`getApprovedById` filter through `partnerGuard.hiddenFromPublicOwnerUserIds()` (also covers TERMINATED) |
| Revenue already earned, posted to wallet | ✅ still posted | payment/webhook flow is untouched |
| Withdrawal requests | ❌ **frozen** | `partnerGuard.assertWithdrawalsAllowed` at `POST /owner/gyms/:gymId/withdrawals` |
| New PT collaboration | ❌ blocked | `partnerGuard.assertAcceptsNewMoney` in `collaborationController.proposeAsGym` |
| PT contracts already running | ✅ continue | untouched |

The suspension reason is never shown to members — `suspendedReason` is admin-only (the
Overview tab of the 360° partner detail view), never exposed on any public API.

## Mapped to the master spec's dialog requirement (§49/§62)

The admin's suspend confirmation dialog must show, before the destructive action is
confirmed:

- **Impact, with real counts and money**: active membership count + their remaining value
  (available via `partnerService.terminationImpact`-style aggregation — reused, not
  reinvented, for the suspend dialog's preview), current wallet `availableBalance` about to
  be frozen.
- **Reason**: required free-text, stored in `suspendedReason`.
- **Affected entities**: OWNER account (blocked), MANAGER accounts (unaffected — call this
  out explicitly so the admin doesn't assume everyone is locked out).
- **Confirmation**: the primary button is the *safe* one (Cancel); Suspend is styled as the
  secondary/danger action, never the default-focused button.

Unsuspend reverses only what suspend touched — the OWNER account is re-enabled, and every
other row above simply reads `partner.status` back to ACTIVE with no state to repair.

See also [[gym-partner-status-mapping]] for how `verificationStatus` (Phase 1 of the new
master spec) is unaffected by suspend/unsuspend — it is a one-time onboarding gate, not a
recurring operational check.
