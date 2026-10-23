import { authServiceClient } from "../clients/auth-service.client";

/**
 * TEST FIXTURE: auth-service answers "this account is active" for every user.
 *
 * Since Codex #4, requestContract (and acceptContract) ask auth-service whether both parties are active and FAIL CLOSED (503) when
 * it cannot answer. A suite that is about something else (package snapshot, gym agreement, membership, restriction ...) and calls
 * requestContract therefore needs auth-service to answer. Call this once at module level; it stays in place for the whole test
 * process (each node:test file is its own process). Suites that need a different answer patch `internalGet` themselves afterwards.
 * The fail-closed behaviour itself is covered by contract-parties-account-status-fail-closed.integration.test.ts.
 */
export function installAccountsActive(): void {
  (authServiceClient as { internalGet: unknown }).internalGet = async (path: string) => {
    const id = path.split("/").pop()!;
    return { status: 200, data: { user: { id, email: `${id}@test.local`, firstName: "T", lastName: "User", isActive: true } } };
  };
}
