# GYM_BRANCH_FORM_API_GAPS.md

GYMINI master spec §1 deliverable. Investigated before writing any wizard code (§94 steps
1-6). Current `Gym` model (gym-service) has: `name`/`approvedName`/`pendingName`,
`description`, `address`/`approvedAddress`/`pendingAddress`, `city`, `provinceCode`,
`wardCode`, `latitude`, `longitude`, `phone`, `email`, `status` (moderation),
`operationalStatus`, `closureReason`, `expectedReopenAt`, `pendingNameNote`/
`pendingAddressNote`/`changesRequestedAt`/`changesRequestedBy` (per-field request-changes,
built this session). **No opening hours, no facilities/amenities, no photo gallery, no
branch-level verification documents, and no draft/partial-save concept exist anywhere in the
schema today.** The current `MyGymsPage.tsx` "Add Branch" dialog is a single small modal
covering only name/description/address/province/ward/phone/email/city — everything below
that the wizard needs (§7 onward) is genuinely new.

| # | Feature | Required data | Expected behavior | Existing support | Suggested backend requirement | Actor | Priority |
|---|---|---|---|---|---|---|---|
| 1 | Draft branch / partial save | A `Gym` row that can exist with only a name (or even less) filled in, not yet subject to full `gymCreateSchema` validation | Owner can leave the wizard at any step and come back later to the exact same state | ❌ none — `POST /owner/gyms` runs full validation immediately and the row is born `PENDING_REVIEW`-eligible | New `GymStatus.DRAFT` (or an `isDraft` boolean) preceding `PENDING_REVIEW`; relax `gymCreateSchema` to accept a draft with only `name`, defer full validation to the submit action | OWNER | High — blocks Phase 1 entirely |
| 2 | Wizard progress / completion % | Which of the 7 steps are actually complete, not just visited | "62% complete" shown on the branch list for a draft; wizard resumes at the right step | ❌ none | Either compute completion client-side from populated fields (no backend change needed) or persist `lastCompletedStep` on the draft row for a server-trusted resume point | OWNER | High — Phase 1 |
| 3 | Opening hours | Per-weekday state (OPEN/CLOSED/24H) + time ranges; §20 says only support split (multi-interval) hours if backend already does — it doesn't | Weekly schedule editor, validated (open<close, no overlaps, ≥1 day open) | ❌ none | New `GymOperatingHours` (or a JSON column) — one row per weekday, single interval only for v1 per §20's own instruction not to fake split hours | OWNER (write), public (read) | High — Phase 2 |
| 4 | Facilities & services | A fixed catalog (Free Weight, Cardio, Locker, Sauna, PT, InBody, …) the owner multi-selects from | Chip/card grid, grouped by category | ❌ none | New `GymFacility` enum + `Gym.facilities: GymFacility[]` (Postgres array, same pattern as `scopedGymIds`) — no need for a separate join table at this scale | OWNER (write), public (read) | Medium — Phase 3 |
| 5 | Photo gallery + cover photo | Multiple images per branch, one marked cover, reorderable, deletable, optionally categorized | Upload/preview/reorder/delete/set-cover, compressed previews | ❌ none — no gym-photo upload pipeline exists (the complaint-photo pipeline built this session is deliberately private/single-purpose, not reusable here — branch photos are PUBLIC) | New `GymPhoto` model (gymId, url, sortOrder, isCover, category) + a **public** multer/storage pipeline (unlike the complaint one — no auth-gated serving needed, these are meant to be public) | OWNER (write), public (read) | Medium — Phase 3 |
| 6 | Branch-level verification documents | Lease/property document, fire-safety certificate, facility photos — explicitly NOT the partner-level business registration/tax/rep-identity documents already collected once | Upload state (Uploaded/Pending Review/Accepted/Needs Update), private (owner + admin only) | ❌ none — `GymPartnerDocument` exists but is partner-scoped, not per-branch | New `GymBranchDocument` model (gymId, docType, fileUrl, status) — private serving, can reuse the auth-gated-serving pattern already built for complaint photos (different storage bucket) | OWNER (write), ADMIN (review) | Medium — Phase 3 |
| 7 | Structured, per-category "Request Changes" | Admin flags issues by category (Basic Information/Location/Opening Hours/Facilities/Photos/Verification/Other), each with its own message | Owner sees a list of exactly those items, each linking to the relevant wizard step | ⚠️ partial — Phase 1 of the earlier GYM_MANAGEMENT work built this, but only for 2 fields (name/address), not all 7 categories | Extend `Gym`'s request-changes columns (or a small `GymBranchReviewIssue` table: gymId, category, message, resolvedAt) to cover every category, not just name/address | ADMIN (write), OWNER (read/resolve) | High — Phase 4 |
| 8 | First-branch pending-brand-name display in admin review | The admin reviewing a partner's first branch must see the brand's `pendingName` and an explicit note that approving the branch also approves that name | ⚠️ partial — the data (`brand.pendingName`) is already fetched, just not specially surfaced or explained in the pending-review card | `GET /admin/gyms?status=PENDING_REVIEW` already returns `brand`; this is a frontend-only gap | Frontend only | ADMIN | Medium — Phase 6 |
| 9 | Owner-facing permanent-closure impact summary | Active members / membership plans / PT collaborations counts, shown to the OWNER before they confirm permanent closure (§50) | The admin side already has an equivalent (`terminationImpact`-style aggregation, Phase 5 of the earlier work) — nothing analogous is exposed to the owner themselves | ❌ none on the owner-facing route | New `GET /owner/gyms/:id/closure-impact` (or reuse the admin aggregation logic, gated to `requireGymScope` instead of `requireRoles('ADMIN')`) | OWNER | Medium — Phase 5 |
| 10 | Manual remediation request after >7-day temporary closure | §49: owner may request admin review for customer remediation once a temporary closure exceeds 7 days — explicitly NOT automatic | Owner sees an action appear once the closure has run ≥7 days; raises a flagged item for admin, does not itself change any membership end dates | ❌ none | New lightweight action, e.g. reuse the `GymComplaint`-style "raise a case" pattern built in Phase 5 of the earlier work, or a dedicated small table — needs a product decision on whether to literally reuse Complaints or add a distinct concept | OWNER (raise), ADMIN (handle) | Low — Phase 5, no urgency (this is an edge case, not core to shipping the wizard) |
| 11 | Owner-side "Change Brand" / detach-from-brand capability | — | Should not exist per §51/§79/§89 | ⚠️ **currently exists and works** — `GymManagePage.tsx`'s brand `<select>` + `gymUpdateSchema`'s `brandId` field. See `GYM_BRANCH_FORM_SPEC.md`'s "Known Conflict" section — flagged for a decision, not yet removed. | Remove `brandId` from the owner-facing `gymUpdateSchema` and the corresponding UI; leave any already-standalone/reassigned rows in the database untouched | OWNER (removing an existing capability) | High — should land before or alongside Phase 1, since it's the clearest direct contradiction of the spec's core invariant |
| 12 | Map pin confirmation UX (§15) | Type address → map resolves a pin → owner can drag to adjust | ⚠️ partial — the owner can only capture their OWN current GPS position via a "Dùng vị trí hiện tại" button (built earlier this session, deliberately avoiding a paid geocoding API); there is no forward-geocoding (address → coordinates) and no draggable-pin map UI | No geocoding provider is wired up (cost/complexity was explicitly declined earlier this session). §16 already anticipates this: "If automatic address verification fails, do NOT claim the address is verified" — show the "Gymini will verify manually" message instead of building geocoding now, unless the user wants to revisit that earlier decision | OWNER | Low — cosmetic degradation already has an explicit spec-sanctioned fallback |

