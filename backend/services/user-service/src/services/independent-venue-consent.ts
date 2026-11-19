import { createHash } from "crypto";
import { SessionMode } from "../generated/prisma";

/**
 * N15M-14 (owner decision 16/11/2026): a client may still train at a venue that is NOT a gym in the Gymini system
 * (an offline/hybrid package requested with no gymId, so the contract is INDEPENDENT). Before such a request is sent
 * the client must see - and explicitly accept - that Gymini takes no responsibility for the contract at that venue.
 *
 * The acknowledgement is enforced server-side (requestContract) and recorded as an AuditLog row
 * (action CONTRACT_INDEPENDENT_VENUE_ACKNOWLEDGED) written in the SAME transaction as the contract, so a contract
 * of this kind either has its consent record or was never created. Nothing here touches money or disputes.
 *
 * Changing the wording means a NEW version id: the stored hash then proves exactly which text was accepted.
 */
export const INDEPENDENT_VENUE_CONSENT_VERSION = "independent-venue-2026-11-16.v1";

export const INDEPENDENT_VENUE_CONSENT_TEXT =
  "Nơi tập này nằm ngoài hệ thống Gymini. Gymini không chịu trách nhiệm đối với hợp đồng tập luyện tại nơi tập ngoài hệ thống Gymini. " +
  "Mọi tranh chấp, khiếu nại phát sinh tại đó do hai bên (học viên và huấn luyện viên) tự chịu trách nhiệm.";

export const INDEPENDENT_VENUE_CONSENT_SHA256 = createHash("sha256")
  .update(INDEPENDENT_VENUE_CONSENT_TEXT, "utf8")
  .digest("hex");

export const INDEPENDENT_VENUE_ACK_REQUIRED = "INDEPENDENT_VENUE_ACK_REQUIRED";
export const INDEPENDENT_VENUE_AUDIT_ACTION = "CONTRACT_INDEPENDENT_VENUE_ACKNOWLEDGED";
/** Audit action of a request accepted WITHOUT the acknowledgement because the app predates the consent step (grace). */
export const INDEPENDENT_VENUE_LEGACY_AUDIT_ACTION = "CONTRACT_INDEPENDENT_VENUE_ACK_MISSING_LEGACY";

/**
 * ── LEGACY GRACE (owner decision 16/11: already-installed older apps must not break) ────────────────────────────────
 *
 * How an OLD app is told from a NEW one: the app version is useless (the rebuilt mobile app is still 1.0.0 and `X-Gymini-Client` is only
 * measured; builds older than U2 send none). So, exactly like `X-Gymini-Listing-Flow` for the amenity step, a NEW client (web and mobile)
 * sends `X-Gymini-Venue-Consent: <integer >= 1>` on POST /contracts/request. Rule, evaluated only when the offline/hybrid + no-gym request
 * carries no `acknowledgedIndependentVenue`:
 *   - capability header present  -> NEW client that skipped the dialog -> REFUSED 409 (no grace, ever);
 *   - capability header absent   -> OLD app (or an old cached web tab) -> accepted while the grace is active, and audited
 *     (AuditLog CONTRACT_INDEPENDENT_VENUE_ACK_MISSING_LEGACY + client_compat_events INDEPENDENT_VENUE_LEGACY_ACCEPTED, same transaction).
 * An explicit `acknowledgedIndependentVenue: false` (or any non-true value) is never grace: only a MISSING field is. The AI-agent path
 * never gets the grace (it has no old installs). Honest limit: a hand-made client can omit the header and the flag, exactly as it could send
 * the flag without showing anything - the consent is a UX/legal record, not a security boundary; the audit row says which case it was.
 *
 * Switches (read on every request, so no restart is needed to flip them in tests; a container restart in dev):
 *   INDEPENDENT_VENUE_LEGACY_GRACE        default ON. "false" / "0" / "off" / "no" turns the grace off (old apps then get the 409).
 *   INDEPENDENT_VENUE_LEGACY_GRACE_UNTIL  optional ISO date/time; from that instant on the grace is off. Unparseable -> ignored (grace stays as
 *                                         the first switch says) and a warning is logged by the caller. Retire the grace when
 *                                         client_compat_events INDEPENDENT_VENUE_LEGACY_ACCEPTED stops growing.
 */
export const VENUE_CONSENT_CAPABILITY_HEADER = "x-gymini-venue-consent";
export const VENUE_CONSENT_CAPABILITY_VERSION = "1";

/** A NEW client: the capability header holds a plain integer >= 1. Missing / empty / anything else = old client. */
export function hasVenueConsentCapability(headerValue: string | string[] | null | undefined): boolean {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return typeof raw === "string" && /^[1-9][0-9]{0,5}$/.test(raw.trim());
}

/** Is the legacy grace on right now? `env`/`now` are injectable for tests. */
export function legacyVenueGraceActive(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): boolean {
  const flag = (env.INDEPENDENT_VENUE_LEGACY_GRACE ?? "").trim().toLowerCase();
  if (["false", "0", "off", "no"].includes(flag)) return false;
  const until = (env.INDEPENDENT_VENUE_LEGACY_GRACE_UNTIL ?? "").trim();
  if (until) {
    const t = Date.parse(until);
    if (Number.isFinite(t) && now.getTime() >= t) return false;
  }
  return true;
}

/** Shown when the flag is missing (old app, or a client that skipped the dialog). Says what to do, in the user's words. */
export const INDEPENDENT_VENUE_ACK_REQUIRED_MESSAGE =
  "Nơi tập nằm ngoài hệ thống Gymini: Gymini không chịu trách nhiệm đối với hợp đồng tại nơi tập này, mọi tranh chấp và khiếu nại " +
  "phát sinh do hai bên tự chịu trách nhiệm. Vui lòng đọc và bấm \"Tôi đồng ý\" để tiếp tục " +
  "(nếu không thấy màn xác nhận, hãy cập nhật ứng dụng lên phiên bản mới nhất), hoặc chọn gói/phòng gym khác.";

/**
 * True when the training venue is outside Gymini: the package is not purely online and no Gymini gym is attached.
 * (An online package has no venue; a package with a gymId runs under the gym agreement, which has its own rules.)
 */
export function isIndependentVenue(sessionMode: SessionMode | string | null | undefined, gymId: string | null | undefined): boolean {
  if (gymId) return false;
  return sessionMode === SessionMode.OFFLINE || sessionMode === SessionMode.HYBRID;
}

/** The audit payload: who/when is the row itself (actor + createdAt); this holds what was accepted. */
export function independentVenueAuditMetadata(input: { sessionMode: string; packageId: string; ptUserId: string; clientHeader?: string | null }) {
  return {
    consentVersion: INDEPENDENT_VENUE_CONSENT_VERSION,
    consentTextSha256: INDEPENDENT_VENUE_CONSENT_SHA256,
    consentText: INDEPENDENT_VENUE_CONSENT_TEXT,
    acknowledgedAt: new Date().toISOString(),
    sessionMode: input.sessionMode,
    packageId: input.packageId,
    ptUserId: input.ptUserId,
    clientHeader: input.clientHeader ?? null,
  };
}
