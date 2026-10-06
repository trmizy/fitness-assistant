# 04 — Authorization and User Isolation

## Question

For every user-owned resource, is ownership derived from the authenticated identity, or trusted from request input?

## Method

1. Identity source: the gateway verifies the token with auth-service and sets `x-user-id` (`gateway/src/middleware/auth.middleware.ts` lines
   23–56). It overwrites any client-supplied `x-user-id`. Services read `req.user.id` set from that header or re-verify the token.
2. Request-supplied identifiers: grep for `req.body.userId|clientId|profileId|…`, `req.params.userId|clientId|…` in non-test service code.
   Result: 7 matches. Each was classified.
3. Id-only lookups: grep for `findUnique({ where: { id: … } })` outside tests: 43 sites, mostly scripts. Sampled production paths.

## Classification of request-supplied identifiers (7 matches)

| Location | Identifier | Classification | Result |
|---|---|---|---|
| `ai-service/src/routes/internal.routes.ts:46` | `req.params.userId` | Internal route, guarded by `x-service-secret` | Acceptable with G-09 |
| `auth-service/src/controllers/auth.controller.ts` (`updateUserRole`, `updateUserNameAsAdmin`, `setUserActive`, `updateUserRoleInternal`) | `req.params.userId` | Admin-only in gateway; internal in service | Defense in depth missing (G-08) |
| `fitness-service/src/controllers/coach.controller.ts` (10 methods) | `req.params.clientId` | PT actions; service re-checks relationship (`coach.service.ts` ~41: 403) | Verified in code (sampled service method) |
| `payment-service/src/routes/internal.routes.ts:731` | `req.params.ownerId` | Internal route guarded by `serviceSecretMiddleware` (`router.use`) | Acceptable with G-09 |
| `user-service/src/controllers/profile.controller.ts:328` | `req.params.userId` | Needs classification (not traced in full) | NEEDS_RUNTIME_VERIFICATION |
| `user-service/src/routes/internal.routes.ts` (several) | `req.params.userId` | Internal, guarded by `router.use(serviceSecretMiddleware)` | Acceptable with G-09 |
| `gym-service/src/clients/profile.client.ts:24` | response field, not request | Not an authorization input | N/A |

Conclusion: no user-facing route found to accept a `userId` from the request body as authority. The coach routes use `req.user.id` as the
PT and `req.params.clientId` only as the target, with a server-side relationship check.

## Verified controls (code inspection)

| Control | Location | Check |
|---|---|---|
| PT–client relationship | `fitness-service/src/services/coach.service.ts` (header comment: re-check fresh per method; line ~41 throws 403) | Relationship re-verified server-side per action |
| Marketplace withdraw | ai-service marketplace service `withdraw()` | `listing.publisherId !== userId` → 403 |
| Chat conversation send | `chat-service/src/socket/chat.handler.ts` lines 74–82 | Participant check before message |
| Chat join | `chat.handler.ts` lines 26–34 | `socket.join` only after participant check |
| Admin socket room | `chat-service/src/socket/index.ts` lines 61–63 | Role from verified token equals ADMIN |
| AI admin routes | `ai-service/src/routes/admin.routes.ts` lines 15–16 | `requireAuth`, `requireRole(["ADMIN"])` |
| AI action confirm/dismiss | `fitness-agent.service.ts` ~777–826, ~1990–2005 | `updateMany` with `userId` in `where` |
| AI workflow lookup | `tryConfirmationBoundary` (~1939) | `findFirst` with `userId` and `sessionId` |
| Gateway admin area | `gateway/src/routes/proxy.routes.ts` 1589–1606 | `requireRoles("ADMIN")` on `/auth/users*` |

## Gaps

1. **Admin mutations rely on the gateway** (G-08). Any direct route to auth-service bypasses the admin check.
2. **Internal routes behind the public proxy** (G-09): `/auth/internal/*` is forwarded; each handler checks the shared secret.
3. **Id-only lookups not fully classified** (G-24). The 43 sites need a per-route owner-check matrix. Examples observed as scripts only.
4. **Other marketplace mutations** (republish, adopt, review, improvement suggestions) were not traced.
5. **Shared exercise cache** keyed by id (G-29). Safe only if every caller applies visibility after the read.

## Isolation test coverage

- The conversational X4 matrix (research and product verification harness, `test/conversational-intelligence/x4-confirmation-matrix.mjs`)
  covers confirmation and status across sessions for one user pair. Its evidence class is `TEST_FIXTURE` plus `BACKEND_INTEGRATION`.
- No suite covers cross-user access for each route family (G-24).

## User A must never …

| Requirement | Status |
|---|---|
| read User B's data | Sampled controls OK; full matrix NEEDS_RUNTIME_VERIFICATION |
| modify User B's data | Sampled OK; admin paths G-08 |
| confirm User B's workflow | VERIFIED_OK by code (`updateMany` scoped by `userId`) |
| resume User B's session | VERIFIED_OK by code (`findFirst` by `userId` and `sessionId`) |
| access User B's AI context | Not fully traced (context builders in `fitness-agent-context.ts`); NEEDS_RUNTIME_VERIFICATION |
| receive User B's cached state | Client-side: mobile clears query cache on logout (`AppContext.tsx`); web NOT VERIFIED. Server-side shared caches: G-29 |

## Required before release

- Owner-check matrix generated from the route table, reviewed per family (P1-T13).
- Cross-user test per family in CI against the test databases.
- Block public `/internal` paths (P1-T04).
