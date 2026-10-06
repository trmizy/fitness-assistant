import { prisma } from "./profile.repository";

// Mobile Phase 14.2 — see PushDevice in schema.prisma.
export const pushDeviceRepository = {
  // Upsert BY TOKEN: the same phone signing in as another account moves the row to that
  // account instead of leaving the previous owner still subscribed on it.
  register: (token: string, userId: string, platform: string) =>
    prisma.pushDevice.upsert({
      where: { token },
      create: { token, userId, platform },
      update: { userId, platform },
    }),

  // Scoped to the caller: one account can never unsubscribe another account's phone.
  unregister: (token: string, userId: string) =>
    prisma.pushDevice.deleteMany({ where: { token, userId } }),

  tokensForUser: async (userId: string) =>
    (await prisma.pushDevice.findMany({ where: { userId }, select: { token: true } })).map((d) => d.token),

  // FCM reported the token dead (app uninstalled, data cleared, token rotated).
  forget: (token: string) => prisma.pushDevice.deleteMany({ where: { token } }),
};
