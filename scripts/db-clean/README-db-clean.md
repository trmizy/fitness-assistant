# db-clean (Listing Management, Phase G / H)

Plan references: sections 9, 12.9, 12.13 items 6-8, 12.14 items 3/5/6, 12.15 items 1-2, 12.16, 8.1 (precedence 12.16 > 12.15 > 12.14 > 12.13 > earlier).

```
node scripts/db-clean/db-clean.mjs <command> --env dev|test [options]
```

| Command | What it does | Writes to a DB? |
|---|---|---|
| `audit` | Read only. Candidate accounts (always-list + E2E fixtures), per-table delete/keep counts, the approved-candidate manifest + `confirmToken`, report. | **No** (connections are `default_transaction_read_only=on`) |
| `audit --deny-file F` | Same audit plus a ROW-level deny list (see below). | No |
| `audit --recheck --manifest M --confirm-token T [--run-dir D]` | Re-derives everything from live data and compares element by element (12.15 item 2 steps 4-7). | No |
| `approve` | Copies the (manifest, token) pair Ngai approved into `<dir>/approved/` (read only). The destructive commands accept only that copy. | No |
| `freeze` (H0) | pg_hba fence + temporary superuser `gymini_maintenance` + stop app containers + kill sessions + verify with real connections (12.16). | pg_hba + role |
| `backup` (H1) | `pg_dump -Fc` of all seven DBs inside the one frozen window, `pg_restore --list`, trial restore into `*_restorecheck`. | scratch DB only |
| `clean --apply --manifest M --confirm-token T [--resume]` (H2) | One transaction per DB: chat, ai, fitness, payment, gym, user, auth. Stops at the first failure. | yes |
| `verify` (H3) | Row counts + fingerprints + kept-row hashes, still fenced. | No |
| `unfreeze` (H4) | Restore the approved pg_hba, check app role reconnects (TCP, 7 DBs), ACL/roles unchanged, drop the maintenance role, start containers, REAL HTTP login (dev), write `verify-clean.ok`. | pg_hba + role |
| `restore --run-dir D [--backup B]` | All seven DBs from ONE backup set (needs the fence). | yes |
| `recover --run-dir D` | The manual runbook below as a command. | pg_hba + role |
| `status` | Read only: last freeze step, which pg_hba is live (original/fence/other), maintenance role, per-DB state, foreign sessions. | No |

Environment: `DBCLEAN_MAINT_PASSWORD` (>= 24 chars; process environment only; never printed or written), `DBCLEAN_CONFIRM=dev` for any mutating command on dev,
`DBCLEAN_LOGIN_EMAIL` / `DBCLEAN_LOGIN_PASSWORD` for the real login check at H4 (dev). Dev: `localhost:5433` / container `gymcoach-postgres`, databases `gymcoach_{auth,user,fitness,ai,chat,payment,gym}`.
Test: `localhost:55433` / container `gymcoach-test-postgres-test-1`, databases `gymcoach_<svc>_dbclean*_test`.
Guards: refuses `NODE_ENV=production`, non-local hosts, database / container names containing prod, staging or live, names outside the allowlist, unknown options (there is no override flag).

Tests: `node --test --test-concurrency=1 scripts/db-clean/__tests__/db-clean.test.mjs` (test container only; creates and drops its own `*_dbclean_test` databases).

## Deny file (`audit --deny-file F`): E2E rows that sit under a preserved owner

The allowlist is by account, so E2E data owned by a kept account (an E2E gym of jane.smith, the E2E catalogue amenities, E2E packages) cannot be
selected by it. The deny file names such rows by LIKE pattern; **every pattern must start with `E2E` (case-sensitive), otherwise the audit refuses**:

```json
{ "gymNameLike": ["E2E%"], "amenityNameLike": ["E2E\_%"], "proposalNameLike": ["E2E\_%"], "packageNameLike": ["E2E%"] }
```

* The audit expands the patterns to explicit id lists and stores patterns + ids in the manifest (`deny`), so they are covered by the confirmToken. `audit --recheck`, H0 and H2 re-derive the ids from the patterns and must find exactly the same ones.
* **gyms**: a denied gym is deleted even when its owner is preserved; everything below it follows (`childOf('gyms')`). The owner, the brand and the owner's other gyms stay.
* **amenities** (catalogue, no longer a PRESERVE table): kept unless denied. `gym_amenities`, `amenity_proposals` and `amenity_audit_logs` that refer to a denied amenity / proposal follow it. A kept amenity whose creating proposal is denied is reported as a foreign-key conflict (blocker).
* **pt_service_packages**: `ownAll(pt_user_id)` AND not denied. A denied package that a contract still refers to (`contracts.package_id`) is **kept** and listed in `deny.keptDespiteDeny`.
* **Blockers** (the manifest cannot be frozen / applied): a denied gym with a live PT contract, a live gym membership, or money in its wallet; and any `dispute_case*` row (PRESERVE tables, never touched) that depends on an account, contract or session that would be deleted, or on a contract of a denied gym.
* The report (`--report`) has a section "6b" with the denied names and the wallet proof: every KEPT wallet involved in a deleted payment transaction, its balances before/after (kept wallets are rowHash-verified before COMMIT, balances included) and the number of ledger entries the cleanup deletes from it (must be 0).

