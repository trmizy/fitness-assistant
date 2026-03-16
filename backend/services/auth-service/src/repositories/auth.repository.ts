import { PrismaClient, Role } from '@prisma/client';

export const prisma = new PrismaClient();

export const authRepository = {
  findUserByEmail: (email: string) =>
    prisma.user.findUnique({ where: { email } }),

  findUserById: (id: string) =>
    prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    }),

  createUser: (data: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    role: Role;
  }) => prisma.user.create({ data }),

  createRefreshToken: (data: { token: string; userId: string; expiresAt: Date }) =>
    prisma.refreshToken.create({ data }),

  findRefreshToken: (token: string) =>
    prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    }),

  deleteRefreshToken: (id: string) =>
    prisma.refreshToken.delete({ where: { id } }),

  deleteRefreshTokenByValue: (token: string) =>
    prisma.refreshToken.deleteMany({ where: { token } }),

  createAuditLog: (data: {
    userId: string;
    action: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: any;
  }) => prisma.auditLog.create({ data }),

  findEmailVerificationByEmail: (email: string) =>
    prisma.emailVerification.findUnique({ where: { email } }),

  upsertEmailVerification: (data: {
    email: string;
    passwordHash: string;
    firstName?: string | null;
    lastName?: string | null;
    otpHash: string;
    expiresAt: Date;
    sentAt: Date;
  }) =>
    prisma.emailVerification.upsert({
      where: { email: data.email },
      create: {
        email: data.email,
        passwordHash: data.passwordHash,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        otpHash: data.otpHash,
        expiresAt: data.expiresAt,
        sentAt: data.sentAt,
      },
      update: {
        passwordHash: data.passwordHash,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        otpHash: data.otpHash,
        expiresAt: data.expiresAt,
        sentAt: data.sentAt,
        attempts: 0,
      },
    }),

  incrementEmailVerificationAttempts: (email: string) =>
    prisma.emailVerification.update({
      where: { email },
      data: { attempts: { increment: 1 } },
    }),

  deleteEmailVerification: (email: string) =>
    prisma.emailVerification.delete({ where: { email } }),
};
