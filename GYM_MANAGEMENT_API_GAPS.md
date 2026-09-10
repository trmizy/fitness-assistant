# GYM_MANAGEMENT_API_GAPS.md

> **Phase 1 (Identity & Verification Foundation) status: done.** `verificationStatus` +
> `assignedAdminId` on `GymPartner`, the per-field branch "Request Changes" mechanism,
> `expectedReopenAt`, and `PartnerInternalNote` are all live (migration
> `20260908050000_partner_verification_and_branch_review`), tested (7 new integration tests,
> 127/127 passing), and verified end-to-end against the running dev stack over real HTTP.
> Everything below this note describes the gap as it stood before Phase 1; sections now closed
> are marked accordingly rather than rewritten, so this stays a record of the reconciliation
> that was actually done.

Investigation output for the "GYMINI — Admin Gym Management + Gym Owner Partner Onboarding"
master spec, done **before** any screen work, per the spec's own Section 67 working method.

Context: this repo already shipped a full partner-identity system this same session
("Quản lý đối tác phòng tập", 5 phases — `docs/quan-ly-doi-tac.md`) that covers most of the
spec's Sections 1–11A/38/60–63 under different names/wording (Vietnamese-first, no separate
verification axis). This document is a line-by-line reconciliation: what already satisfies the
new spec as-is, what's a naming/wiring difference only, and what's a genuine backend gap.

Legend: ✅ already satisfies the spec · ⚠️ exists but incomplete vs spec · ❌ does not exist yet.

---

## 1. Identity & lifecycle model

| Spec concept | Status | Notes |
|---|---|---|
| GymPartner / GymPartnerAccount / PartnerInvitation, OWNER/MANAGER roles, `principalUserId` translation, DB-level "one ACTIVE owner" + "manager needs ≥1 scoped branch" invariants | ✅ | Built exactly as spec'd, including the "not a GYM_STAFF role" constraint. |
| Partner lifecycle status (PROSPECT/INVITED/ACTIVE/SUSPENDED/TERMINATED) | ✅ | `GymPartnerStatus` enum, matches spec Section 7 lifecycle 1:1. |
| **`verificationStatus`** as an axis separate from lifecycle status (NOT_VERIFIED/IN_REVIEW/NEEDS_INFO/VERIFIED/REJECTED) | ✅ done | `PartnerVerificationStatus` enum + `verificationStatus`/`verificationNotes`/`verifiedAt`/`verifiedBy` on `GymPartner`. `provisionOwnerAccount` now refuses unless VERIFIED. `reject`/`reopen` kept in sync; `setVerificationStatus` handles IN_REVIEW/NEEDS_INFO/VERIFIED (refuses REJECTED — use `reject()` instead, one path only). See [[gym-partner-status-mapping]]. |
| `assignedAdminId` on a partner record | ✅ done | Column + `partnerDiligenceService.assignAdmin` + `PATCH /admin/partners/:id/assigned-admin`, filterable via `GET /admin/partners?assignedAdminId=`. |
| Invitation TTL 7 days, resend invalidates previous link | ✅ | `DEFAULT_TTL_DAYS = 7`; resend overwrites `tokenHash` in place, so the old raw token no longer hashes to anything — already correct. |
| "View as partner" writes an audit entry | ✅ | `PartnerAuditAction.VIEWED_AS_PARTNER`, explicitly commented "not logging this would be a backdoor." |
| Owner cannot revoke their own OWNER account | ✅ (by construction) | `revokeAccount` blocks revoking the last ACTIVE owner; since the DB invariant caps a partner at exactly one ACTIVE owner, this is always the case in practice. |
| Ownership transfer, no password exchanged | ✅ | `transferOwnership` demotes-then-promotes in one transaction; no credential ever crosses hands. |

**Backend work required for Phase 1 parity**: add `verificationStatus` enum + column (+ `verificationNotes`, `verifiedAt`, `verifiedBy`) and `assignedAdminId` to `GymPartner`; extend `createPartner`/`updatePartner` and the admin partner-list/detail endpoints to expose and filter on both. No schema conflict with anything already built — purely additive.

---

## 2. Branch (Gym) moderation & operations

