# GYM_PARTNER_IDENTITY_MODEL.md

Extracted/consolidated from `docs/quan-ly-doi-tac.md` for the GYM_MANAGEMENT master spec's
deliverable list (§65 "Identity model document — Partner vs Account, permission matrix,
invariants, and an explicit note that this is NOT a return of GYM_STAFF"). This is the
canonical reference; `docs/quan-ly-doi-tac.md` keeps the full phase-by-phase build history.

---

## 1. Partner vs Account — and why

**The problem before this model existed:** a gym owner *was* one `userId`. Consequences:
password became something handed off between branch managers by word of mouth; a manager
leaving meant a password change and everyone locked out together; the audit log could only
ever record one identity, never who actually acted.

**Current model:**

```
GymPartner  (the legal business — owns exactly one brand, one profile, one wallet)
   │
   ├── GymPartnerAccount  nguyen.minh@…   OWNER    ← exactly one, active
   ├── GymPartnerAccount  tran.hoa@…      MANAGER  ← Branch Q1
   └── GymPartnerAccount  le.nam@…        MANAGER  ← Branch Q7
```

A sole proprietor is a partner with exactly one account. A chain is the same partner with
more accounts. **Same model, different account count.**

## 2. ⛔ This is NOT `GYM_STAFF` coming back

The `GYM_STAFF` role was removed from the system and **must not be reintroduced**. What's
different:

| | `GYM_STAFF` (removed) | Current model |
|---|---|---|
| Role at auth-service | its own enum value | still `GYM_OWNER` for every partner account |
| Router | its own router | shares `/owner/*` |
| Screens | its own screens | shared, permission-gated show/hide |
| Where authorization lives | the auth layer | gym-service resolves it itself |

`PartnerAccountRole` (`OWNER` / `MANAGER`) is a permission **inside one partner**, not a
system-wide role. auth-service has no concept of it at all.

## 3. The mechanism: `principalUserId`

Every existing table (`Gym.ownerId`, `GymBrand.ownerId`) is keyed to the **owner's** userId.
Rather than rewrite every ownership query, there's a translation layer:

```
caller (userId)  ──resolvePartnerContext──>  { partnerId, role, scopedGymIds, principalUserId }
                                                                                    │
                                    every existing service (getOwnedGym, …) uses this value
```

- Owner: `principalUserId === their own userId`
- Manager: `principalUserId === their partner's owner's userId`

This lets `gymService.getOwnedGym` and every pre-existing ownership check run **unmodified**
— a manager acts under the owner's record, with two separate guards enforcing the actual
permission boundary.

> ⚠️ **Consequence for ownership transfer:** because `Gym.ownerId` is denormalized data
> pointing at the *current* owner, transferring ownership is not just flipping a `role`
> column between two accounts — it must also rewrite `Gym.ownerId` and `GymBrand.ownerId` to
> the new userId **in the same transaction**. Skipping this leaves the new owner logging into
> an empty dashboard. `partnerService.assertOwnershipConsistent(partnerId)` exists to detect
> drift if this ever happens.

## 4. Invariants and where they're enforced

DB-level constraints, not just service-layer checks (proven by direct SQL insert/update
attempts against them):

- **At most one ACTIVE owner per partner** — partial unique index.
- **A MANAGER account must have ≥1 scoped branch** — CHECK constraint (blocks UPDATE too,
  not just INSERT).
- **One userId belongs to at most one partner** — unique index on `GymPartnerAccount.userId`.
- **One partner owns at most one brand** — unique index on `GymPartner.brandId`.
- **A legacy account (no partner record) behaves exactly as before** — `isLegacy` fallback in
  `resolveContextForUser`, unrestricted, for pre-Phase-1 data or directly-seeded rows.

## 5. Permission matrix (OWNER / MANAGER)

One-sentence boundary: **money and people are OWNER-only.**

| Function | OWNER | MANAGER | Enforced by |
|---|---|---|---|
| View wallet, request withdrawal | ✅ | ❌ | `requirePartnerOwner` |
| Invite / revoke accounts | ✅ | ❌ | `requirePartnerOwner` (`ownerPartnerController`) |
| Negotiate PT collaboration, invite PT | ✅ | ❌ | `requirePartnerOwner` |
| Edit brand info | ✅ | ❌ | `requirePartnerOwner` |
| Create / edit branch | ✅ | ❌ | `requirePartnerOwner` |
| **Edit** membership plans | ✅ | ❌ | `requirePartnerOwner` — see note below |
| **View** membership plans | ✅ | ✅ | no guard |
| View members, check-ins | ✅ | ✅ (scoped branches) | `requireGymScope` |
| Change a branch's operational status | ✅ | ✅ (scoped branches) | `requireGymScope` |
| List branches | ✅ (all) | ✅ (scoped only) | filtered in `gymController.listOwned` |
| Reply to reviews | — | — | 🚧 this feature does not exist in the system at all |

> ⚠️ **Deliberate departure from an earlier draft** that had managers editing plans within
> their scoped branch. Not implementable that way: membership plans are already a
> **brand-level** asset (one plan sold across the whole chain, cross-branch check-in depends
> on it), so "scoped to one branch" has no meaning here. Decided: **only the owner edits
> plans** (a plan is a price — it touches money), managers can still read them to advise
> customers.

Do not build a finer-grained matrix than these two tiers — one brand, a few branches; more
granularity creates support burden nobody uses.

## 6. Partner lifecycle

```
PROSPECT ──account provisioned──> INVITED ──invite accepted──> ACTIVE
    │                                                              │
    └──rejected (still PROSPECT,                                  ↓
       rejectedAt/reason;                                    SUSPENDED <──> ACTIVE
       reopen() clears both)                                       ↓
                                                               TERMINATED
```

- `PROSPECT → INVITED`: `partnerService.provisionOwnerAccount` — as of the GYM_MANAGEMENT
  master spec Phase 1, this now requires `verificationStatus === 'VERIFIED'` first (see
  [[gym-partner-status-mapping]] for how the two axes relate).
- `INVITED → ACTIVE`: automatic when the OWNER account accepts its invitation
  (`partnerInvitationService.acceptInvitation`) — no separate admin action.
- `ACTIVE ⇄ SUSPENDED`: `partnerService.suspend` / `unsuspend`.
- `* → TERMINATED`: `partnerService.terminate` — **one-way**, nothing moves a TERMINATED
  partner back to any other status.
- Rejecting a prospect (`partnerDiligenceService.reject`/`reopen`) is **not its own status**
  — deliberately kept to exactly the 5 enum values the original spec named; a rejected
  PROSPECT differs from a fresh one only by `rejectedAt`/`rejectionReason` (and, since Phase
  1 of the new master spec, by `verificationStatus`, kept in sync with the same two calls).

See [[gym-partner-status-mapping]] for the full cross-product with `verificationStatus`,
`GymStatus`, and `GymOperationalStatus`.

> **Cập nhật (Gym Partner self-service onboarding):** luồng admin "Cấp tài khoản"/link mời OWNER **không còn được dùng cho đối tác mới**; chủ gym tự đăng ký và admin duyệt hồ sơ (xem `GYM_PARTNER_SELF_ONBOARDING_SPEC.md`, `GYM_PARTNER_STATE_MACHINE.md`). `provisionOwnerAccount` chỉ còn phục vụ hồ sơ cũ (ADMIN_CREATED); hạ tầng mời MANAGER giữ nguyên.