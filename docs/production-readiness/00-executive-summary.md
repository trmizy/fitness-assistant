# 00 — Executive Summary

Audience: Gymini engineering leads and the release owner. Written in English.

## Verdict

**Production verdict: NO-GO** for public production.

The product is a credible demo and internal pilot candidate. It is not yet safe to expose to the public. Four P0 blockers prevent launch,
and one of them (bearer tokens in logs) was reproduced on the local stack.

## Counts

Gap register: **36 gaps.** Severity counts are generated from [15-production-gap-register.md](15-production-gap-register.md) and reproduced in
[README.md](README.md) §Counting.

| Severity | Count | Meaning |
|---|---|---|
| P0 | 4 | Production blocker |
| P1 | 20 | Required before public production |
| P2 | 10 | Hardening |
| P3 | 2 | Optional |

## Top production blockers

1. **G-01 — JWT signing fallback to a public literal.** Anyone who reads the public repository can forge tokens for any user whose UUID they
   know. The fallback activates whenever the variable is empty.
2. **G-02 — Bearer access tokens in logs.** Reproduced locally: 1,024 of the last 2,000 auth-service log lines carry an `Authorization` header.
3. **G-03 — No TLS in the production topology.** The only published port is HTTP 80.
4. **G-04 — Destructive migrations with no snapshot gate.** A historical migration deletes measured InBody rows. Deploy path has no backup or
   restore gate.

## Verdicts by area

| Area | Verdict | Basis |
|---|---|---|
| Security | NO-GO | G-01, G-02, G-03; G-05–G-09 |
| Data integrity | CONDITIONAL | Strong partial unique invariants and FKs; destructive history (G-04); drift (G-20) |
| AI safety | CONDITIONAL | No LLM DB writes, atomic confirmation, tools off by default; LLM use outside the flag, 170-second turns (G-17, G-18) |
| Deployment | NO-GO | No TLS, no production IaC, no backups, no monitoring deployment (G-03, G-12–G-14) |
| Test and evidence | NO-GO | No typecheck, no dependency audit, no cross-user suite, no failure drills in CI (G-11, G-22, G-24, G-19) |

## What is good (verified in code or live)

- Payment webhooks for MoMo and VNPay verify signatures and fail closed on empty keys.
- AI action confirmation claims the action atomically and scopes it by user.
- Coach actions re-check the active PT–client relationship on the server.
- LLM-facing modules perform no Prisma writes; tool calling is off by default.
- Several business invariants are enforced by partial unique indexes (active training cycle, active roadmap, active nutrition goal, one program per AI action).
- Backend containers run as non-root users; mobile stores tokens in SecureStore and clears the query cache on logout.

## First implementation batch (recommended, not executed)

Batch 0 — security hotfix, small and high-value:
1. G-02: redact authorization and token keys in auth-service logs; exclude `/auth/verify` from request logging; purge existing logs per policy.
2. G-01: remove JWT literal fallbacks; fail fast in production; rotate both secrets; revoke refresh tokens.
3. G-09 (gateway part): return 404 for `/auth/internal` and `/internal` on the public proxy.
4. G-06: invert the debug-OTP gate.

Batch 1 — decisions and policy (no code): deployment target (G-12), TLS edge design (G-03), migration policy and snapshot gate (G-04), LLM kill-switch
contract (G-17), payment go-live scope (G-23).

Batch 2 — tests that prove the batch: boot tests for secrets, log redaction test, public-route 404 test, OTP gate test.

## Research track isolation

The workout BPM benchmark is a separate track. Its frozen dataset, evaluator and run artefacts are untracked in git (G-21). This audit did not
modify them. Recommended separation: a dedicated research branch with an annotated tag for the frozen dataset, and product-production branches
that never touch research paths. See [README.md](README.md) §Research isolation.

## Decisions required from the owner

1. Deployment target (EC2 compose, Lambda, or ECS) and the edge (ALB or CloudFront).
2. Whether Conversational Intelligence ships in the first release, and the single LLM kill-switch contract.
3. Whether payments, booking, membership, notifications and uploads ship in the first release.
4. Equipment gating for manually created programs (product rule).
5. Retention and access policy for logs.

## Limitations of this audit

- Product unit and integration suites were not run here; CI results on `master` should be cited for those.
- No production or staging environment was accessed.
- Dependency vulnerability data was not obtained (`pnpm audit` gave no output).
- Concurrency, crash and outage behaviour was reasoned from code, not executed (see gaps marked NEEDS_RUNTIME_VERIFICATION).
