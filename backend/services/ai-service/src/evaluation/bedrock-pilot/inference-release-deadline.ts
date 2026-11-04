import { PilotError } from "./config";

/** Freshness only: signature, approval/config and measurement bindings must already be verified by the session. */
export function assertCurrentInferenceRelease(release: { expiresAt: string } | null, now = Date.now()): void {
  if (!release) throw new PilotError("INFERENCE_RELEASE_REQUIRED");
  const expires = Date.parse(release.expiresAt);
  if (!Number.isFinite(expires) || !Number.isFinite(now)) throw new PilotError("INFERENCE_RELEASE_INVALID");
  if (expires <= now) throw new PilotError("INFERENCE_RELEASE_EXPIRED");
}

/** Recheck at the transport boundary, after preflight and durable reservation; no async gap before dispatch. */
export function dispatchWithInferenceRelease<T>(release: { expiresAt: string } | null, dispatch: () => T): T {
  assertCurrentInferenceRelease(release);
  return dispatch();
}
