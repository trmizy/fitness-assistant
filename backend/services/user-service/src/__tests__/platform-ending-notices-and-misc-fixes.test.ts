/**
 * Fix round 10/11/2026 (no database needed; BACKEND INTEGRATION-level unit tests with the repositories / clients replaced = TEST FIXTURE):
 *  - NB-01: an admin / platform ending (MUTUAL, EXPIRED, SERVICE_DISCONTINUED_BY_PLATFORM) tells the client and the PT, once, after the commit.
 *  - N-A-11: deleting a schedule exception that does not exist is a 404 (was a silent success).
 *  - NE-05: GET /sessions/upcoming falls back to the auth-service name when the user-service profile has none (or no row at all).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { notificationService } from "../services/notification.service";
import {
  platformEndingClientText,
  platformEndingNoticeHooks,
  platformEndingPtText,
} from "../services/contract-termination-notices";
import { registeredTerminationHooks } from "../services/contract-payout.service";
import { availabilityService } from "../services/availability.service";
import { availabilityRepository } from "../repositories/availability.repository";
import { bookingService } from "../services/booking.service";
import { sessionRepository } from "../repositories/session.repository";
import { profileRepository } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const contract = { id: "c1", ptUserId: "pt-1", clientUserId: "cl-1", packageName: "Gói 10 buổi" };

for (const reason of ["MUTUAL", "EXPIRED", "SERVICE_DISCONTINUED_BY_PLATFORM"] as const) {
  test(`NB-01: ${reason} is wired in the termination hook registry`, () => {
    assert.ok(registeredTerminationHooks(reason)?.afterCommit, reason);
  });

  test(`NB-01: ${reason} sends one CONTRACT_CANCELLED notice to the client and one to the PT, with the contract link`, async () => {
    const sent: any[] = [];
    const restore = patch(notificationService, "create", async (n: any) => {
      sent.push(n);
      return n;
    });
    try {
      await platformEndingNoticeHooks(reason).afterCommit!({ contract, terms: {} as any, result: { refund: "920000.00", paid: "920000.00" } } as any);
    } finally {
      restore();
    }
    assert.equal(sent.length, 2);
    const client = sent.find((n) => n.userId === "cl-1");
    const pt = sent.find((n) => n.userId === "pt-1");
    assert.equal(client.eventType, "CONTRACT_CANCELLED");
    assert.equal(client.entityId, "c1");
    assert.equal(client.link, "/client/contracts");
    assert.equal(pt.link, "/pt/contracts");
    assert.equal(client.text, platformEndingClientText(reason, "Gói 10 buổi", "920.000 ₫"));
    assert.equal(pt.text, platformEndingPtText(reason, "Gói 10 buổi"));
    assert.doesNotMatch(pt.text, /₫/, "the PT's notice never carries the client's money");
    assert.match(client.text, /Gói 10 buổi/);
  });
}

test("NB-01: the client's text quotes the credited amount only when the ledger gave one", () => {
  assert.match(platformEndingClientText("MUTUAL", "Gói A", "920.000 ₫"), /hoàn 920\.000 ₫ vào ví/);
  assert.doesNotMatch(platformEndingClientText("MUTUAL", "Gói A", null), /₫/);
  assert.doesNotMatch(platformEndingClientText("EXPIRED", "Gói A", null), /₫/);
});

test("NB-01: a failing notification store is swallowed (the ending is already committed)", async () => {
  const restore = patch(notificationService, "create", async () => {
    throw new Error("down");
  });
  try {
    await platformEndingNoticeHooks("MUTUAL").afterCommit!({ contract, terms: {} as any, result: {} } as any);
  } finally {
    restore();
  }
});

test("NB-01: no contract info = no notices", async () => {
  const sent: any[] = [];
  const restore = patch(notificationService, "create", async (n: any) => sent.push(n));
  try {
    await platformEndingNoticeHooks("EXPIRED").afterCommit!(undefined as any);
  } finally {
    restore();
  }
  assert.equal(sent.length, 0);
});

test("N-A-11: removing an exception that does not exist answers 404", async () => {
  const restore = patch(availabilityRepository, "removeException", async () => ({ count: 0 }));
  try {
    await assert.rejects(
      () => availabilityService.removeException("nope", "pt-1"),
      (e: any) => e.status === 404 && /Không tìm thấy/.test(e.message),
    );
  } finally {
    restore();
  }
});

test("N-A-11: removing an existing exception still succeeds", async () => {
  const restore = patch(availabilityRepository, "removeException", async () => ({ count: 1 }));
  try {
    await availabilityService.removeException("ok", "pt-1");
  } finally {
    restore();
  }
});

function upcomingFixtures(profiles: any[], authUsers: any[]) {
  return [
    patch(sessionRepository, "findUpcomingByUser", async () => [
      { id: "s1", ptUserId: "pt-1", clientUserId: "cl-nameless", scheduledStartAt: new Date() },
      { id: "s2", ptUserId: "pt-1", clientUserId: "cl-norow", scheduledStartAt: new Date() },
      { id: "s3", ptUserId: "pt-1", clientUserId: "cl-named", scheduledStartAt: new Date() },
    ]),
    patch(profileRepository, "findByUserIds", async () => profiles),
    patch(authServiceClient, "internalPost", async (_path: string, body: any) => ({
      status: 200,
      data: { users: authUsers.filter((u) => body.userIds.includes(u.id)) },
    })),
  ];
}

test("NE-05: a PT's upcoming sessions show the client's auth-service name when the profile has none / no row", async () => {
  const restores = upcomingFixtures(
    [
      { userId: "cl-nameless", firstName: null, lastName: null, email: null },
      { userId: "cl-named", firstName: "Hồ Sơ", lastName: "Tên", email: "named@x.test" },
    ],
    [
      { id: "cl-nameless", firstName: "Lan", lastName: "Phạm", email: "lan@x.test" },
      { id: "cl-norow", firstName: "Quân", lastName: "Đỗ", email: "quan@x.test" },
      { id: "cl-named", firstName: "Khác", lastName: "Tên Auth", email: "other@x.test" },
    ],
  );
  try {
    const rows: any[] = await bookingService.getMyUpcoming("pt-1");
    const by = (id: string) => rows.find((r) => r.id === id).clientProfile;
    assert.deepEqual([by("s1").firstName, by("s1").lastName], ["Lan", "Phạm"]);
    assert.deepEqual([by("s2").firstName, by("s2").lastName], ["Quân", "Đỗ"]);
    assert.deepEqual([by("s3").firstName, by("s3").lastName], ["Hồ Sơ", "Tên"], "a name the profile already has is never overridden");
  } finally {
    restores.reverse().forEach((r) => r());
  }
});

test("NE-05: an auth-service outage leaves the sessions readable (names stay empty, never an error)", async () => {
  const restores = upcomingFixtures([{ userId: "cl-nameless", firstName: null, lastName: null, email: null }], []);
  restores.push(
    patch(authServiceClient, "internalPost", async () => {
      throw new Error("auth down");
    }),
  );
  try {
    const rows: any[] = await bookingService.getMyUpcoming("pt-1");
    assert.equal(rows.length, 3);
    assert.equal(rows[0].clientProfile.firstName, null);
  } finally {
    restores.reverse().forEach((r) => r());
  }
});
