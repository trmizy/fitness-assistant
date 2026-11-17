/**
 * N15M-14 (owner decision 16/11/2026) - a client may still train at a venue that is NOT a gym in the Gymini system
 * (an offline / hybrid package requested with no Gymini gym -> the contract is "independent"). Before the request is
 * sent the client must read - and explicitly accept - that Gymini takes no responsibility for the contract there.
 *
 * The server enforces this too (409 INDEPENDENT_VENUE_ACK_REQUIRED unless `acknowledgedIndependentVenue === true`) and
 * records who accepted which text version; this module only decides WHEN the dialog is needed and what it says.
 * Pure: runs under `npx tsx --test`.
 */

export const INDEPENDENT_VENUE_ACK_REQUIRED = "INDEPENDENT_VENUE_ACK_REQUIRED";

export const INDEPENDENT_VENUE_TITLE = "Nơi tập ngoài hệ thống Gymini";
export const INDEPENDENT_VENUE_INTRO =
  "Bạn đang chọn tập ở nơi không thuộc hệ thống phòng gym của Gymini.";
/** Same sentence the server stores (hash + version) as the accepted text - keep the two in step. */
export const INDEPENDENT_VENUE_WARNING =
  "Gymini không chịu trách nhiệm đối với hợp đồng tập luyện tại nơi tập ngoài hệ thống Gymini. " +
  "Mọi tranh chấp, khiếu nại phát sinh tại đó do hai bên (học viên và huấn luyện viên) tự chịu trách nhiệm.";
export const INDEPENDENT_VENUE_AGREE = "Tôi đồng ý";
export const INDEPENDENT_VENUE_DECLINE = "Chọn gói/PT khác";
/** Small note for the contract detail, both parties. */
export const INDEPENDENT_VENUE_NOTE = "Nơi tập ngoài hệ thống Gymini — hai bên tự chịu trách nhiệm";

/** True when the venue is outside Gymini: the package is not purely online and no Gymini gym is attached. */
export function isIndependentVenue(
  sessionMode: string | null | undefined,
  gymId: string | null | undefined,
): boolean {
  if (gymId) return false;
  return sessionMode === "OFFLINE" || sessionMode === "HYBRID";
}

/** The server's 409 asking for the acknowledgement (e.g. the package switched to offline after the page loaded). */
export function readIndependentVenueRequired(error: any): boolean {
  return error?.response?.status === 409 && error?.response?.data?.code === INDEPENDENT_VENUE_ACK_REQUIRED;
}

/**
 * Gate for the submit button. `acknowledged` is whether the client already pressed "Tôi đồng ý" for THIS package + venue.
 * Returns what to do: "dialog" (show the warning first) or "send" (go ahead).
 */
export function venueGate(input: {
  sessionMode: string | null | undefined;
  gymId: string | null | undefined;
  acknowledged: boolean;
}): "dialog" | "send" {
  return isIndependentVenue(input.sessionMode, input.gymId) && !input.acknowledged ? "dialog" : "send";
}

/** Body field: only ever `true`, and only when the venue really is independent (never sent for an online / gym contract). */
export function venueAckField(input: {
  sessionMode: string | null | undefined;
  gymId: string | null | undefined;
  acknowledged: boolean;
}): { acknowledgedIndependentVenue?: true } {
  return isIndependentVenue(input.sessionMode, input.gymId) && input.acknowledged
    ? { acknowledgedIndependentVenue: true }
    : {};
}
