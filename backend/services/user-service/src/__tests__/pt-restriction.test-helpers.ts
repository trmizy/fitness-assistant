/**
 * Shared fixtures for the temporary-suspension suites (pt-restriction-*.integration.test.ts).
 *
 * Evidence label of every suite that uses this: BACKEND INTEGRATION against the isolated
 * gymcoach_user_test database (pass DATABASE_URL explicitly — user-service's .env points at dev).
 * payment-service is NOT running: every paymentClient method is replaced at the client boundary by
 * stubPayments() (TEST FIXTURE for that half), which records each call so a test can assert that NO
 * money call was made. notificationService.create is replaced too (it would push to chat-service).
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { notificationService } from "../services/notification.service";

export const DAY = 24 * 3600 * 1000;
export const HOUR = 3600 * 1000;

// D57-6-5: the database NAME must end with _test (was a loose /_test/ match on the whole URL, which the user name gymcoach_test also satisfied).
export { usable, skip } from "./test-db-guard";

export function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

export async function makePt(overrides: Record<string, unknown> = {}): Promise<string> {
  const userId = randomUUID();
  await prisma.userProfile.create({ data: { userId, isPT: true, ...overrides } });
  return userId;
}

export async function makeContract(ptUserId: string, overrides: Record<string, unknown> = {}) {
  return prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId,
      clientUserId: randomUUID(),
      packageName: "Gói 10 buổi",
      totalSessions: 10,
      price: 5_000_000,
      status: "ACTIVE",
      paymentTransactionId: `txn-${randomUUID()}`,
      startDate: new Date(Date.now() - 10 * DAY),
      endDate: new Date(Date.now() + 60 * DAY),
      ...overrides,
    },
  });
}

export async function addSession(
  c: { id: string; ptUserId: string; clientUserId: string },
  status: string,
  start: Date,
  extra: Record<string, unknown> = {},
) {
  return prisma.session.create({
    data: {
      id: randomUUID(),
      contractId: c.id,
      ptUserId: c.ptUserId,
      clientUserId: c.clientUserId,
      status: status as any,
      scheduledStartAt: start,
      scheduledEndAt: new Date(start.getTime() + HOUR),
      ...extra,
    },
  });
}

/** Removes everything a test created. Restriction rows go first-class here too (history is test data). */
export async function cleanup(ptUserIds: string[], contractIds: string[]) {
  await prisma.sessionRescheduleRequest
    .deleteMany({ where: { session: { contractId: { in: contractIds } } } })
    .catch(() => {});
  await prisma.session.deleteMany({ where: { contractId: { in: contractIds } } }).catch(() => {});
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: contractIds } } }).catch(() => {});
  await prisma.notification.deleteMany({ where: { entityId: { in: [...contractIds, ...ptUserIds] } } }).catch(() => {});
  await prisma.auditLog
    .deleteMany({ where: { entityId: { in: [...contractIds, ...ptUserIds] } } })
    .catch(() => {});
  await prisma.ptRestriction.deleteMany({ where: { ptUserId: { in: ptUserIds } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: contractIds } } }).catch(() => {});
  await prisma.pTServicePackage.deleteMany({ where: { ptUserId: { in: ptUserIds } } }).catch(() => {});
  await prisma.pTApplication.deleteMany({ where: { userProfile: { userId: { in: ptUserIds } } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: { in: ptUserIds } } }).catch(() => {});
}

export interface Stubs {
  /** Every paymentClient call, by method name. */
  payments: Array<{ method: string; body: any }>;
  /** Every notification stored (create / createInTx) - or, with realNotifications, nothing (read the table). */
  notified: any[];
  /** Every notification handed to the realtime/phone push (publish). */
  pushed: any[];
  restore: () => void;
}

/**
 * Replaces every money method of paymentClient and the notification boundary. By default
 * notificationService.create AND createInTx record into `notified` instead of writing rows (the notice
 * texts are what those suites assert). With `realNotifications` the rows are REALLY stored in the test
 * database (createInTx / create untouched) and only the push (publish) is captured - for the suites that
 * prove a notice is committed with the state change.
 */
export function stubs(terminateResult: unknown = { refund: "1000000.00" }, opts: { realNotifications?: boolean } = {}): Stubs {
  const payments: Array<{ method: string; body: any }> = [];
  const notified: any[] = [];
  const pushed: any[] = [];
  const restores: Array<() => void> = [
    patch(notificationService, "publish", (n: any) => {
      pushed.push(n);
    }),
  ];
  if (!opts.realNotifications) {
    restores.push(
      patch(notificationService, "create", async (n: any) => {
        notified.push(n);
        return {} as any;
      }),
      patch(notificationService, "createInTx", async (_tx: any, n: any) => {
        notified.push(n);
        return {} as any;
      }),
    );
  }
  for (const method of ["terminate", "releaseSession", "noShow", "lateArrival", "releaseHoldback", "checkout"] as const) {
    restores.push(
      patch(paymentClient, method, async (body: any) => {
        payments.push({ method, body });
        // Phase 0 / D58: user-service only marks a money step SETTLED on a valid confirmation, so the stand-in answers like the
        // real payment-service does - it echoes the termination's reason and held count, reports what a release moved and what
        // a no-show paid. (A test that wants a malformed or failing answer patches the method itself.)
        if (method === "terminate") {
          return {
            reason: body.reason,
            ...(terminateResult as object),
            ...(body.unresolvedSessions > 0 && !(terminateResult as any)?.unresolved
              ? { unresolved: { sessions: body.unresolvedSessions, amountHeld: "0.00", byParty: { pt: "0.00", gym: "0.00", platform: "0.00" } } }
              : {}),
          };
        }
        if (method === "releaseHoldback") return { released: "0.00" };
        if (method === "checkout") return { transactionId: "txn-stub", status: "PENDING", redirectUrl: "http://pay", qrCodeUrl: null, provider: "MOCK" };
        if (method === "releaseSession") return { released: { pt: "450000", gym: "0", platform: "50000" } };
        if (method === "noShow") return { compensation: "500000", shortfall: "0" };
        if (method === "lateArrival") return { shortfall: "0" };
        return {};
      }),
    );
  }
  return { payments, notified, pushed, restore: () => restores.reverse().forEach((r) => r()) };
}

/** The flag and the record must never disagree: ptSuspended === "an active ACCOUNT-scope episode exists" (a contract-scope one never sets it). */
export async function flagMatchesRecord(ptUserId: string): Promise<boolean> {
  const [profile, active] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId: ptUserId }, select: { ptSuspended: true } }),
    prisma.ptRestriction.count({ where: { ptUserId, endedAt: null, scope: "ACCOUNT" } }),
  ]);
  return (profile?.ptSuspended ?? false) === active > 0;
}

/**
 * Gives a PT created by makePt() the APPROVED application the public rule needs (plan §12.7: a trainer is shown to
 * clients only with isPT + an APPROVED application + not suspended + no account-wide restriction). Only the suites
 * that read the public list / detail / package endpoints need it; cleanup() already deletes the row.
 */
export async function approvePtApplication(ptUserId: string): Promise<void> {
  const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: ptUserId }, select: { id: true } });
  await prisma.pTApplication.upsert({
    where: { userProfileId: profile.id },
    update: { status: "APPROVED", approvedAt: new Date() },
    create: { userProfileId: profile.id, status: "APPROVED", approvedAt: new Date() },
  });
}
