import axios from 'axios';
import { logger } from '@gym-coach/shared';
import { NotificationEventType, NotificationEntityType } from '../generated/prisma';
import { notificationRepository } from '../repositories/notification.repository';

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || 'http://chat-service:3005';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';

function pushToSocket(payload: { userId?: string; adminBroadcast?: boolean; notification: any }) {
  axios.post(`${CHAT_SERVICE_URL}/internal/push-notification`, payload, {
    timeout: 3000,
    headers: { 'x-internal-secret': INTERNAL_API_SECRET },
  }).catch((err) => logger.warn({ err }, 'Failed to push realtime notification'));
}

export const notificationService = {
  async create(data: {
    userId: string;
    text: string;
    eventType: string;
    entityType: string;
    entityId: string;
    link?: string;
  }) {
    const notification = await notificationRepository.create({
      userId: data.userId,
      text: data.text,
      eventType: data.eventType as NotificationEventType,
      entityType: data.entityType as NotificationEntityType,
      entityId: data.entityId,
      link: data.link,
    });

    // Push real-time (non-blocking)
    pushToSocket({ userId: data.userId, notification });

    return notification;
  },

  async list(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [notifications, unreadCount] = await Promise.all([
      notificationRepository.findByUser(userId, skip, limit),
      notificationRepository.countUnread(userId),
    ]);
    return { notifications, unreadCount };
  },

  async markRead(id: string, userId: string) {
    return notificationRepository.markRead(id, userId);
  },

  async markAllRead(userId: string) {
    return notificationRepository.markAllRead(userId);
  },

  async getUnreadCount(userId: string) {
    return notificationRepository.countUnread(userId);
  },
};
