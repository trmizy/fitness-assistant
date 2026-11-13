/**
 * Gymini V2 (EXPERIMENTAL, branch feature/ai-v2-agent) — feature flag.
 *
 * GOVERNANCE DEVIATION (recorded 2026-11-12, owner-approved P0/P1 only): gymini-ai-governance §2/§13 says V2 starts from
 * an APPROVED V1 Stable release. V1 is only at Release Candidate (tag v1.0.0-rc1 → 3cab8b21, deployed to AWS dev) — the
 * rollback drill and Stable approval were not done. This branch therefore starts from v1.0.0-rc1, is experimental, is not
 * an official Stage 2, and must be rebased/re-validated on the eventual V1 Stable tag before any promotion.
 *
 * AI_AGENT_V2 is OFF unless the variable is exactly "on". Any other value ("true", "1", "ON ", unset…) is OFF, so a typo
 * or an inherited variable can never switch the experimental agent on. V1 never reads this flag and never imports
 * anything under src/agent-v2/ — with the flag OFF there is no V2 code path at all.
 */
export function isAgentV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AI_AGENT_V2 === "on";
}

/**
 * M7-P1: the V2 HTTP endpoint (POST /ai/v2/ask). Needs the flag AND, where NODE_ENV is "production" (every AWS Lambda of
 * this project, dev included), a second explicit owner approval AI_AGENT_V2_PRODUCTION_APPROVED === "yes". An inherited
 * flag alone can therefore never expose the experimental endpoint on a deployed service. Deployment is on hold until the
 * whole Multi-Agent is complete (owner rule 2026-11-13); this variable must not be set before that release.
 */
export function isAgentV2HttpEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (!isAgentV2Enabled(env)) return false;
  return env.NODE_ENV !== "production" || env.AI_AGENT_V2_PRODUCTION_APPROVED === "yes";
}
