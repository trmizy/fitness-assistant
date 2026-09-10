# GYM_BRANCH_FORM_SPEC.md

GYMINI master spec §90 deliverable — "Create Gym Branch" premium onboarding wizard.
Written after inspecting the current repository (§94 steps 1-6), before any wizard code.

## Core invariants (§0, §95.1, §95.2 — these override anything implied elsewhere)

```
ONE_GYM_OWNER_ONE_BRAND = TRUE
ONE_BRAND_MANY_BRANCHES = TRUE
STANDALONE_BRANCH_SUPPORTED = FALSE          (for branches created through this new wizard)
BRANCH_BRAND_REASSIGNMENT_SUPPORTED = FALSE
MULTIPLE_BRANDS_PER_OWNER_SUPPORTED = FALSE
ADDRESS_TIER = PROVINCE_WARD                  (§95.1 — Vietnam abolished the district level
                                                2025-07-01; NEVER add a district field back)
BRANCH_CREATE_EDIT_ACTOR = OWNER_ONLY         (§95.2 — a MANAGER must not see "Add Branch",
                                                Brand Profile, or Brand rename at all — hidden,
                                                not disabled-and-erroring)
```

This matches exactly the identity model already built this session
(`GYM_PARTNER_IDENTITY_MODEL.md`): `GymPartner.brandId` is unique — one partner record can
never have more than one brand — so "one owner, one brand" is already a DB-level invariant
for every partner-model account. What's NEW in this spec is applying that same invariant
*inside the branch-creation/editing UI itself*, which today does not enforce it (see the
Known Conflict below).

## ⚠️ Known conflict with existing behavior — found during investigation, RESOLVED

`GymManagePage.tsx`'s "Thương hiệu" settings section currently renders a live `<select>`
(`data-testid="gym-brand-select"`) that lets an owner detach a branch from its brand
(`brandId: null`) or reassign it to any brand they own, backed by a real, working
`PATCH /owner/gyms/:id` with `brandId` in the payload (`gymUpdateSchema` accepts it).
`MyGymsPage.tsx` also has a whole rendering path for `standaloneGyms` (branches with no
brand) as a supported, working case.

This is exactly what §51/§79/§89 say must not exist ("no Change Brand button", "Standalone
Branches are NOT supported", "no arbitrary brandId field"). It predates the partner-identity
work (Vòng 4 / Phase C4, before `GymPartner` existed) and was never revisited when the
one-partner-one-brand invariant was added at the data layer. For a modern partner-model
owner it's already almost inert in practice (their `ownedBrands` list has at most one entry,
so the dropdown only really offers "detach"), but it is not zero — the "detach" option still
works and still produces a standalone branch today.

**Decision** (raised to the user rather than resolved unilaterally, per this session's
established practice for anything touching access/data-model invariants — user confirmed
"Gỡ bỏ ngay"): the brand-select UI (`GymManagePage.tsx`) and the `brandId` field in
`gymUpdateSchema`/`gymService.updateOwnedGym` (owner-facing) were removed entirely, so this
class of branch can no longer be created going forward. Existing standalone/legacy-reassigned
rows already in the database were left untouched (no destructive migration).

## First-branch special case (§95.3)

