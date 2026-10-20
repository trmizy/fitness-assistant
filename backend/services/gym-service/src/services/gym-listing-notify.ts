import { logger } from '@gym-coach/shared';
import { userClient } from '../clients/user.client';

/**
 * Listing Management B2 - owner notifications (plan B22): gym-service -> user-service `/internal/notifications`
 * (best-effort, after commit; the existing complaint flow uses the same path).
 *
 * ON BY DEFAULT since user-service migration 20261020132616_gym_listing_notification_types added the five event
 * types to NotificationEventType. LISTING_GYM_NOTIFICATIONS_ENABLED=false (or 0) turns it off, e.g. for a deploy
 * where gym-service ships before that user-service migration. The flag is read at CALL time.
 */
export type GymListingEventType =
  | 'GYM_LISTING_APPROVED'
  | 'GYM_LISTING_REJECTED'
  | 'GYM_LISTING_CHANGES_REQUESTED'
  | 'GYM_LISTING_INVALIDATED'
  | 'GYM_AMENITY_PROPOSAL_REVIEWED';

export function listingNotificationsEnabled(): boolean {
  const v = (process.env.LISTING_GYM_NOTIFICATIONS_ENABLED ?? '').trim().toLowerCase();
  return v !== 'false' && v !== '0';
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
