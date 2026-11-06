import fs from "node:fs";
import { PilotError } from "./config";

/**
 * Cross-process rollback tripwire: durable files this run already wrote/received (issued ledger, release, run journal)
 * carry OS modification times. A wall clock earlier than any of them (beyond a small tolerance) means the clock moved
 * backwards since, so a fresh process must not trust it to judge approval/release expiry. Not proof against a hostile
 * operator who also rewrites file times; it fails closed on honest rollback/NTP mistakes.
 */
export const NOVA_CLOCK_ROLLBACK_TOLERANCE_MS = 2000;
export function assertNoObservedClockRollback(files: readonly string[], now = Date.now()): void {
  if (!Number.isFinite(now)) throw new PilotError("NOVA_HTTP_CLOCK_OR_AUTHORITY_INVALID");
  for (const file of files) {
    let mtime: number; try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
    if (mtime > now + NOVA_CLOCK_ROLLBACK_TOLERANCE_MS) throw new PilotError("NOVA_CLOCK_ROLLBACK", { observed: "FILE_TIME_AHEAD_OF_CLOCK" });
  }
}

/** Process-local observations only. A new process still requires a trusted system clock. */
export function novaAuthorityClock(projectMonotonicDeadline = false) {
  const start = Date.now(), mono = process.hrtime.bigint(); let last = start, rejected = false;
  return () => {
    const wall = Date.now(), elapsed = Number(process.hrtime.bigint() - mono) / 1e6;
    if (!Number.isFinite(wall) || !Number.isFinite(start) || elapsed < 0) throw new PilotError("NOVA_HTTP_CLOCK_OR_AUTHORITY_INVALID");
    if (rejected || wall < last) { rejected = true; throw new PilotError("NOVA_CLOCK_ROLLBACK"); }
    last = wall;
    // The credential admission clock cannot extend a phase by stalling/backdating wall time after admission.
    return projectMonotonicDeadline ? Math.max(wall, start + elapsed) : wall;
  };
}

/**
 * Failures that prove the authority context can no longer be used as-is: an observed expiry (approval, release,
 * pricing, credential lease/margin) or an observed clock rollback. Once observed they are TERMINAL for that context.
 * An invalid clock READING is not terminal by itself (it proves nothing about expiry) but always fails the call.
 */
export const NOVA_TERMINAL_AUTHORITY_CODES: ReadonlySet<string> = new Set(["LiveNotApproved", "APPROVAL_EXPIRED", "PricingNotValid", "INFERENCE_RELEASE_EXPIRED",
  "INFERENCE_RELEASE_INVALID", "INFERENCE_RELEASE_REQUIRED", "NOVA_CREDENTIALS_EXPIRED", "NOVA_CREDENTIAL_LEASE_EXPIRED", "NOVA_CLOCK_ROLLBACK"]);
const isTerminal = (e: unknown): e is PilotError => e instanceof PilotError && NOVA_TERMINAL_AUTHORITY_CODES.has(e.code);
/**
 * Non-revivable authority state for ONE authorization context (never global).
 * check(): 1) observe the clock FIRST (so the observation is recorded even if a later callback throws; a rollback is
 * itself terminal), 2) refuse if the context is already terminal, 3) run the checks/callbacks and latch any terminal
 * failure. The FIRST terminal category is re-raised unchanged on every later call, including when a later clock
 * rollback is observed (that observation is reported in details only). Only a new signed admission creates a new context.
 */
export function novaAuthorityLatch() {
  let terminal: { code: string; details: Record<string, unknown> } | null = null;
  const record = (e: unknown) => { if (!terminal && isTerminal(e)) terminal = { code: e.code, details: { ...e.details } }; };
  const latched = (extra: Record<string, unknown> = {}) => new PilotError(terminal!.code, { ...terminal!.details, latchedTerminalAuthority: true, ...extra });
  return {
    record,
    check<T>(observe: () => number, body: (now: number) => T): T {
      let now: number;
      try { now = observe(); } catch (e) { const prior = !!terminal; record(e); if (prior) throw latched({ alsoObserved: e instanceof PilotError ? e.code : "CLOCK_ERROR" }); throw e; }
      if (terminal) throw latched();
      try { return body(now); } catch (e) { record(e); throw e; }
    },
    get terminalCode() { return terminal?.code ?? null; },
  };
}

/**
 * The single authority context of one signed admission: one clock + one latch shared by the credential lease, every
 * session-level authority check and the HTTP boundary of the client built from that lease. A failure observed by ANY
 * of them is terminal for ALL of them.
 */
export interface NovaAuthorityContext {
  check<T>(body: (now: number) => T): T;
  /** Clock reading inside check() bodies (rollback-detecting; may throw). */
  now(): number;
  /** Latches a terminal failure observed outside check() (e.g. a deadline judged while reporting another error). */
  record(e: unknown): void;
  readonly terminalCode: string | null;
}
export function novaAuthorityContext(projectMonotonicDeadline = true): NovaAuthorityContext {
  const clock = novaAuthorityClock(projectMonotonicDeadline), latch = novaAuthorityLatch();
  return Object.freeze({ check: <T>(body: (now: number) => T) => latch.check(clock, body), now: clock, record: latch.record, get terminalCode() { return latch.terminalCode; } });
}
/**
 * Runs a throwable authority callback FIRST (historical category precedence), but if it fails with a NON-terminal
 * category the deadline judgement is still made and latched, so an observed expiry can never be lost behind another error.
 */
export function novaGuardedCallback(context: NovaAuthorityContext, callback: () => void, deadlines: () => void): void {
  try { callback(); }
  catch (e) { if (!isTerminal(e)) { try { deadlines(); } catch (d) { context.record(d); } } throw e; }
}
// Objects (lease credentials, runtime clients) carry their admission's context, so a client/boundary rebuilt from an
// old lease can never start with a fresh latch.
const contexts = new WeakMap<object, NovaAuthorityContext>();
export function bindNovaAuthority<T extends object>(target: T, context: NovaAuthorityContext): T { contexts.set(target, context); return target; }
export function novaAuthorityOf(target: unknown): NovaAuthorityContext | undefined { return target && typeof target === "object" ? contexts.get(target) : undefined; }