## Summary

Phase 1 (wizard shell) needs only #1 and #2 from backend, both small additive changes. Phases
2-3 need four genuinely new data domains (#3-#6) — the single biggest chunk of net-new
backend work in this entire wizard project. Phase 4 needs #7 (a real extension, not a new
domain). Phase 5 needs #9-#10 (small, low-urgency). Phase 6 needs #8 (frontend-only). #11 is
a cleanup that should happen independent of any phase, as early as possible, and #12 is
accepted as a known, spec-sanctioned limitation rather than a gap to close.

## Resolved

- **#1, #2** (draft/partial-save, wizard progress) — done in Phase 1: `GymStatus.DRAFT`,
  `Gym.wizardStep` (monotonic high-water mark), `POST /owner/gyms/draft`,
  `PATCH /owner/gyms/:id/draft`, `POST /owner/gyms/:id/submit`.
- **#3** (opening hours) — done in Phase 2: `GymOperatingHours` model, `GET|PUT
  /owner/gyms/:id/hours`, wired into `submitForReview`'s validation (§21 — ≥1 open day
  required only at submit time, not on every save).
- **#11** (owner-side Change Brand) — removed in Phase 1, ahead of the rest of the wizard as
  recommended above. See `GYM_BRANCH_FORM_SPEC.md`'s "Known Conflict" section, now marked
  RESOLVED.
- **#4** (facilities & services) — done in Phase 3: `GymFacility` enum, `Gym.facilities`
  array, free edit.
- **#5** (photo gallery + cover photo) — done in Phase 3: `GymPhoto` model, a genuinely
  PUBLIC upload/serve pipeline (`express.static`, no auth) distinct from every other
  upload pipeline in this service. Not yet done: surfacing `photos` on the PUBLIC gym
  detail/listing endpoints for the client-side search page to actually display — the
  owner-side wizard CRUD is complete, but nothing outside `/owner/gyms/:id/photos` reads
  this table yet. Small, additive, not blocking any remaining phase.
- **#6** (branch-level verification documents) — done in Phase 3: `GymBranchDocument`
  model, a PRIVATE upload/serve pipeline mirroring complaint-photos, plus the partner-level
  read-only context list (§95.4).
- **#7** (structured, per-category request-changes) — done in Phase 4: `GymBranchReviewIssue`
  model (7 categories), admin action sends the branch back to DRAFT (not just PENDING_REVIEW
  with a flag — see `GYM_BRANCH_FORM_SPEC.md`'s Phase 4 notes for why), owner sees a fix-loop
  banner + per-category jump-to-step links, resolution is implicit on a successful resubmit.
  Coexists with (does not replace) the pre-existing name/address-only mechanism, which now
  also gained a "Request Changes" trigger in the admin UI's "gym-renames" tab — it never had
  one before this phase.

- **#9** (owner-facing permanent-closure impact summary) — done in Phase 5:
  `GET /owner/gyms/:id/closure-impact`, shown inline the moment the owner opens the
  "Đóng cửa vĩnh viễn" flow.

- **#8** (first-branch pending-brand-name display in admin review) — done in Phase 6:
  `BranchReviewDetail.tsx`'s card-header hint + full detail-panel callout, driven by
  `gym.brand.approvedName == null`. Live-verified against a genuinely fresh, never-approved
  brand created directly in the DB for the check (every real seed/test brand in this session
  had already been approved in an earlier round).

Every gap this document originally tracked is now either resolved or explicitly deferred:
**#10** (Phase 5 scope, but deferred — needs a product decision on the underlying data model
that was never made, and was already flagged lowest-priority/no-urgency here) and **#12**
(accepted limitation, not a gap being tracked for closure). The small gap noted under #5
(public photos not yet surfaced on the PUBLIC gym search/detail read endpoints — only the
owner/admin-facing endpoints exist) remains open but was never blocking any phase of this
spec; it's a client-search-page feature outside the wizard/admin-review scope this document
was written to track.