| Spec concept | Status | Notes |
|---|---|---|
| Moderation status (PENDING_REVIEW/APPROVED/REJECTED/SUSPENDED) separate from operational status (OPEN/TEMPORARILY_CLOSED/PERMANENTLY_CLOSED) | ✅ | `GymStatus` + `GymOperationalStatus`, already orthogonal exactly as spec'd. |
| Only name + address are "material"; branch **stays APPROVED** while a material change is pending, never reverts to PENDING_REVIEW | ✅ | `approvedName`/`pendingName` + `approvedAddress`/`pendingAddress` overlay; every public read uses the `approved*` pair, `setStatus`/`approveRename` never touch `GymStatus` for a rename. Matches spec §62 acceptance check exactly. |
| Branch set to TEMPORARILY_CLOSED with reason + reopen date; purchase/check-in blocked while closed; a payment completing during closure does **not** activate | ✅ done | Confirmed the purchase/checkin blocking and the auto-refund-instead-of-activate mechanism already existed exactly as expected. Added the missing piece: `expectedReopenAt` column, threaded through `setOperationalStatus`'s schema/controller/service/repository, cleared automatically on reopen. |
| Admin "Request Changes" on **specific fields** with per-field notes; owner sees exactly those items; resubmit flow | ✅ done | `pendingNameNote`/`pendingAddressNote`/`changesRequestedAt`/`changesRequestedBy` on `Gym` + `gymService.requestChanges` + `POST /admin/gyms/:id/request-changes`. Never touches `status`. Notes auto-clear when the owner edits the corresponding field again (resubmission) or when an admin approves (first approval or rename). Owner-side surfacing (a UI list of "exactly those N items") is a Phase 3/4 (Admin/Owner redesign) frontend task — the backend data + queue count (`pendingBranchChanges` in `GET /admin/partners/queue`) are ready for it now. |

---

## 3. Notifications

| Spec concept | Status | Notes |
|---|---|---|
| Generic notification delivery to a user, with `eventType`/`entityType`/`link`, read/unread | ✅ (elsewhere) | `Notification`/`NotificationPreference` models already exist in **user-service** (built for workout/PT-feedback events), not gym-service. |
| Notification for partner-lifecycle events (branch changes requested, invitation received, suspension, etc.) | ❌ | No `NotificationEventType` values exist yet for partner events, and gym-service has no call wiring into user-service's notification creation for these events. **Gap, but low-risk**: extend the existing enum + add the same kind of internal service-to-service call already used elsewhere in this codebase (`x-service-secret`), rather than building a new notification system. |
| Invitation delivered by email | ❌ | No mailer exists for invitations today; the admin UI surfaces the raw invite link for the admin to hand to the partner directly (copy/share manually). Actual email delivery is out of scope unless the user wants it — **flagging, not assuming an answer**. |

---

## 4. Membership plan access scope (SINGLE_BRANCH vs ALL_BRAND_BRANCHES)

| Spec concept | Status | Notes |
|---|---|---|
| A plan can be scoped to one specific branch or to "all branches of this brand, including future ones" | ❌ | `GymMembershipPlan` is brand-level only today — every plan already implicitly behaves like ALL_BRAND_BRANCHES (any branch under the brand accepts any of the brand's plans for check-in). There is currently no way to restrict a plan to a single branch. |
| Snapshot the access grant at purchase time (brandId-only snapshot for ALL_BRAND_BRANCHES, so branches added later are still included; a fixed gymId snapshot for SINGLE_BRANCH) | ❌ | No snapshot fields exist on `GymMembershipContract`. |

**This is a genuine business-rule / payment-semantics change** — it changes what a purchased membership entitles the holder to, and touches check-in authorization. Per the spec's own §67 ("STOP and ask before: changing business rules, changing membership payment semantics"), this needed explicit confirmation before any schema or check-in-logic change.

**Decision (confirmed with the user 2026-09-08): deferred, out of scope for this implementation round.** Current behavior (every plan usable at every branch of its brand) stays unchanged. Not touched in Phases 1–5 below.

---

## 5. Complaints / violations case management

> **Phase 5 status: done.** One shared `GymComplaint` table for every source
> (`SELF_DETECTED`/`MEMBER_REPORT`/`PT_REPORT`/`PARTNER_DISCLOSED` — confirmed design decision,
> not four separate tables), a private evidence-photo upload/serve pipeline built from scratch
> (gym-service had no file-upload infrastructure at all before this), a client-facing "Báo cáo
> vấn đề" submit + tracking flow, an admin queue + resolve flow, a COMPLAINTS tab on the
> partner detail page, and a resolve-notifies-reporter wire-up through user-service's existing
> generic notification endpoint. All verified live end-to-end (real client submission with
> photo → real admin resolve → real notification received), all test data cleaned up after.

| Spec concept | Status | Notes |
|---|---|---|
| A complaint/violation model with a status workflow, tied to a partner/branch, visible in a dedicated admin tab | ✅ done | `GymComplaint` (migration `20260908060000_gym_complaints`) + `complaintService`/`complaintRepository` + `/admin/complaints` (queue, detail, status, assign) + `/admin/partners/:id/complaints` (the tab) + `/gyms/:gymId/complaints` and `/me/complaints` (client side). |
| Eligibility guard for a member's own report | ✅ done | Confirmed with the user: active membership OR expired within 30 days at that specific branch (`membershipRepository.hasRecentOrActiveMembership`) — stricter than the review system's "ever paid, any time" rule on purpose. |
| Evidence photos, private (never public) | ✅ done | New multer + local-disk pipeline (gym-service's first — mirrors user-service's PT-application pattern, including the Lambda-runtime guard), served only through an authenticated route that checks the requester is either the uploader or an admin viewing an already-submitted complaint's photo. Frontend fetches via `AuthenticatedImage` (blob + object URL, since `<img src>` can't carry an auth header). |
| Resolution notifies the reporter | ✅ done | Reuses user-service's existing generic `POST /internal/notifications` (built for fitness-service's WORKOUT_* events) — added `GYM_COMPLAINT_RESOLVED`/`GYM_COMPLAINT` enum values rather than inventing a second notification pipeline. |
| Explicitly out of scope (confirmed with the user) | — | No back-and-forth conversation thread (one final `adminResponse` only), no automatic link to refunds, no anonymous reports, no appeals process (RESOLVED is terminal). |

