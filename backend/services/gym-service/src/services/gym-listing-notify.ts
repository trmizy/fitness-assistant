import { logger } from '@gym-coach/shared';
import { userClient } from '../clients/user.client';

/**
 * Listing Management B2 - owner notifications (plan B22): gym-service -> user-service `/internal/notifications`
 * (best-effort, after commit; the existing complaint flow uses the same path).
 *
 * DISABLED BY DEFAULT behind LISTING_GYM_NOTIFICATIONS_ENABLED. user-service's NotificationEventType enum does not have
 * these five event types yet (they are added by a later user-service change); sending an unknown type would make that
 * endpoint answer with an error for every decision. Turn the flag on only after the enum values exist there.
 * The flag is read at CALL time, so a deploy/test can flip it without a restart of this module.
 */
export type GymListingEventType =
  | 'GYM_LISTING_APPROVED'
  | 'GYM_LISTING_REJECTED'
  | 'GYM_LISTING_CHANGES_REQUESTED'
  | 'GYM_LISTING_INVALIDATED'
  | 'GYM_AMENITY_PROPOSAL_REVIEWED';

export function listingNotificationsEnabled(): boolean {
  return (process.env.LISTING_GYM_NOTIFICATIONS_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export interface ListingNotice {
  userId: string;
  gymId: string;
  eventType: GymListingEventType;
  text: string;
}

/** Sends the notices of one finished action. Never throws; a no-op while the flag is off. Await it only in tests. */
export async function sendListingNotices(notices: readonly ListingNotice[]): Promise<void> {
  if (!listingNotificationsEnabled() || notices.length === 0) return;
  for (const n of notices) {
    try {
      await userClient.notifyUser({
        userId: n.userId,
        text: n.text,
        eventType: n.eventType,
        entityType: 'GYM_BRANCH',
        entityId: n.gymId,
        link: `/gym-owner/listings?gymId=${n.gymId}`,
      });
    } catch (e) {
      logger.warn({ err: (e as Error).message, eventType: n.eventType }, '[GymListing] could not send a notification');
    }
  }
}
