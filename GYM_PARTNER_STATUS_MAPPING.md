# GYM_PARTNER_STATUS_MAPPING.md

GYM_MANAGEMENT master spec §65 deliverable ("Status/state mapping document"). Five
independent axes exist across a partner, its branches, and its complaints — never conflate
them, and never show a raw enum value in any UI (§56: "must be translated to a human
sentence").

## The five axes

| Axis | Enum | Owner | Meaning |
|---|---|---|---|
| Partner lifecycle | `GymPartnerStatus` | `GymPartner.status` | Where in the business relationship this partner is |
| Verification | `PartnerVerificationStatus` | `GymPartner.verificationStatus` | How far along document/identity vetting is — **added in GYM_MANAGEMENT Phase 1** |
| Branch moderation | `GymStatus` | `Gym.status` | Is this specific branch allowed to exist on the platform |
| Branch operations | `GymOperationalStatus` | `Gym.operationalStatus` | Is this specific branch physically open right now |
| Complaint handling | `ComplaintStatus` | `GymComplaint.status` | OPEN → IN_PROGRESS → RESOLVED, terminal at RESOLVED (no appeal) — **added in GYM_MANAGEMENT Phase 5**, independent of every other axis: a complaint about an APPROVED, fully ACTIVE partner's branch is completely normal |

Moderation and operational status were already orthogonal before this phase (a branch can be
APPROVED and TEMPORARILY_CLOSED at the same time — an admin decision and an owner decision,
independently). Verification is the newest axis, orthogonal to lifecycle for the same reason:
a partner can be reviewed, need more information, or be rejected entirely **before an OWNER
account exists at all** — lifecycle alone (PROSPECT/INVITED/ACTIVE/SUSPENDED/TERMINATED)
cannot express that.

## `GymPartnerStatus` × `PartnerVerificationStatus`

| Lifecycle | Typical verification value | Notes |
|---|---|---|
| PROSPECT | NOT_VERIFIED → IN_REVIEW → (NEEDS_INFO ⇄ IN_REVIEW)* → VERIFIED or REJECTED | The only stage where verification actually moves — this is the pre-account vetting window. |
| INVITED | VERIFIED | Gate: `provisionOwnerAccount` refuses unless verification is already VERIFIED (Phase 1). |
| ACTIVE | VERIFIED | Stays VERIFIED — nothing recomputes it after onboarding. |
| SUSPENDED | VERIFIED | Suspension is operational, not a verification regression — see [[gym-partner-suspension-consequences]]. |
| TERMINATED | VERIFIED or REJECTED (backfilled from history) | Terminal either way; verification is no longer actionable. |

`REJECTED` verification and a PROSPECT's `rejectedAt`/`rejectionReason` are kept in sync by
the same two calls (`partnerDiligenceService.reject`/`reopen`) — never set one without the
other. Every OTHER verification transition (`IN_REVIEW`, `NEEDS_INFO`, `VERIFIED`) goes
through `setVerificationStatus`, which explicitly refuses `REJECTED` to keep exactly one path
to that value.

**Backfill rule** (migration `20260908050000`): any partner already past PROSPECT before this
column existed is `VERIFIED` (they were vetted under the pre-Phase-1 process; retroactively
marking them unverified would lock out a real, active gym owner — the same class of bug
already hit once this session with the onboarding-completion gate, avoided here up front).

## `GymStatus` × `GymOperationalStatus`

| Moderation (`status`) | Operational (`operationalStatus`) | What the UI shows |
|---|---|---|
| PENDING_REVIEW | OPEN (default, meaningless until approved) | "Đang chờ Gymini xét duyệt" — not purchasable, not visible publicly |
| APPROVED | OPEN | Normal, fully live branch |
| APPROVED | TEMPORARILY_CLOSED | Live in admin/owner views, hidden from new purchases/check-ins; shows `closureReason` + `expectedReopenAt` if set |
| APPROVED | PERMANENTLY_CLOSED | Terminal for this branch; admin actionable item if active memberships remain (refund review) |
| REJECTED | (irrelevant) | Never shown publicly; owner sees the rejection reason |
| SUSPENDED | (irrelevant) | Admin-side penalty, independent of the owner's own open/closed switch |

A **material change** (rename or address change) never regresses `status` — an APPROVED
branch reviewing a pending rename stays APPROVED throughout; only `pendingName`/
`pendingAddress` (and, since Phase 1, `pendingNameNote`/`pendingAddressNote` +
`changesRequestedAt` when the admin asked for changes on a specific field) move. This is the
exact behavior verified by the master spec's own acceptance check (§62: "the branch never
left APPROVED during the pending period").

## Human-readable labels (§56 — never a raw enum)

| Raw value | Label shown |
|---|---|
| `PROSPECT` | "Tiềm năng" |
| `INVITED` | "Đã mời, chờ thiết lập" |
| `ACTIVE` | "Đang hoạt động" |
| `SUSPENDED` | "Đang tạm khoá" |
| `TERMINATED` | "Đã chấm dứt hợp tác" |
| `NOT_VERIFIED` | "Chưa thẩm định" |
| `IN_REVIEW` | "Đang xem xét" |
| `NEEDS_INFO` | "Cần bổ sung hồ sơ" |
| `VERIFIED` | "Đã thẩm định" |
| `REJECTED` (verification) | "Đã từ chối thẩm định" |
| `PENDING_REVIEW` (branch) | "Đang chờ duyệt" |
| `APPROVED` | "Đã duyệt" |
| `REJECTED` (branch) | "Đã từ chối" |
| `SUSPENDED` (branch) | "Đã tạm khoá" |
| `OPEN` | "Đang mở cửa" |
| `TEMPORARILY_CLOSED` | "Tạm đóng cửa" |
| `PERMANENTLY_CLOSED` | "Đã đóng cửa vĩnh viễn" |

Every status pill must pair icon + text + color (§56) — color alone is never sufficient.
