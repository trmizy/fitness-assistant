# 03 — Role & Capability/Permission Matrix

## Confirmed role model

**Four system-level roles exist, confirmed independently across three sources** (web frontend `AppContext.tsx`, mobile frontend `AppContext.tsx`, auth-service `Role` enum) — this is as solid a cross-check as this audit can produce without live DB access:

```
Role = CUSTOMER | PT | ADMIN | GYM_OWNER     (auth-service enum — canonical)
UserRole = "client" | "pt" | "gym_owner" | "admin"   (frontend naming, maps 1:1)
```

A **5th role, `GYM_STAFF`/`gym_manager`, existed historically and was removed** (confirmed by code comment in web `AppContext.tsx`, citing "Money-flow plan 5.1"). It is NOT the same thing as today's MANAGER concept below — do not conflate.

### MANAGER is a permission, not a role

Both the branch OWNER and a branch MANAGER authenticate as `GYM_OWNER`. The OWNER/MANAGER distinction is enforced:
- **Server-side (the real boundary)**: `gym-service/src/middleware/partner-context.middleware.ts` — `requirePartnerOwner` ("money and people = OWNER only") and `requireGymScope(paramName)` (MANAGER limited to assigned branches only).
- **Client-side (UX convenience only, explicitly commented as such in the mobile codebase — "not a security boundary")**: web hides `ownerOnly`-flagged nav items (Wallet, Managers, Collaborations) from MANAGER accounts; mobile checks `isManagerAccount`/`isBrandOwner` from partner-account data before rendering owner-only screens.

This is a clean example of the correct pattern (defense enforced server-side, client-side is convenience only) — confirmed in 3 independent places by 3 independent discovery agents with no contradiction.

### One account, multiple capability-roles — RESOLVED

**A single account cannot hold `client` and `pt` roles simultaneously in the database.** `Role` (auth-service `User.role`) is a single mutually-exclusive scalar enum column, not a set — becoming a PT (`profile.service.ts::becomePT`) literally overwrites the column via an internal PATCH call; reverting overwrites it back. `UserProfile.isPT` (user-service) mirrors the same fact, it is not an independent second role.

**But the product functionally behaves like dual-capability anyway**, because almost nothing in fitness-service's or user-service's client-facing routes checks `role === 'CUSTOMER'` — ownership is authorized via the JWT's `userId`, not role. A `role=PT` account can still train/log nutrition/book sessions under its own userId, and can even become the `clientUserId` of a *different* PT's contract. So this is neither a true multi-role DB model nor a pure frontend `activeView` toggle — it's real functional dual capability riding on top of a strictly single-valued role field, made possible because most business logic authorizes by identity rather than by role. (Confirmed by direct code trace, see `08-pt-client-management-ai-copilot-audit.md` §4.)

---

## Capability matrix by role

`✅` = route/capability confirmed reachable. `🔒owner` = gated further to OWNER-only within the gym_owner role. `—` = not applicable to this role. `❓` = existence confirmed, authorization depth NOT independently verified by this audit (see linked gap).