For a brand-new partner, `GymBrand.approvedName` is `null` and `GymBrand.pendingName` holds
what the owner typed — the brand name is not public yet (already-built behavior, see
`GYM_PARTNER_IDENTITY_MODEL.md` / `gymService.setStatus`'s doc comment: approving a partner's
first branch also promotes the brand's first approval). The admin review screen must show
the pending brand name and state explicitly that approving the branch also approves that
public-facing brand name — currently the pending review card shows only `g.brand.name` (the
raw working value) with no distinction and no such explicit statement. This is a Phase 6 item.

## Branch verification ≠ partner verification (§95.4)

Business registration, tax code, and representative identity are already collected exactly
once, at partner vetting, before the account is provisioned (`GymPartnerDocument`,
Phase 1/4 of `docs/quan-ly-doi-tac.md`). The wizard's Step 6 (Verification) must NOT ask for
any of that again. It covers only location-specific documents for the branch being created:

- lease or property document for this address
- fire-safety certificate, if applicable
- facility photos

The wizard must pre-fill/display the partner-level documents (already on file) as read-only
context, so the owner can see they don't need to resubmit them. No such per-branch document
concept exists in the schema today — see `GYM_BRANCH_FORM_API_GAPS.md`.

## Implementation phases (§95.5 — literal, not reordered)

| Phase | Scope | Status |
|---|---|---|
| 1 | Wizard shell: 7-step navigation, draft/auto-save, resume, progress calculation | ✅ Done, live-verified |
| 2 | Steps 1–3: basic info, location (province/ward only), opening hours | ✅ Done, live-verified |
| 3 | Steps 4–6: facilities, photos, verification (branch-level only) | ✅ Done, live-verified |
| 4 | Step 7 + submission + PENDING_REVIEW + request-changes fix loop | ✅ Done, live-verified |
| 5 | Post-approval branch workspace, operational status, material changes | ✅ Done, live-verified |
| 6 | Admin review workspace (incl. the first-branch pending-brand-name display above) | ✅ Done, live-verified |

Stop and report after each phase — do not run straight through.

### Phase 2 notes

- Backend: `GymOperatingHours` model (`WeekDay`/`DayScheduleType` enums), `gym-hours.repository`/
  `.service`/`.controller`, `GET|PUT /owner/gyms/:id/hours` (free edit whether DRAFT or already
  APPROVED, §74 — not scoped under `/draft`). `Gym.locationNote` (free-text directions, also
  §74 free-edit) added to `gymCreateSchema`/`gymUpdateSchema`. `gymDraftService.submitForReview`
  now also calls `gymHoursService.assertReadyForSubmit` (≥1 day OPEN/ALL_DAY), accumulated into
  the same `issues` array as the zod schema failures.
- Frontend: `StepBasicInfo` (brand context card, name/description/phone/email, live card
  preview, §13), `StepLocation` (reuses `GymLocationFields`, plus `locationNote`, honest
  non-map coordinate-confirmation line per the no-geocoding decision), `StepOpeningHours`
  (per-day OPEN/CLOSED/ALL_DAY + time inputs, "apply Monday to weekdays/all days" quick
  actions). Per-step inline "Continue" validation (§59) wired into `AddBranchWizardPage.tsx`.
- Found and fixed during this phase's own live verification: the debounced-save mutation's
  `onSuccess` was missing a `queryClient.invalidateQueries` for the draft's own query key —
  the exact same monotonic-wizardStep staleness bug fixed on the backend in Phase 1, this
  time on the frontend's cache. Fixed before shipping, not left for Phase 3 to rediscover.

### Phase 4 notes

- **Two separate "Request Changes" mechanisms now coexist by design, not by accident**:
  `Gym.pendingNameNote`/`pendingAddressNote` (Vòng 4 / Phase C2 — name/address only, for an
  ALREADY-APPROVED branch's later rename; never touches `status`) and the new
  `GymBranchReviewIssue` model (7 categories, only valid while PENDING_REVIEW, transitions
  the branch back to DRAFT). They serve genuinely different moments in a branch's lifecycle
  — see `GymBranchReviewIssue`'s own schema doc comment. The admin UI reflects this: the
  "pending" (first-time review) tab now uses the new category panel exclusively; the
  "gym-renames" tab (later renames) kept the old name/address panel, WITH a "Yêu cầu chỉnh
  sửa" trigger added there too — it never had one before this phase (only a blunt Approve),
  an incompleteness noticed and fixed in passing rather than left as found.
- **Sending the branch back to DRAFT (not just flagging issues while staying PENDING_REVIEW)
  was a deliberate, load-bearing choice**: `GymManagePage.tsx` has no editors yet for opening
  hours/facilities/photos/verification (that's Phase 5's post-approval workspace) — the
  wizard is the ONLY place today that can fix any of those 4 categories, so reusing it via a
  DRAFT transition was the only way to make the fix loop actually usable across all 7 steps
  right now, not just the 2 fields (name/address) the old mechanism ever covered.
  `wizardStep` is set to 7 (not reset to 1) on this transition — every step was already
  reached once by definition (the owner already submitted), so nothing should re-lock.
- **Resolution is implicit and all-at-once**: a successful resubmit closes every open issue
  for that gym in one write (`gymBranchReviewRepository.resolveAllOpen`), rather than trying
  to auto-detect "was THIS SPECIFIC category's issue actually addressed" per field edit. Simpler, and matches the real interaction shape (fix several things across several steps, submit once) better than a more granular design would have.
- Submission validation also extended (§95.4): `gymDraftService.submitForReview` now checks
  the 2 required `GymBranchDocument` types (LEASE_OR_PROPERTY_DOC, FACILITY_PHOTOS) have a
  `fileToken`, accumulated into the same `issues` array as the zod/hours checks — a missing
  required document blocks submission exactly like a missing name or address does.
- New cross-service notification (`GYM_BRANCH_CHANGES_REQUESTED` / `GYM_BRANCH`, mirroring
  Phase 5's `GYM_COMPLAINT_RESOLVED` pattern exactly) tells the owner their branch was sent
  back, with a summary of every flagged category inline.
- Frontend: Step 7 (`StepReviewSubmit`) summarizes all 6 prior steps (fetching its own
  photos/branch-documents counts, same self-contained pattern as Steps 5-6) and owns the
  actual "Gửi duyệt" submit action — the wizard's generic nav "Continue" button is hidden on
  Step 7 specifically to avoid a confusing second, redundant action there. A fix-loop banner
  surfaces on every step (not just 7) once `GET /owner/gyms/:id/review-issues` returns
  anything open, so the owner isn't confused why they got sent back to DRAFT before they
  even reach the review step.
- Known minor side effect of the test suite (not a product bug): `gym-branch-review.
  integration.test.ts`'s fixtures use `randomUUID()` as `ownerId` for isolation, and
  `requestChanges` unconditionally notifies that owner — each test run leaves a handful of
  `GYM_BRANCH_CHANGES_REQUESTED` notification rows in user-service pointing at fake
  usersIds/deleted gyms. Harmless (silently ignored by anything that reads notifications,
  since the userId never logs in), safe to periodically clean up, not worth adding
  test-only notification-suppression machinery for.

### Phase 5 notes

- **The post-approval branch workspace is literally the same 4 step components the wizard
  already uses** (`StepOpeningHours`/`StepFacilities`/`StepPhotos`/`StepVerification`),
  embedded directly into `GymManagePage.tsx`'s existing settings panel behind 4 new
  collapsible sections, rather than a parallel set of "post-approval" editors. This was
  possible with zero new backend work because none of those 4 domains' endpoints were ever
  gated to DRAFT-only in the first place (only the wizard's OWN draft endpoints
  — `updateDraft`/`submitForReview` — are; `setHours`/`updateOwnedGym`'s facilities patch/
  the photo CRUD/`attachFile` all only ever checked ownership, never status). §74's "free
  edit regardless of approval status" was true by construction well before this phase;
  Phase 5's actual work was building the FIRST caller of these endpoints outside the wizard.
- `locationNote` also gained a field in the "Vị trí" settings section — it existed on the
  backend and in the wizard's Step 2 since Phase 2, but had no post-approval UI until now.
- New owner-facing permanent-closure impact summary (§9 of `GYM_BRANCH_FORM_API_GAPS.md`):
  `gymService.closureImpact` is a scoped-down mirror of `partnerService.terminationImpact`
  (same "don't let the actor click something irreversible blind" reasoning, same
  best-effort-cross-service-call discipline) — one gym's active memberships + unused value
  estimate + active PT collaborations + wallet balance, shown inline the moment the owner
  opens the "Đóng cửa vĩnh viễn" flow, before they've typed a reason or confirmed anything.
- **Explicitly deferred, not built**: §10 (owner-initiated remediation request after a
  temporary closure exceeds 7 days). The gap analysis itself flagged this as needing a
  product decision (reuse the Complaints pattern vs. a dedicated small table) and marked it
  lowest priority / "no urgency, edge case" — building it without that decision would mean
  guessing at a data model for a feature nobody has asked to use yet. Left for a future
  round if the user wants it.
- Live-verified against a gym pushed through DRAFT → PENDING_REVIEW → APPROVED via a mix of
  curl (fast, reliable setup — the dev environment's Vite server was under genuine, if
  transient, CPU load during this phase's verification, making UI-driven setup slow) and a
  short, targeted Playwright script for the actual new UI: all 4 post-approval sections
  showed the SAME data the wizard had written, edits persisted across a reload, and the
  closure-impact summary rendered correctly with real (zero, for a fresh test gym) numbers.

### Phase 6 notes — final phase of this spec

- **3 new admin-only read endpoints** (`GET /admin/gyms/:id/hours|photos|branch-documents`)
  were the only new backend surface needed — facilities already rides along on the plain
  `Gym` row `GET /admin/gyms` already returns. Each is a thin wrapper: `gymHoursService.
  getHours` was already ownerId-agnostic (needed no new function at all), `gymPhotoService.
  listForAdmin`/`gymBranchDocumentService.listForAdmin` are one-line variants of their owner
  counterparts with the ownership check removed and (for branch-documents) the target
  owner's id looked up from the gym row instead of the caller's own identity — needed only
  to resolve which partner's §95.4 context belongs alongside the branch-level documents.
- `BranchReviewDetail.tsx` is the actual "admin review workspace" — a full read-only summary
  of everything the 7-step wizard collected (basic info, location, hours, facilities,
  photos, verification documents with previews via the SAME auth-gated serve route +
  defense-in-depth pattern from Phase 3, plus the read-only partner-level context), wired
  into a "Xem chi tiết" toggle on the existing pending-review card — a genuine gap: before
  this phase, admin could click "Duyệt" having seen only a bare name/address/brand-name
  card, never the photos or verification documents the whole wizard exists to collect.
- **§95.3 implemented as designed**: `isFirstBranchOfBrand = gym.brand.approvedName == null`
  drives both a compact hint in the card header (visible without expanding) and a full
  callout at the top of the detail panel, naming the pending brand and stating explicitly
  that approving the branch approves the name too. Live-verified against a genuinely
  fresh, never-approved brand (jane.smith's own seed brand was approved many sessions ago,
  so a new partner/brand/gym row had to be created directly in the DB to actually exercise
  the `approvedName == null` branch) — both the card hint and the detail callout confirmed
  showing correctly, and jane.smith's own real branch correctly did NOT show it.

## GYM_BRANCH_FORM_SPEC.md — all 6 phases complete

Every phase in §95.5's plan is now done and live-verified: wizard shell, all 7 real step
contents, submission + the by-category request-changes fix loop, the post-approval
workspace, and the admin review workspace. `GYM_BRANCH_FORM_PARITY.md` (§90's third
deliverable) is the one remaining task — written once the primary "New Gym" button is
actually switched over to this wizard (still deferred, per `AddBranchWizardPage.tsx`'s own
doc comment — reachable today only via "🧪 Thử wizard mới" and the "Đang thiết lập" resume
cards). All work across this entire spec remains uncommitted, per this session's standing
discipline of never committing without the user's explicit go-ahead.

### Phase 3 notes

- Backend, three independent new domains: `GymFacility` enum + `Gym.facilities` array (free
  edit, no material-change gating — same discipline as `locationNote`); `GymPhoto` model +
  a genuinely PUBLIC upload/serve pipeline (`express.static` mount at
  `/uploads/gym-photos`, no auth-gated route at all — the first public upload pipeline in
  gym-service, distinct from the private complaint-photos/branch-documents pipelines);
  `GymBranchDocument` model (§95.4 — branch-level only: lease/property doc, fire-safety
  cert, facility photos) with a PRIVATE upload/serve pipeline mirroring complaint-photos
  exactly (own-upload-prefix OR admin+attached defense-in-depth), reusing
  `PartnerDocumentStatus` rather than a duplicate enum, and surfacing the owner's real
  partner-level documents as read-only `partnerContext` (via
  `partnerDiligenceService.listDocuments`, for its "always all 6 rows" padding) alongside
  the 3 branch-level rows.
- Gateway gotcha hit twice more this phase: `/owner/branch-documents/:token` and
  `/admin/branch-documents/:token` are sibling paths outside the existing blanket
  `/owner/gyms`/`/admin/complaint-photos`-style proxies and needed their own explicit
  `router.use(...)` declarations — same class of bug as the `/owner/brands` gotcha
  documented in this file already. A brand-new top-level public path,
  `/uploads/gym-photos`, needed the same treatment PLUS its own dev (`vite.config.ts`) and
  prod (`nginx.prod.conf`) proxy rules, since no prior feature in this frontend had ever
  served a public upload before.
- Dev-environment gotcha (not a code bug, but cost real debugging time twice): this
  Windows/Docker setup's `tsx watch` and Vite dev servers do not reliably pick up
  new-route-registration file changes via their own file-watcher — every new backend route
  file added this session needed an explicit `docker restart` of `gymcoach-gym-dev` (and,
  separately, `gymcoach-gateway-dev` after any `proxy.routes.ts` edit) before it would
  actually respond, despite the file on disk already being correct. Established as a
  standing operational note for the rest of this project, not something to keep
  re-diagnosing.
- Frontend: `StepFacilities` (fixed catalog, grouped chip multi-select, no min-count
  gate — free edit, not required to continue); `StepPhotos` and `StepVerification` are
  self-contained (own their own query/mutations against `gymId`) rather than the
  single-debounced-value shape Steps 1/2/4 use, since a photo grid or a per-document-type
  upload doesn't fit that shape. Neither gates "Continue" — submit-time completeness
  checking across all 7 steps (using each `GymBranchDocument.required` flag, `GymPhoto`
  count, etc.) is left to Phase 4's real Step 7 checklist, not invented early here.

## Access-scope snapshot (§95.6)

Membership plan `SINGLE_BRANCH`/`ALL_BRAND_BRANCHES` access scope was explicitly proposed
earlier this session (GYM_MANAGEMENT master spec §54) and the user deferred it
("Chưa làm — để sau", recorded in `GYM_MANAGEMENT_API_GAPS.md` §4) precisely because it
changes purchase-time payment semantics. §95.6 reframes *why* a snapshot would matter (not
brand-transfer protection — §51 already forbids that independently — but protecting
memberships already sold if a plan's scope is edited later) without reversing that deferral.
**Not built in this round** — still deferred, now for the reason given here rather than the
original one. If the user wants to revisit the underlying deferral decision itself, that is
a separate conversation from this wizard.
