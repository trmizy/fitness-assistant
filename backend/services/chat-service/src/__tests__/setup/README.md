# Test isolation (database, Prisma CLI, outbound network)

Every test process is started by `npm test` with `tsx --import ./src/__tests__/setup/db-isolation.ts ...`. That preload runs BEFORE any service module
and decides three things for the whole run. The same three files exist in user-service, chat-service and gym-service
(`db-isolation-validator.ts`, `db-isolation.ts`, `outbound-guard.ts`, `db-cli-plan.ts`); only `DB_ENV_VARS` in `db-isolation.ts` differs.

## 1. Databases

| `TEST_DATABASE_URL` | effect |
|---|---|
| valid: host `localhost`/`127.0.0.1`, port **55433**, role `gymcoach_test`, database name ends `_test`, not a DB URL of the service `.env`, never 5432/5433 | EVERY DB variable of the service (user/gym: `DATABASE_URL`; chat: `CHAT_DATABASE_URL` and `DATABASE_URL`) = it, `DB_ISOLATION=accepted`; DB suites run |
| missing / invalid | EVERY DB variable = an unconnectable sentinel (`127.0.0.1:1`), `DB_ISOLATION=refused`; DB suites are SKIPPED with a reason, tests that need no database run |

A DB variable set by hand in the shell is **ignored** (the preload overwrites it); `<service>/.env` (the dev database) is never read.

## 2. Prisma CLI — never call it directly on a test database

`prisma migrate deploy / db push / migrate status / migrate diff` read `<service>/.env` and the variable named in `schema.prisma` (chat uses
`CHAT_DATABASE_URL`, not `DATABASE_URL`). A direct call with only `DATABASE_URL` set once reached the dev chat database. Use the wrapper:

```
TEST_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/<name>_test?schema=public" npm run test:db:migrate   # migrate deploy
                                                                                                                npm run test:db:status | test:db:push | test:db:generate
                                                                                                                npm run test:db:diff -- --from-url "<same kind of URL>" --to-schema-datamodel prisma/schema.prisma --script
```
The wrapper (`scripts/test-db-cli.ts`) validates EVERY DB variable of the repo (`DATABASE_URL`, `CHAT_DATABASE_URL`, the ones in `schema.prisma`) and every
`--from-url/--to-url/--shadow-database-url` with the same validator as the preload BEFORE it starts prisma. Wrong or missing: exit code 2, one line (no
credentials), prisma is not started, no connection. `migrate dev`, `migrate reset`, `db execute`, `studio`, `--force-reset` are refused.

## 3. Outbound network (`outbound-guard.ts`)

In a test process `fetch`, `http/https.request|get` (axios, every instance) and every TCP socket are checked. Allowed: loopback ports that a test **registered**
(`registerTestService("http://127.0.0.1:PORT")`, or `TEST_ALLOWED_SERVICE_URLS=url1,url2`) or that a server started IN THIS PROCESS listens on (auto-registered).
Always refused, even when registered: ports 3000-3010 (dev gateway + services), 5432/5433 (dev postgres), 6379 (redis), 9000/9001 (minio), and every host
that is not loopback. A refusal throws `OUTBOUND_BLOCKED_IN_TEST` and opens no socket. Every service-URL variable that is unset is set to the blocked
sentinel `http://127.0.0.1:9`, so `|| "http://localhost:3007"`-style defaults of the product code are never used; `*_LAMBDA_NAME` are cleared.
A test that spawns ANOTHER process (payment-service child, gym-service child) must register its URL (the cross-service harness does, and prints the list).
`globalThis.__GYMINI_TEST_OUTBOUND__` holds the registry / blocked / allowed logs; `registeredTestServices()` lists the registry.

## Rules
1. **Serial.** `npm test` runs `--test-concurrency=1`. Many suites truncate / count whole tables, so two suites in parallel on one database interfere.
2. **One run per database.** Two runs at the same time must each use their OWN `*_test` database, e.g. `gymcoach_user_<yourname>_test`: create it, apply the
   migrations with `npm run test:db:migrate`, then `TEST_DATABASE_URL=<url> npm test`. There is no cross-process lock.
3. A fresh database must have every migration applied; `prisma migrate dev` is not used here.
4. The REAL AUTH suite (`dispute-case-real-auth.test.ts`) additionally needs `AUTH_TEST_DATABASE_URL` (a different `*_test` database, migrated with auth-service's
   migrations); otherwise it is SKIPPED.
5. Proof that all of this holds: `src/__tests__/test-isolation.test.ts` (child processes, a fake "dev" listener on a random loopback port, a spy in place of the socket).
