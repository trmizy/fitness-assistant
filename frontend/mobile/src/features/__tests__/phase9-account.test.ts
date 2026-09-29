/**
 * Phase 9 — CL-05 profile, CL-13 wallet, CL-20 notifications helpers. Shapes are the real
 * user-service / payment-service answers (checked 22/9 against john.doe).
 *
 * Runs with: npx tsx --test src/features/__tests__/phase9-account.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { dateOfBirthError, formFromProfile, profilePatch, profileStats } from "../profile/profile";
import { money, parseAmountInput, transactionLabel, withdrawalStatus, withdrawFormError } from "../wallet/wallet";
import { canReportMembership } from "../services/gymDirectory";
import { groupNotifications, normalizeNotifications, notificationMeta, notificationRoute, timeAgo } from "../notifications/notifications";

describe("profile", () => {
  it("stats count trained days, streak and InBody scans", () => {
    const now = new Date(2026, 8, 22, 12);
    const day = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;
    const s = profileStats(
      [
        { date: day(22), state: "completed" },
        { date: day(21), state: "partial" },
        { date: day(20), state: "rest" },
        { date: day(19), state: "completed" },
        { date: day(18), state: "missed" },
        { date: day(10), state: "completed" },
      ],
      [{}, {}, {}],
      now,
    );
    assert.equal(s.sessions, 4);
    assert.equal(s.streak, 3);
    assert.equal(s.inbodyScans, 3);
    assert.deepEqual(profileStats(undefined, null), { sessions: 0, streak: 0, inbodyScans: 0 });
  });

  it("form round-trips the real profile fields; blank inputs are omitted, not zeroed", () => {
    const f = formFromProfile({ goal: "MUSCLE_GAIN", dateOfBirth: "1995-04-02T00:00:00.000Z", heightCm: 175, currentWeight: 71.3, injuries: ["gối"], experienceLevel: null });
    assert.equal(f.dateOfBirth, "1995-04-02");
    assert.equal(f.experienceLevel, "");
    const p = profilePatch({ ...f, heightCm: "", currentWeight: "72,5", injuries: " gối trái, , lưng " });
    assert.equal(p.heightCm, undefined);
    assert.equal(p.currentWeight, 72.5);
    assert.equal(p.experienceLevel, undefined, "unset level is never sent as BEGINNER");
    assert.deepEqual(p.injuries, ["gối trái", "lưng"]);
  });

  it("date of birth validation", () => {
    assert.equal(dateOfBirthError(""), null);
    assert.equal(dateOfBirthError("1995-04-02"), null);
    assert.ok(dateOfBirthError("02/04/1995"));
    assert.ok(dateOfBirthError("2999-01-01"));
  });
});

describe("wallet", () => {
  it("ledger descriptions never leak ids or enums", () => {
    assert.equal(
      transactionLabel("Contract 97aa71d5-3388-4e8b-8740-887f852b6435 termination — refund (CLIENT_CANCELLED)", "CREDIT"),
      "Hoàn tiền hợp đồng PT",
    );
    assert.equal(transactionLabel("PT no-show compensation", "CREDIT"), "Bồi thường PT vắng mặt");
    assert.equal(transactionLabel("Session 1f0e2a3b-1111-2222-3333-444455556666 SETTLED_X", "DEBIT"), "Tiền ra khỏi ví");
    assert.equal(transactionLabel("Quà tặng khai trương", "CREDIT"), "Quà tặng khai trương");
  });

  it("money strings, amount input and the withdraw form", () => {
    assert.equal(money("26353274.61"), 26353274.61);
    assert.equal(money(null), 0);
    assert.equal(parseAmountInput("240.000 đ"), "240000");
    assert.ok(withdrawFormError("", "MB 1", 100));
    assert.ok(withdrawFormError("500", "MB 1", 100));
    assert.ok(withdrawFormError("50", "  ", 100));
    assert.equal(withdrawFormError("50", "MB 1", 100), null);
  });

  it("withdrawal statuses in Vietnamese", () => {
    assert.equal(withdrawalStatus("PAID").label, "Đã chi trả");
    assert.equal(withdrawalStatus("REJECTED").tone, "danger");
  });
});

describe("notifications", () => {
  const raw = {
    notifications: [
      { id: "a", text: "Bạn có một buổi tập hôm nay", eventType: "WORKOUT_UPCOMING", entityType: "WORKOUT_SCHEDULE", entityId: "x", link: "/client/workout", unread: true, createdAt: "2026-09-22T08:00:00" },
      { id: "b", text: "PT đề xuất dời lịch", eventType: "SESSION_RESCHEDULE_REQUESTED", entityType: "SESSION", entityId: "y", link: null, unread: false, createdAt: "2026-09-19T08:00:00" },
      { id: "c", text: "cũ", eventType: "CONTRACT_ACCEPTED", entityType: "CONTRACT", entityId: "z", link: "/client/schedule", unread: false, createdAt: "2026-08-01T08:00:00" },
    ],
    unreadCount: 1,
  };

  it("reads the real envelope", () => {
    const { items, unreadCount } = normalizeNotifications(raw);
    assert.equal(items.length, 3);
    assert.equal(unreadCount, 1);
    assert.deepEqual(normalizeNotifications(null).items, []);
  });

  it("groups by day, newest first", () => {
    const g = groupNotifications(normalizeNotifications(raw).items, new Date(2026, 8, 22, 12));
    assert.deepEqual(g.map((x) => [x.label, x.items.map((i) => i.id)]), [
      ["Hôm nay", ["a"]],
      ["Tuần này", ["b"]],
      ["Trước đó", ["c"]],
    ]);
  });

  it("web links map to mobile screens; entity fallback when link is null; unknown → nothing", () => {
    assert.equal(notificationRoute({ link: "/client/booking", entityType: "SESSION" }), "/client/services/booking");
    assert.equal(notificationRoute({ link: "/client/wallet?tab=x", entityType: null }), "/client/profile/wallet");
    assert.equal(notificationRoute({ link: null, entityType: "SESSION" }), "/client/services/booking");
    assert.equal(notificationRoute({ link: "/admin/dashboard", entityType: null }), null);
  });

  it("titles and time are Vietnamese", () => {
    assert.equal(notificationMeta("SESSION_RESCHEDULE_REQUESTED").title, "Đề xuất dời lịch");
    assert.equal(notificationMeta("SOMETHING_NEW").icon, "bell");
    const now = Date.parse("2026-09-22T12:00:00Z");
    assert.equal(timeAgo("2026-09-22T10:00:00Z", now), "2 giờ trước");
  });
});

describe("report issue window", () => {
  const m = (status: string, endDate: string | null) =>
    ({ id: "m", gymId: "g", planId: "p", status, price: 0, durationDays: 30, totalVisits: null, usedVisits: 0, startDate: null, endDate, createdAt: null });
  const now = new Date("2026-09-22T00:00:00Z");
  it("active always; expired only within 30 days; pending never", () => {
    assert.equal(canReportMembership(m("ACTIVE", null), now), true);
    assert.equal(canReportMembership(m("EXPIRED", "2026-09-01T00:00:00Z"), now), true);
    assert.equal(canReportMembership(m("EXPIRED", "2026-08-01T00:00:00Z"), now), false);
    assert.equal(canReportMembership(m("PENDING_PAYMENT", null), now), false);
  });
});