## Guard triggers (immutability guards that block a DELETE)

Some tables refuse deletes through a trigger. `gym_listing_revisions` (gym-service migration 20261018155636, trigger `gym_listing_revisions_immutable`, function
`gym_listing_revisions_guard_closed`) raises `closed revision ... cannot be deleted` for APPROVED / REJECTED / WITHDRAWN / CHANGES_REQUESTED / STALE revisions, so the
revisions of a denied gym could not go with the gym (the 2026-11-01 H2 run failed there; the gym transaction rolled back). This class of failure is now found at AUDIT:

* **Trigger preflight** (`audit`, `audit --recheck`, `freeze`, and again inside every H2 transaction; read only, `lib/triggers.mjs`): every user trigger of every table of an in-scope database is listed.
  A trigger is *armed* when the cleanup would fire it: a DELETE trigger on a table of the delete set, on a non-empty table reached from the delete set by an `ON DELETE CASCADE` chain, or an UPDATE trigger on
  the child of an `ON DELETE SET NULL/DEFAULT` edge whose rows are not deleted first (children go first, so e.g. `gyms_compat_writer_guard` - AFTER INSERT/UPDATE, writes `legacy_compat_events` - is not armed).
  TRUNCATE, disabled (`D`) and replica-only (`R`) triggers are never armed.
* An armed trigger that is not exactly one of `GUARD_TRIGGER_ALLOWLIST` is a **blocker** (`blockers.triggerGuards`, naming table, trigger and why); the manifest cannot be frozen / applied.
* The allowlisted pairs that are armed are recorded in the manifest as `guardTriggers` (db, table, trigger, function, shape, `rowsDeleted`), so the confirmToken covers them. Today the allowlist is one pair:
  `gym` / `gym_listing_revisions` / `gym_listing_revisions_immutable`. `pt_listing_revisions_immutable` (user-service) is the same kind of guard but is NOT allowlisted: it blocks at audit if that table ever enters a delete set.
* **H2**: for exactly those tables, inside the database transaction: `ALTER TABLE ... DISABLE TRIGGER <that trigger>`, delete only the manifest keys, `ENABLE TRIGGER`; before COMMIT every trigger of the database must be in the
  state it had at BEGIN and the guard must read `tgenabled = 'O'` from `pg_trigger`. A rollback restores the state (ALTER TABLE is transactional). `session_replication_role` and `DISABLE TRIGGER ALL/USER` are never used:
  FK actions and every other trigger stay active. Progress records `guardTriggers` per database.
* `--resume`: the preflight problems carry the `[database]` prefix, so a database that is already DONE is skipped exactly like the other recheck problems.

## Manual recovery runbook (the last resort: script dead, or the maintenance role cannot log in)

The root of recovery is the OS user `postgres` inside the container; it needs no database login, so the fence can never lock it out.
`<hba>` is `$PGDATA/pg_hba.conf`; the original is kept as `<hba>.dbclean-orig` (and as `pg_hba.conf.orig` in the run directory).

1. `docker exec -u postgres gymcoach-postgres sh -c 'cp <hba>.dbclean-orig <hba>.tmp && mv <hba>.tmp <hba>'`
2. `docker exec -u postgres gymcoach-postgres pg_ctl reload -D "$PGDATA"`
3. Check `sha256sum <hba>` equals the sha256 in `freeze-state.json` (`hbaOrigSha256`) / in the approved manifest (`hbaSnapshot.sha256`).
4. Connect as `gymcoach` and run, in this order: `ALTER ROLE gymini_maintenance NOSUPERUSER NOLOGIN;` then terminate its sessions
   (`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='gymini_maintenance';`) then `DROP ROLE gymini_maintenance;`
   (if DROP complains about owned objects: `REASSIGN OWNED BY gymini_maintenance TO gymcoach; DROP OWNED BY gymini_maintenance;` in each DB, then drop again).
   Verify: `SELECT count(*) FROM pg_roles WHERE rolname='gymini_maintenance'` is 0 and no superuser exists that was not in `aclSnapshot.roles`.
5. Start the application containers ONLY when the database state is clear (no DB `RUNNING`; every `FAILED` DB was rolled back - a transaction that did not commit is rolled back by Postgres when its session dies) AND Ngai chose a direction: continue (`clean --resume`), restore (`restore`), or abandon (valid only while no DB is `DONE`; no `verify-clean.ok` is written).

`db-clean status` (and every `audit`) warns when `gymini_maintenance` exists or when `pg_hba.conf` is not the original.
