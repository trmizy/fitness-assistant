# Isolated E2E environment for Dispute V2.1

Compose project `gymini-e2e-dispute`, file `infra/compose/docker-compose.e2e-dispute.yml`. Real postgres + auth + payment + user + gym + chat + gateway,
built from THIS worktree (source copied into the images, nothing bind-mounted, no db-seeder, no `.env`). Its own postgres container/volume and its own
databases (`gymini_{auth,user,payment,gym,chat}_e2e`). It never touches the shared dev stack (`gymcoach-*`), its ports, volumes or databases.

## Commands (bash, from anywhere)

| script | does |
|---|---|
| `up.sh` | build + start the 7 containers (first build ~6 min; the user-service applies its migrations at start, ~3 min) |
| `seed.sh` | idempotent seed (accounts, paid contract, DISPUTED + PT_NO_SHOW_REPORTED sessions, gym complaint). `seed.sh --new-dispute` adds one more DISPUTED session |
| `status.sh` | containers, startup audit lines of the runtime gate, what user-service really evaluates (flags) |
| `smoke.mjs` | REAL HTTP/API smoke through the gateway (`SMOKE_SESSION_ID=<id> node scripts/e2e-dispute/smoke.mjs` to use a spare session) |
| `down.sh` | remove containers + network, KEEP data |
| `reset.sh` | wipe this project (containers, network, its 2 volumes) then up + seed |
| `clean-checkout-check.sh` | `git archive HEAD` into a temp dir, prisma generate + tsc for user/payment/gym/gateway |

All of them pass `-p gymini-e2e-dispute -f <this compose file>`; none can address another project.

## URLs (all bound to 127.0.0.1)

| what | URL |
|---|---|
| **Gateway (point the frontend here)** | `http://127.0.0.1:58100` |
| auth / user / chat / gym / payment (direct, debugging) | `:58101` / `:58104` / `:58105` / `:58106` / `:58107` |
| postgres | `127.0.0.1:58132`, user `gymini_e2e`, password `e2e_dispute_pw` |

Frontend (do not edit frontend files; set env when starting Vite):
`GATEWAY_PROXY_TARGET=http://127.0.0.1:58100 CHAT_PROXY_TARGET=http://127.0.0.1:58105 pnpm --filter ... dev`
(the frontend calls `/api/...`, Vite strips `/api` and forwards to the gateway; or set `VITE_API_URL=http://127.0.0.1:58100` for an absolute base. The
gateway CORS origin is `http://localhost:5173`.) Fitness/AI routes are not part of this environment (the gateway answers 502 for them).

## Accounts (password for ALL, this environment only: `E2eDispute#2026`)

| role | email | id |
|---|---|---|
| ADMIN (investigator) | `admin1.e2e-dispute@example.test` | `e2e00000-0000-4000-8000-000000000001` |
| ADMIN (approver, four-eyes) | `admin2.e2e-dispute@example.test` | `...0002` |
| CUSTOMER (client) | `client.e2e-dispute@example.test` | `...0003` |
| PT | `pt.e2e-dispute@example.test` | `...0004` |
| GYM_OWNER | `gymowner.e2e-dispute@example.test` | `...0005` |

Ids of the seeded contract / sessions / gym / complaint: `scripts/e2e-dispute/.state/seed.json` (git-ignored). The login endpoint is IP rate-limited
(HTTP 429 after a burst): wait a minute if you hit it.

## Flags

ON here: execution, evidence storage, D65-B resolution, gym complaint case. OFF and NEVER permitted by the e2e gate: T0, late-open OPEN-L settlement.
`OPENED_D77_COMBINATIONS` is untouched (empty). See `_warroom/sessions/dispute_bc/E2E_ENV.md` for the runtime-gate rule.

Evidence labels: accounts / profile / contract-before-payment / starting sessions / gym rows = TEST FIXTURE. Payment, dispute, no-show report, the whole case
workflow, execution and the ledger = REAL HTTP/API on the real services. The D-NEW-12 policy review in `smoke.mjs` is done through the four-eyes API but
is a TEST FIXTURE judgement, not eligibility proof.
