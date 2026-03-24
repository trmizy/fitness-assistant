import { NotificationEventType, NotificationEntityType } from '../generated/prisma';
import { notificationRepository } from '../repositories/notification.repository';

export const notificationService = {
  async create(data: {
    userId: string;
    text: string;
    eventType: string;
    entityType: string;
    entityId: string;
    link?: string;
  }) {
    return notificationRepository.create({
      userId: data.userId,
      text: data.text,
      eventType: data.eventType as NotificationEventType,
      entityType: data.entityType as NotificationEntityType,
      entityId: data.entityId,
      link: data.link,
    });
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