| Capability area | client | pt | gym_owner | admin |
|---|---|---|---|---|
| Own profile/account/settings | ✅ | ✅ (own PT profile) | ✅ | ✅ |
| Onboarding wizard | ✅ | — (PT accounts entering client view get it) | — | — |
| Workout log / AI plans / roadmap / nutrition (as a trainee) | ✅ | ✅ (via client-view) | — | — |
| InBody entry | ✅ | ✅ (via client-view) | — | — |
| Exercise/food/muscle library | ✅ | ✅ | — | — |
| PT discovery / booking / contracts (as a customer) | ✅ | ✅ (via client-view) | — | — |
| Gym membership purchase / check-in / reviews | ✅ | ✅ (via client-view) | — | — |
| AI Coach chat | ✅ | ✅ (via client-view) | — | — |
| PT dashboard / client roster / client detail | — | ✅ | — | — |
| Assign/modify a client's training plan | — | ✅ ❓(authorization depth — see DOM-08, in-flight) | — | — |
| Review/accept/reject a client's CycleAssessment | — | ✅ ❓(same) | — | — |
| PT schedule / availability | — | ✅ | — | — |
| PT wallet / sellable packages | — | ✅ | — | — |
| PT↔Gym collaborations | — | ✅ | ✅ | — |
| Gym branch management (info/hours/photos/docs) | — | — | ✅ | — |
| Gym membership plans/pricing | — | — | ✅ | — |
| Wallet (gym revenue) | — | — | ✅ 🔒owner (server 403s MANAGER) | — |
| Manager invitations | — | — | ✅ 🔒owner | — |
| PT collaborations (gym side) | — | — | ✅ 🔒owner | — |
| Front-desk QR check-in | — | — | ✅ (both OWNER+MANAGER) | — |
| Partner self-onboarding application | — | — | ✅ (pre-approval state) | — |
| User management (disable/enable/role) | — | — | — | ✅ |
| PT application review | — | — | — | ✅ |
| Marketplace moderation | — | — | — | ✅ |
| Exercise catalog moderation (duplicate review, quality matrix) | — | — | — | ✅ |
| Finance / commission / withdrawals | — | — | — | ✅ |
| Partner application review / active-partner management | — | — | — | ✅ |
| Gym/branch approval | — | — | — | ✅ |
| Complaints/disputes resolution | — | — | — | ✅ |
| AI observability | — | — | — | ✅ |
| System monitoring | — | — | — | ❓ UI exists; real monitoring stack NOT deployed to prod per gap register G-14 |
| Global cross-partner audit log | — | — | — | ❌ self-acknowledged not built (team's own code comment) |
| Membership oversight screen | — | — | — | ❌ self-acknowledged not built |
| Active-PT-list view | — | — | — | ❌ blocked on missing backend API |

---

## Authorization boundary findings (cross-referenced with `docs/production-readiness/`)

| Finding | Severity | Evidence |
|---|---|---|
| Admin role/status mutation routes (`PATCH /auth/users/:id/role\|disable\|enable\|name`) have **no role check inside auth-service itself** — enforcement is gateway-only | P1 (GAP-G08) | `auth.routes.ts` controllers; mitigated today only because production compose publishes no direct auth-service port, i.e. network topology is currently doing the job defense-in-depth should be doing. |
| `/auth/internal/*` and other internal routes are reachable through the **public** gateway proxy, gated only by one shared static secret compared with `!==` (not constant-time) | P1 (GAP-G09) | `gateway/src/routes/proxy.routes.ts`; same pattern in ai-service's internal routes. |
| No complete owner-check / cross-user-isolation test suite exists anywhere in the repo — authorization has been verified by **sampling only** | P1 (GAP-G24) | Production-readiness audit found 43 `findUnique({where:{id}}})` call sites outside tests across fitness/user/payment/gym, not all individually classified. |
| ai-service's `requireRole` middleware explicitly **trusts gateway-injected `x-user-role` headers** rather than re-verifying, by design, with an inline comment that this is "only safe because ai-service isn't meant to be publicly reachable directly" | Architectural risk, not yet rated | Phase-1 ai-service structural agent finding; worth confirming no direct route to ai-service exists in any deployment topology (compose or Lambda) before treating this as safe. |
| Coach(PT)-client relationship re-check on the server **is** real and was specifically verified (not just claimed) by the independent production-readiness audit | Positive finding | `coach.service.ts`, cited under "What is good" in that audit's executive summary. |
| Shared, unscoped exercise cache depends on every caller re-applying `USER_CUSTOM` visibility after the cache read | P2 (GAP-G29) | `exercise.repository.ts` lines ~84-108 per the prior audit; a future caller that forgets the check would leak another user's custom exercise. |

## Open questions for this matrix

1. ~~Exact mechanics of the client+pt dual-capability account~~ — **RESOLVED**, see above.
2. ~~Whether a PT can ever reach another PT's client's data by supplying a `clientId` without a server-side relationship check~~ — **RESOLVED: no.** Direct trace of all 10 `coach.controller.ts` handlers confirms the client id source is always the URL path, never the request body, and the relationship is re-verified fresh (fail-closed) on every call. See `08-pt-client-management-ai-copilot-audit.md` §1. This materially narrows GAP-G24's "authorization verified by sampling only" concern for the PT-client case specifically, though G-24's broader claim (no complete owner-check matrix across *every* route family in the repo) still stands.
3. Web-side query-cache clearing on logout/account-switch — confirmed for mobile (`queryClient.clear()`), **not traced for web** by either this audit or the prior production-readiness audit. Still open. See gap BDG-12.
