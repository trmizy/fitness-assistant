import { guardedTest as test } from "./test-db-guard";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { DayOfWeek, SessionStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { availabilityService } from "../services/availability.service";
import { authServiceClient } from "../clients/auth-service.client";

const DAYS = [
  DayOfWeek.SUNDAY,
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

function futureDay() {
  const day = new Date();
  day.setDate(day.getDate() + 7);
  day.setHours(10, 0, 0, 0);
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return { date, dayOfWeek: DAYS[day.getDay()] };
}

test("planning changes affect future bookable slots but preserve an existing Client session", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const { date, dayOfWeek } = futureDay();
  let server: Server | undefined;
  const originalVerifyToken = authServiceClient.verifyToken;
  const contract = await prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId,
      clientUserId,
      packageName: "Planning integration test",
      totalSessions: 10,
      usedSessions: 0,
      compensatedSessions: 0,
      status: "ACTIVE",
      sessionDurationMinutes: 60,
    },
  });

  try {
    authServiceClient.verifyToken = async (header: string) => ({
      status: 200,
      data: {
        user: {
          id: header === "Bearer pt-test-token" ? ptUserId : clientUserId,
          email: "schedule-test@example.invalid",
          role: header === "Bearer pt-test-token" ? "PT" : "CUSTOMER",
        },
      },
    });
    const { default: app } = await import("../app");
    server = app.listen(0, "127.0.0.1");
    if (!server.listening) await new Promise<void>((resolve) => server!.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`;
    const call = async (method: string, path: string, token?: string, body?: unknown) => {
      const response = await fetch(url + path, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as any };
    };

    const forbidden = await call("PUT", "/availability/me", "client-test-token", {
      slots: [{ dayOfWeek, startTime: "09:00", endTime: "12:00" }],
    });
    assert.equal(forbidden.status, 403);

    await availabilityService.setAvailability(ptUserId, [
      { dayOfWeek, startTime: "09:00", endTime: "12:00" },
    ]);
    const initialSlots = await call("GET", `/availability/${ptUserId}/slots?date=${date}&bookableOnly=true`);
    assert.equal(initialSlots.status, 200);
    assert.deepEqual(initialSlots.body, ["09:00", "10:00", "11:00"]);

    const session = await prisma.session.create({
      data: {
        contractId: contract.id,
        ptUserId,
        clientUserId,
        scheduledStartAt: new Date(`${date}T10:00:00`),
        scheduledEndAt: new Date(`${date}T11:00:00`),
        status: SessionStatus.CONFIRMED,
      },
    });
    assert.deepEqual(await availabilityService.getAvailableSlots(ptUserId, date, true), ["09:00", "11:00"]);

    // Two blocks represent a break; the confirmed session is outside the new hours.
    const changedHttp = await call("PUT", "/availability/me", "pt-test-token", {
      slots: [
        { dayOfWeek, startTime: "13:00", endTime: "14:00" },
        { dayOfWeek, startTime: "15:00", endTime: "17:00" },
      ],
    });
    assert.equal(changedHttp.status, 200);
    const changed = changedHttp.body;
    assert.equal(changed.affectedSessions.some((row: { id: string }) => row.id === session.id), true);
    assert.deepEqual(await availabilityService.getAvailableSlots(ptUserId, date, true), ["13:00", "15:00", "16:00"]);

    const dayOffHttp = await call("POST", "/availability/me/planning-exceptions", "pt-test-token", { date, reason: "Day off" });
    assert.equal(dayOffHttp.status, 201);
    const dayOff = dayOffHttp.body;
    assert.equal(dayOff.affectedSessions, 0);
    assert.deepEqual(await availabilityService.getAvailableSlots(ptUserId, date, true), []);
    const savedSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(savedSession.status, SessionStatus.CONFIRMED);
    assert.equal(savedSession.scheduledStartAt.getTime(), new Date(`${date}T10:00:00`).getTime());
    assert.equal(savedSession.cancelledBy, null);

    await availabilityService.removeException(dayOff.exception.id, ptUserId);
    assert.deepEqual(await availabilityService.getAvailableSlots(ptUserId, date, true), ["13:00", "15:00", "16:00"]);
  } finally {
    authServiceClient.verifyToken = originalVerifyToken;
    if (server?.listening) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    }
    await prisma.pTScheduleException.deleteMany({ where: { ptUserId } });
    await prisma.pTAvailability.deleteMany({ where: { ptUserId } });
    await prisma.contract.delete({ where: { id: contract.id } });
  }
});
