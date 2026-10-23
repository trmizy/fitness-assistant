/**
 * Which cached lists a server event has just made stale, as react-query key PREFIXES (every key
 * here is followed by a user id or an entity id at its call site, so a prefix reaches them all).
 *
 * A push or a `notification:new` used to update the bell and nothing else: a trainer was told
 * "you have a new coaching request" while Hợp đồng and Tổng quan went on saying there was none
 * until pulled to refresh (real phone, 7/10). Unknown events refresh only the bell.
 */
const BELL: string[][] = [["notifications"], ["notifications-unread"]];

const CONTRACT_LISTS: string[][] = [["pt-contracts"], ["pt-earnings"], ["client-contracts"], ["contract-money"]];

const SESSION_LISTS: string[][] = [
  ["pt-sessions-upcoming"],
  ["pt-contract-sessions"],
  ["sessions-upcoming"],
  ["sessions-pending-confirmation"],
  ["contract-sessions"],
  // A session moves the contract's used/remaining counts too.
  ["pt-contracts"],
  ["client-contracts"],
];

/**
 * A PT listing decision (approved / rejected / changes requested / invalidated) moves the trainer's own
 * "Tin đăng" screen AND what clients read: the trainer list, the detail, the packages, the PT's own
 * profile and package pages.
 */
const PT_LISTING_LISTS: string[][] = [
  ["pt-listing"],
  ["pt-listing-preview"],
  ["pts-list"],
  ["pts-list-pages"],
  ["pt-detail"],
  ["pt-packages"],
  ["pt-service-packages"],
  ["pt-public-profile"],
];

/**
 * A branch listing decision (approved / rejected / changes requested / invalidated) or an amenity proposal decision moves the
 * owner's own "Tin đăng & tiện ích" screen, the branch screens, the application's amenity step AND what clients read
 * (gym directory + detail).
 */
const GYM_LISTING_LISTS: string[][] = [
  ["gym-listing"],
  ["gym-listing-preview"],
  ["owner-amenities"],
  ["owned-gym"],
  ["owned-gyms"],
  ["owned-gym-photos"],
  ["partner-application"],
  ["gyms"],
  ["gym"],
];

export function queryKeysForEvent(eventType: string | null | undefined, entityType?: string | null): string[][] {
  const event = String(eventType ?? "");
  const entity = String(entityType ?? "");
  if (event.startsWith("CONTRACT_") || (!event && entity === "CONTRACT")) return [...BELL, ...CONTRACT_LISTS];
  if (event.startsWith("SESSION_") || (!event && entity === "SESSION")) return [...BELL, ...SESSION_LISTS];
  if (event.startsWith("GYM_LISTING_") || event === "GYM_AMENITY_PROPOSAL_REVIEWED") return [...BELL, ...GYM_LISTING_LISTS];
  if (event.startsWith("PT_LISTING_") || entity === "PT_LISTING") return [...BELL, ...PT_LISTING_LISTS];
  if (event.startsWith("PT_APPLICATION_") || entity === "PT_APPLICATION") return [...BELL, ["pt-application-me"]];
  return BELL;
}
