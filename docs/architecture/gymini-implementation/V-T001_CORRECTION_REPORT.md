# V-T001.1 — Central Log Redaction: Correction Report

Date 2026-10-19 · Agent: Claude Code · Responds to `V-T001_INDEPENDENT_REVIEW.md` (`V-T001_CHANGES_REQUIRED`).
Local correction only. No deployment, no AWS, no DB, no commit.

## 1–3. Baseline and preserved work
- START_HEAD = END_HEAD = `003545c6da8d524e8c4f6fbe4575444102f1fc50`, branch `aws-deploy`, **no worktree** (edited in place, so the uncommitted V-T001 `shared/src/index.ts` was never lost).
- Preserved untouched: V-T012 changes (ai-service routes/middleware/tests), Bedrock files, `pnpm-lock.yaml`, `.dev/aws/*`, audit docs, the independent review.

## 4. Findings and corrections
| Finding | Cause (verified in installed code) | Correction |
|---|---|---|
| **R01** `x-service-secret` logged | not in header policy; real names in use: `x-service-secret`, `x-internal-token`, `x-internal-secret`, `x-gateway-secret`, `x-api-key` | One case-insensitive `SENSITIVE_HEADERS` list (also authorization, proxy-authorization, cookie, set-cookie) applied by `sanitizeHeaders` to req, res and Axios carriers; matching `redact` paths (lower + Title-Case) for explicit `{headers}` objects up to 2 levels. Auth mechanism untouched. |
| **R02** signed doc URL / Location logged | pino-std-serializers keeps `originalUrl` and `getHeaders()` | Log-only `req`/`res` serializers build NEW objects: `sanitizeUrlForLog` keeps path + param **names**, replaces values with `[REDACTED]` (relative and absolute, fragment dropped), same for `Location`/`Content-Location`/`Referer`, `req.query` values. Live `req.url`, the Location sent, signature verification and S3 flow are never mutated (test C asserts the sent Location is byte-identical). |
| **R03** Axios/error metadata | default err serializer copies enumerable props incl. `config`, `request` (raw ClientRequest), `response` | `errLogSerializer`: std output with `request` dropped, `config`/`response.config` projected to `{method,url(sanitized),baseURL,timeout,headers(redacted)}` (no body/params), `response` reduced to `{status,statusText,config}`. `message`, `stack`, `code`, `status`, name preserved. |

Two facts discovered while fixing: (a) **pino-http ignores logger-level req/res serializers** and uses std ones unless given `serializers`, so `auth-service/src/app.ts` and `user-service/src/app.ts` now pass `serializers: httpLogSerializers` (one-line edits); (b) pino-http's wrapper hands a custom serializer an already-serialized object, so the serializers accept both raw and serialized shapes (this was a real bug I introduced and caught: `statusCode` became null).

## 5. R04 / R05 residual treatment
- R04: depth/casing stays **bounded** by design: named credential fields (case-sensitive) at depth 0–2; headers policy case-insensitive only inside the serializers; arbitrary hand-built objects deeper than 2 levels or with unlisted names are NOT covered. No current call site found shaped that way; documented, not claimed fixed.
- R05: free-text messages and error `cause` messages are NOT sanitized (no text sanitizer). No confirmed call site interpolating credentials; documented. Unbounded recursive sanitization deliberately not added (cycles/latency).

## 6. Files changed
`backend/shared/src/log-safety.ts` (new) · `backend/shared/src/index.ts` (policy + serializers; stale “bare Error merges at top level” comment replaced — pino wraps it as `err`) · `backend/services/auth-service/src/app.ts` · `backend/services/user-service/src/app.ts`.

## 7. Tests added
`backend/services/user-service/src/__tests__/log-secret-hygiene.test.ts` (A–H). A child Node process loads the REAL compiled `@gym-coach/shared` singleton, real user-service and auth-service apps, installed pino-http and a real `axios.AxiosError`, with synthetic env/credentials only; parent inspects the child's actual stdout. A: service/internal headers (mixed case) + auth statuses 200. B: real `toSignedPtDocumentUrl` signature absent, nonexistent doc still 404, URL logged as `?exp=[REDACTED]&sig=[REDACTED]`. C: sent Location unchanged, logged Location sanitized, status/Set-Cookie. D/E: plain and real AxiosError, bare and wrapped, config + response.config. F: explicit mixed-case request objects. G: method/url/id/status/duration/error name/message/status retained. H: negative control (same probe, unprotected `pino()` + default pino-http) leaks the markers, so assertions can fail; production source was not altered for it.

## 8. Executed (local, synthetic)
| Run | Result |
|---|---|
| user `log-secret-hygiene.test.ts` | 7 pass / 0 fail |
| user `ptDocumentUrl.util`, `auth-middleware-transport`, `auth-service-client`, + new (4 files) | 45 pass / 0 fail |
| auth-service all test files except `credential-rotation-transaction.integration` | 86 pass / 0 fail / 0 skipped (includes earlier `logger-redaction.test.ts`, still passing) |
| `tsc --noEmit`: shared, auth-service, user-service, gateway, ai-service | clean |
| user-service full suite, auth `credential-rotation-transaction.integration`, DB-backed suites | **ENVIRONMENT_BLOCKED** (Docker/Postgres absent); not run, not counted as pass |

## 9. Runtime logger verification
Child-process probe uses the compiled `backend/shared/dist` singleton resolved via `@gym-coach/shared`; both service apps and installed pino 8.21.0 / pino-http 9.0.0 / pino-std-serializers 6.2.2 / axios were exercised. Not a separate test logger (the negative control is the only one, and is labelled).

## 10. Build / packaging
`shared` rebuilt locally with `tsc`; `dist/index.js` and `dist/log-safety.js` contain the correction. `dist` is untracked/ignored and not added. Per review, Dockerfiles and Lambda build scripts rebuild shared; I did **not** build a clean image/ZIP: **clean artifact verification NOT_VERIFIED**. Local `dev` does not watch shared — rebuild required.

## 11. Gate matrix
| Gate | Result |
|---|---|
| x-service-secret protection | PASS |
| Signed request URL | PASS |
| Signed response Location (log only) | PASS |
| Axios/error credentials | PASS (bounded projection) |
| Existing Authorization/Cookie redaction | PASS |
| Actual singleton runtime | PASS |
| HTTP/document flow compatibility | PASS (404/200/302 unchanged; DB-backed flows blocked) |
| Operational metadata | PASS |
| Local regressions | PASS for runnable suites; DB suites BLOCKED |
| Build/type checks | PASS |
| Scope/worktree safety | PASS |

## 12. Remaining limitations
Deep-object (>2 levels / unlisted or differently-cased field names) and free-text/cause-message risk as above; query values are redacted wholesale (param names retained); credentials in URL **path** segments are not handled; services other than auth/user must pass `httpLogSerializers` if they adopt pino-http; DB-backed integration status BLOCKED; clean artifact NOT_VERIFIED; **historical log/credential exposure not assessed** — nothing here shows prior logs are clean or leaked, and no rotation or CloudWatch review was done (needs owner authorization).

## 13. Safety
No AWS, deployment, real secrets, real documents, DB changes, AI inference or heldout access; auth, signing/verification, payment, AI policy and PT authorization code unchanged. No commit.

## 14. Verdict and readiness
`V-T001_CORRECTIONS_IMPLEMENTED_AND_TESTED` (local only; not production safety). Ready for independent Codex re-review of `log-safety.ts`, `index.ts`, the two `app.ts` edits and the new test.