**Still open**: the broader "extend Notification enum + wire owner-facing events" idea from the original Phase 3 gap analysis (branch-review "Request Changes" reaching the owner as a real notification, not just something they see next time they open the page; invitation-received; partner-suspended) — only the complaints-resolved case got wired this round, since that's what was explicitly asked for this phase. A `GYM_MANAGEMENT_FRONTEND_PARITY.md` and a formal responsive-breakpoint verification report (§65 deliverables) are also still outstanding — see the summary at the end of this document.

---

## 6. Internal notes (owner-invisible)

| Spec concept | Status | Notes |
|---|---|---|
| Admin-only free-text notes attached to a partner, never surfaced to the owner | ✅ done | `PartnerInternalNote` model (cascades on partner delete), `partnerDiligenceService.listInternalNotes`/`addInternalNote`, mounted ONLY at `admin.routes.ts` (`GET`/`POST /admin/partners/:id/internal-notes`) — never in `owner.routes.ts`, which is what makes it owner-invisible. |

---

## 7. Admin dashboard / IA

| Spec concept | Status | Notes |
|---|---|---|
| Existing `AdminPartnersPage.tsx` | ✅ Phase 3 partial | Retrofitted onto the shared status-badge library; added a working verification-axis panel (IN_REVIEW/NEEDS_INFO/VERIFIED, wired to Phase 1's endpoints) and a 7th tab, INTERNAL NOTES (owner-invisible, per §65). Still 3 tabs short of the spec's 11 — see the new note below. |
| Nav IA: Overview / Partners / Branches / Membership Oversight / Complaints / Notifications / Audit Logs, explicitly no top-level "Brands" | ✅ Phase 3 partial | Added `/admin/gym-management` (Overview, KPI + Needs-Attention dashboard) as a new first nav entry; renamed "Quản lý gym & owner"/"Đối tác phòng tập" to "Chi nhánh"/"Đối tác" to match spec vocabulary. Membership Oversight / Complaints / Notifications / a global cross-partner Audit Logs page deliberately NOT added as nav items yet — their backing screens don't exist (Complaints needs §5's new model; a global audit view and a standalone Membership Oversight page are both real, undone frontend work); adding a nav entry with nowhere real to go would be the "hide missing functionality behind mock data" the spec forbids. |
| Manager sees only their scoped branch; Wallet / Managers / Brand hidden from their nav entirely | ✅ done (Phase 4) | `Sidebar.tsx` now reads the already-fetched `["partner-onboarding-status"]` cache entry (no extra request) and filters "Người quản lý"/"Quản lý cộng tác" out of `gymOwnerNav` for a MANAGER. `MyGymsPage.tsx` additionally hides the brand-rename controls and both "add branch" affordances (top toolbar + per-brand tile) for MANAGER — OWNER-only actions are hidden, not shown-then-403'd, matching §52's explicit guidance. Verified live with a real MANAGER login (scoped to one real branch): sees only that branch, no rename/add-branch/managers/collaborations UI anywhere. There is still no separate "Wallet" nav item to filter (wallet is embedded per-gym in `GymManagePage.tsx`, which is entirely behind `requirePartnerOwner` server-side already — not yet given its own client-side hide-not-403 treatment). |

