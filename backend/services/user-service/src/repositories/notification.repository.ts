import {
  NotificationEventType,
  NotificationEntityType,
} from "../generated/prisma";
import { prisma } from "./profile.repository";

export const notificationRepository = {
  create: (data: {
    userId: string;
    text: string;
    eventType: NotificationEventType;
    entityType: NotificationEntityType;
    entityId: string;
    link?: string;
  }) => prisma.notification.create({ data }),

  findByUser: (userId: string, skip = 0, take = 20) =>
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),

  markRead: (id: string, userId: string) =>
    prisma.notification.updateMany({
      where: { id, userId },
      data: { unread: false },
    }),

  markAllRead: (userId: string) =>
    prisma.notification.updateMany({
      where: { userId, unread: true },
      data: { unread: false },
    }),

  countUnread: (userId: string) =>
    prisma.notification.count({
      where: { userId, unread: true },
    }),

  // Roadmap P4.1 "Notifications/reminders" (§27) — preference controls.
  // No row yet means "everything on" (see NotificationPreference's own
  // schema doc comment) — getOrDefault never creates a row just to read
  // it, only findPreference's caller (notificationService) decides that.
  findPreference: (userId: string) =>
    prisma.notificationPreference.findUnique({ where: { userId } }),

  upsertPreference: (
    userId: string,
    data: Partial<{
      workoutUpcomingEnabled: boolean;
      workoutRescheduledEnabled: boolean;
      workoutUnfinishedEnabled: boolean;
      planUpdatedEnabled: boolean;
      ptFeedbackEnabled: boolean;
    }>,
  ) =>
    prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    }),
};
