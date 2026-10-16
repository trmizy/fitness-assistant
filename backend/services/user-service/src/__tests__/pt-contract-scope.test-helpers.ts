/**
 * Fixtures for the CONTRACT-scope restriction suites (pt-restriction-contract-scope*.integration.test.ts).
 * Same evidence rules as pt-restriction.test-helpers.ts: BACKEND INTEGRATION against gymcoach_user_test,
 * payment-service / notification push stubbed at the client boundary (TEST FIXTURE).
 *
 * The cast: PT "An" has four ACTIVE contracts - with Bình, Chi, Dũng and Em. The scenarios restrict only
 * An-Bình and prove the other three clients (and An himself) are not touched.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { authServiceClient } from "../clients/auth-service.client";
import { patch, makeContract, makePt, DAY } from "./pt-restriction.test-helpers";

export const ADMIN = "admin-1";
export const SERVICE_SECRET = { "x-service-secret": "dev_internal_service_secret_change_in_production" };
export const CONTRACT_CODE = "CONTRACT_PAUSED_BY_ADMIN";
export const ACCOUNT_CODE = "PT_TEMPORARILY_UNAVAILABLE";

export type Name = "binh" | "chi" | "dung" | "em";
export const NAMES: Name[] = ["binh", "chi", "dung", "em"];

/** An and his four contracts. `contracts[name].clientUserId` is that client's id. */
export async function makeAn(over: Record<string, unknown> = {}) {
  const pt = await makePt();
  const contracts = {} as Record<Name, Awaited<ReturnType<typeof makeContract>>>;
  for (const n of NAMES) {
    contracts[n] = await makeContract(pt, { packageName: `Gói ${n}`, sessionDurationMinutes: 60, ...over });
  }
  const ids = NAMES.map((n) => contracts[n].id);
  return { pt, contracts, ids };
}

// ── a tiny HTTP harness over the real Express app (auth-service identity table = TEST FIXTURE) ──

const identities = new Map<string, { id: string; email: string; role: string }>();

export function tokenFor(id: string, role: string): string {
  const token = `tok-${id}`;
  identities.set(token, { id, email: `${id}@test.local`, role });
  return token;
}

export interface App {
  call(method: string, path: string, token: string | null, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }>;
  close(): Promise<void>;
}

export async function startApp(): Promise<App> {
  const restoreAuth = patch(authServiceClient, "verifyToken", async (header: string) => {
    const user = identities.get(String(header).replace(/^Bearer /, ""));
    if (!user) throw Object.assign(new Error("bad token"), { response: { status: 401, data: { error: "Invalid or expired token" } } });
    return { status: 200, data: { user } };
  });
  const { default: app } = await import("../app");
  const server: http.Server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  return {
    async call(method, path, token, body, headers = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: res.status, body: json };
    },
    async close() {
      restoreAuth();
      (server as any).closeAllConnections?.();
      await new Promise((r) => server.close(r));
    },
  };
}

/** A weekday availability row so bookSession finds a slot: returns the date/time strings to book. */
export async function openSlotFor(ptUserId: string, daysAhead = 30) {
  const { prisma } = await import("../repositories/profile.repository");
  const { DayOfWeek } = await import("../generated/prisma");
  const map: Record<number, any> = {
    0: DayOfWeek.SUNDAY,
    1: DayOfWeek.MONDAY,
    2: DayOfWeek.TUESDAY,
    3: DayOfWeek.WEDNESDAY,
    4: DayOfWeek.THURSDAY,
    5: DayOfWeek.FRIDAY,
    6: DayOfWeek.SATURDAY,
  };
  const startAt = new Date(Date.now() + daysAhead * DAY);
  startAt.setHours(10, 0, 0, 0);
  await prisma.pTAvailability.create({
    data: { ptUserId, dayOfWeek: map[startAt.getDay()], startTime: "00:00", endTime: "23:59", isActive: true },
  });
  return { scheduledDate: startAt.toISOString().slice(0, 10), scheduledTime: "10:00" };
}

export const newClient = () => randomUUID();