**Phase 3 (Admin Gym Management redesign) — what shipped and what didn't:**

Shipped: the Overview dashboard (`/admin/gym-management`, new `partnerDiligenceService.overviewStats()` endpoint), nav relabeling, `AdminPartnersPage.tsx`'s status pills/branch pills retrofitted onto `statusConfig.ts`, a working verification-axis control panel, the INTERNAL NOTES tab, and `AdminGymModeration.tsx`'s "Yêu cầu chỉnh sửa" (Request Changes) button + panel wired to Phase 1's per-field API — verified live end-to-end (create → flag → view → submit) against the running dev stack, all disposable test rows cleaned up afterward.

**Phase 4 (Gym Owner redesign) — what shipped and what didn't:**

Shipped: MANAGER-aware nav filtering (Sidebar) and brand/branch-creation UI hiding (MyGymsPage), a real "Needs Attention" action center on `GymOwnerDashboard.tsx` positioned above the KPI row (derived from already-fetched gym data, zero extra requests — surfaces branches pending first-time approval and branches with a standing admin "Request Changes"), `RequestChangesPanel` (view mode) and the `expectedReopenAt` date input surfaced on `GymManagePage.tsx` (both Phase 1 backend features that had no owner-facing UI until now), and a genuine bug fix found while implementing the last acceptance-test line ("owner revokes the manager → session terminated immediately"): `partnerService.revokeAccount` only flipped the DB status before, never actually invalidating the account's live session — fixed by calling the same `authClient.revokeSessions` the admin's existing "force logout" action already used, so both the owner-revokes-their-own-manager path and the admin-revokes-any-account path (both already funneled through this one function) now get the fix at once. All verified live end-to-end with a real disposable MANAGER login + a real flagged branch on jane.smith's own account, then fully cleaned up.

