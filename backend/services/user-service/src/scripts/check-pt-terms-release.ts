/**
 * PRE-DEPLOY SAFETY CHECK (D74) - refuses to ship DRAFT PT terms to production. Read-only, no database, no network.
 *
 *   NODE_ENV=production ./node_modules/.bin/tsx src/scripts/check-pt-terms-release.ts
 *
 * Exit code: 0 = the terms may be released (or the environment is not production), 1 = they must not.
 * It is a release/deploy gate only: nothing imports it at service start, so a RUNNING production service is never stopped by it.
 * The same rule is reported by post-deploy-state-check.ts (finding T-01).
 */
import { PT_TERMS_IS_DRAFT, PT_TERMS_VERSION, ptTermsReleaseProblem } from "../services/pt-terms";

export function checkPtTermsRelease(env: Record<string, string | undefined>): { ok: boolean; message: string } {
  const problem = ptTermsReleaseProblem(env);
  if (problem) return { ok: false, message: `PT terms release check FAILED: ${problem}` };
  return {
    ok: true,
    message: `PT terms release check ok: version ${PT_TERMS_VERSION} (${PT_TERMS_IS_DRAFT ? "draft, allowed outside production" : "official"}), NODE_ENV=${env.NODE_ENV ?? "<unset>"}`,
  };
}

if (require.main === module) {
  const r = checkPtTermsRelease(process.env);
  (r.ok ? console.log : console.error)(r.message);
  process.exit(r.ok ? 0 : 1);
}
