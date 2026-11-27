/**
 * PT discovery free-slot count ("khung giờ trống") also subtracts the hours a trainer is busy AS A CLIENT
 * (sessions where clientUserId = that PT, REQUESTED/CONFIRMED): one person, one clock. Both read paths are checked
 * and must agree: countAvailableSlotsForPTs (3 statements, used by the stats job) and countAvailableSlotsForPTsOneQuery
 * (1 statement, used by the list / search page).
 *
 * Evidence label: BACKEND INTEGRATION (real PostgreSQL *_test DB, TEST FIXTURE rows tagged with a per-run prefix).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";
import { availabilityService, findBookedAsPtOrClient } from "../services/availability.service";

const tag = randomUUID().replace(/-/g, "").slice(0, 8);
const prefix = `crs_${tag}_`;
const ptX = `${prefix}ptX`; // trainer who ALSO trains as a client of ptZ
const ptZ = `${prefix}ptZ`; // teaches ptX
const ptY = `${prefix}ptY`; // control: no sessions at all
const clientW = `${prefix}clientW`; // plain client of ptX
const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;

const from = new Date();
from.setHours(0, 0, 0, 0);
const to = new Date(from);
to.setDate(to.getDate() + 6);
to.setHours(23, 59, 59, 999);

async function cleanup() {
  await prisma.session.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.contract.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.pTAvailability.deleteMany({ where: { ptUserId: { startsWith: prefix } } });
}

function at(dayOffset: number, hour: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

test.before(async () => {
  await cleanup();
  // Every day 09:00-12:00 => 3 one-hour slots/day => 21 slots in the 7-day window.
  for (const pt of [ptX, ptZ, ptY]) {
    await prisma.pTAvailability.createMany({
      data: DAYS.map((d) => ({ ptUserId: pt, dayOfWeek: d, startTime: "09:00", endTime: "12:00" })),
    });
  }
  const cZX = `${prefix}c_ZX`; // ptZ teaches ptX (ptX is the CLIENT)
  const cXW = `${prefix}c_XW`; // ptX teaches clientW
  await prisma.contract.create({ data: { id: cZX, ptUserId: ptZ, clientUserId: ptX, status: "ACTIVE", packageName: "crs", totalSessions: 10 } });
  await prisma.contract.create({ data: { id: cXW, ptUserId: ptX, clientUserId: clientW, status: "ACTIVE", packageName: "crs", totalSessions: 10 } });
  const mk = (i: number, contractId: string, ptUserId: string, clientUserId: string, status: any, day: number, hour: number) =>
    prisma.session.create({
      data: {
        id: `${prefix}s${i}`, contractId, ptUserId, clientUserId, status,
        scheduledStartAt: at(day, hour), scheduledEndAt: at(day, hour + 1),
      },
    });
  // ptX as CLIENT of ptZ
  await mk(1, cZX, ptZ, ptX, "CONFIRMED", 1, 9); // blocks ptX AND ptZ
  await mk(2, cZX, ptZ, ptX, "REQUESTED", 2, 10); // blocks both
  await mk(3, cZX, ptZ, ptX, "CANCELLED", 3, 9); // ignored
  await mk(4, cZX, ptZ, ptX, "COMPLETED", 4, 9); // ignored
  await mk(5, cZX, ptZ, ptX, "CONFIRMED", 20, 9); // outside the window
  // ptX as TEACHER of clientW
  await mk(6, cXW, ptX, clientW, "CONFIRMED", 5, 11); // blocks ptX only
});

test.after(async () => {
  await cleanup();
});

test("client-role hours are subtracted: ptX loses its teaching AND attending sessions, ptZ loses what it teaches, control untouched", async () => {
  const ids = [ptX, ptZ, ptY];
  const three = await availabilityService.countAvailableSlotsForPTs(ids, from, to, 60);
  const one = await availabilityService.countAvailableSlotsForPTsOneQuery(ids, from, to, 60);
  assert.deepEqual(one, three, "one-statement and three-statement counts agree");
  assert.equal(three[ptY], 21, "control: 7 days x 3 slots");
  assert.equal(three[ptZ], 19, "ptZ teaches 2 active sessions (CONFIRMED + REQUESTED)");
  assert.equal(three[ptX], 21 - 2 - 1, "ptX: 2 active sessions as a client + 1 as a teacher; CANCELLED/COMPLETED/out-of-window ignored");
});

test("a PT who is only a client (not in the page as teacher) is still counted; clientW (no availability) stays 0", async () => {
  const one = await availabilityService.countAvailableSlotsForPTsOneQuery([ptX], from, to, 60);
  assert.equal(one[ptX], 18);
  assert.equal((await availabilityService.countAvailableSlotsForPTsOneQuery([clientW], from, to, 60))[clientW], 0);
});

test("single-PT wrapper and the booked-rows helper use the same two-role rule", async () => {
  const rows = await findBookedAsPtOrClient([ptX], from, to);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.ptUserId === ptX));
  // Both PTs on the page: the shared session yields one row per calendar it blocks.
  const both = await findBookedAsPtOrClient([ptX, ptZ], from, to);
  assert.equal(both.filter((r) => r.ptUserId === ptZ).length, 2);
  assert.equal(both.filter((r) => r.ptUserId === ptX).length, 3);
  assert.deepEqual(await findBookedAsPtOrClient([], from, to), []);
});