Explicitly NOT done in Phase 4 (still open):
- The onboarding wizard was not reviewed against the spec's 8 named steps (Welcome/Password/Profile/Brand/Payout/Terms/First-Branch/Review-Submit) — the existing 5-tracked-step wizard may already satisfy this functionally (the backend only tracks contact/brand/payout/terms as checkpoints; a wizard UI can render more discrete screens around those without new backend state), but this was not verified this phase.
- A brand-rename request flow review (does the owner's rename UX already match §61's "the public name does NOT change until admin approves" acceptance line exactly?) — likely already correct given the pre-existing `pendingName`/`approvedName` overlay, but not re-verified live this phase.
- Hiding the Wallet section specifically for a MANAGER inside `GymManagePage.tsx` (currently just blocked server-side via `requirePartnerOwner`, not hidden client-side).
- Mobile-specific bottom-nav / bottom-sheet patterns for the gym-owner workspace (§67's mobile guidance) — no responsive-pattern work done on owner pages this phase.

Explicitly NOT done in Phase 3 (still open, in rough priority order for a later pass):
- A separate BRAND tab, a MEMBERSHIPS tab, a PT COLLABORATIONS tab, and a proper FINANCIAL OVERVIEW tab on the partner detail page (still 7 of the spec's 11 tabs — brand info stays folded into OVERVIEW, and there's no per-partner membership/collaboration/financial rollup view yet). `collaborationService.listFor({ ownerId })` already exists and could back the PT COLLABORATIONS tab without new backend work; memberships would need a new `membershipRepository.findByGyms(gymIds)` (a one-line addition, same shape as the existing `findActiveByGyms`).
- Replacing the existing Suspend/Terminate dialogs with the new shared `ImpactDialog` component — the existing ones already satisfy §49's functional requirements (two-column impact, required reason, safe-button-first), so this is a cosmetic consistency pass, not a functional gap.
- A standalone Membership Oversight admin page, Complaints case management, a Notifications page, and a global (not per-partner) Audit Logs view — all noted above as needing either §5's new model or net-new screens.

---

## 8. Design system / component library

> **Phase 2 status: done.** See below — everything in this section's original ❌ list now
> exists at `frontend/web/src/app/components/ui/` (generic) and
> `frontend/web/src/app/components/gym-management/` (domain-specific), verified via a
> temporary dev-only showcase route (`/dev/gym-management-kitchen-sink`, same unlinked/
> inert-unless-DEV convention as the pre-existing `/dev/icons`) screenshotted at 390px and
> 1440px. Full `npm run build` passes clean. Not yet consumed by any real page — that's
> Phase 3 (Admin redesign) and Phase 4 (Gym Owner redesign).

| Spec concept | Status |
|---|---|
| Reusable component set (PageHeader, StatCard, StatusBadge, EntityCard, DataTable, MobileEntityCard, FilterSheet, EmptyState, ErrorState, PageSkeleton, ConfirmDialog, ImpactDialog, Timeline, ActivityItem, DetailSection, FormSection, StickyActionBar, BranchSelector, OperationalStatusBadge, ModerationStatusBadge, RequestChangesPanel, InviteAccountSheet, AccountRow, RoleChip) | ✅ done |

**Key discovery during Phase 2**: this app's existing dark theme (`styles/theme.css`) already
uses almost exactly the spec's §54 palette (`#0a0a0a` background, `#22c55e` primary green) —
so no new token system was invented; every new component reuses the existing CSS custom
properties and Tailwind zinc/green/amber/red/blue scale, and gets the existing light-mode
retrofit "for free". A full shadcn/ui primitive set (Dialog, AlertDialog, Sheet, Drawer,
Table, Skeleton, Checkbox, Select, …) was also already installed and unused for this purpose
— every new component builds on top of those rather than reimplementing dialogs/sheets/
tables from scratch. `useIsMobile()` (768px, already existed) drives every
responsive/mobile-card decision.

A pre-existing gap was fixed along the way: `AdminGymModeration.tsx` and
`AdminPartnersPage.tsx` each hand-rolled their own `STATUS_LABEL` map, and the two
disagreed with each other (a SUSPENDED *branch* was gray, a SUSPENDED *partner* was amber).
The new `components/gym-management/statusConfig.ts` is the single source of truth for all
four status axes now (see GYM_PARTNER_STATUS_MAPPING.md) — Phase 3 should retrofit both
pages onto it rather than leave the old inline maps in place once it touches them.

---

## Documentation deliverables (§65) — status

- **Identity model doc** — done: [[gym-partner-identity-model]] (`GYM_PARTNER_IDENTITY_MODEL.md`), extracted/consolidated from `docs/quan-ly-doi-tac.md`.
- **Suspension consequence table** — done: [[gym-partner-suspension-consequences]] (`GYM_PARTNER_SUSPENSION_CONSEQUENCES.md`).
- **Status/state mapping doc** — done: [[gym-partner-status-mapping]] (`GYM_PARTNER_STATUS_MAPPING.md`), cross-product of `GymPartnerStatus × PartnerVerificationStatus × GymStatus × GymOperationalStatus`.
- **Responsive verification report** — still pending; produced during/after the UI work in Phases 3-4, not before it.
- **`GYM_MANAGEMENT_FRONTEND_PARITY.md`** — still pending; produced once the redesigned screens exist to compare against the current ones (§64 says "before completing implementation," not before starting it).

---

## Summary: what's genuinely new work vs what's reconciliation

**Reconciliation only (already built, just needs re-labeling/extraction into this spec's vocabulary):** identity model, invitation lifecycle, ownership transfer, revoke guards, view-as audit, branch material-change-stays-approved behavior, suspend/terminate impact mechanics, PT-collaboration effective-dated termination.

**Small additive backend gaps (low risk, no existing behavior changes):** `verificationStatus` + `assignedAdminId` on `GymPartner`; structured per-field "Request Changes" reasons on branch review; `PartnerInternalNote` model; Notification enum extension + wiring for partner events; branch reason/reopen-date columns if not already present (needs a 1-line confirmation check).

**Real net-new backend scope:** Complaints/violations case management (whole new model + workflow).

**Flagged for explicit confirmation before touching anything (business-rule / money-semantics change per the spec's own escalation rule):** membership plan access scope (SINGLE_BRANCH vs ALL_BRAND_BRANCHES) + purchase-time snapshot — this changes what a purchased membership entitles a holder to and touches check-in authorization.

**Pure frontend, no backend risk, largest raw volume:** the entire design system/component library, the admin dashboard/IA restructuring, the 11-tab partner detail page, the manager-role-aware nav filtering, and all responsive/mobile work (bottom sheets, impact dialogs, empty/loading/error states).
