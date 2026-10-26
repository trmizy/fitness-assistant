# db-clean (Listing Management, Phase G / H)

Plan references: sections 9, 12.9, 12.13 items 6-8, 12.14 items 3/5/6, 12.15 items 1-2, 12.16, 8.1 (precedence 12.16 > 12.15 > 12.14 > 12.13 > earlier).

```
node scripts/db-clean/db-clean.mjs <command> --env dev|test [options]
```

| Command | What it does | Writes to a DB? |
|---|---|---|
| `audit` | Read only. Candidate accounts (always-list + E2E fixtures), per-table delete/keep counts, the approved-candidate manifest + `confirmToken`, report. | **No** (connections are `default_transaction_read_only=on`) |
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
