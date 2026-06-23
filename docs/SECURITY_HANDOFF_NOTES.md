# Security Handoff Notes

## `.env` in Git History

**Finding**: The root `.env` file appears in git history across several commits (9555d82, c1862cc, f69a8c0, eff15bd, 182dcf0, 6c292bf) and was later deleted in a cleanup commit.

**Severity**: Low — after reviewing the committed content, the historical `.env` contained only development infrastructure defaults:
- `POSTGRES_HOST=localhost`, ports, DB names
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — development placeholder values
- Internal service URLs (localhost only)
- No real third-party API keys were present

**Real API keys** (ANTHROPIC_API_KEY, PEXELS_API_KEY, DROPBOX_SIGN_API_KEY, SMTP_PASS) exist only in the local `.env` file on developer machines and were **never committed to git**.

**Source code**: `git grep` scan of all tracked files found no hardcoded secret values — only `process.env.VARIABLE_NAME` references.

**Action required**: None for the real API keys (never committed). If the development JWT secrets in the history are considered sensitive for your threat model, you can rotate them in your dev `.env`.

## Recommendations

1. Keep `.gitignore` rules as-is (`*.env` + `!.env.example`) — they are correct.
2. Ensure all team members create `.env` from `.env.example` (`cp .env.example .env`).
3. For future secret management, consider using a secrets manager (Vault, AWS SSM, etc.) in production.
