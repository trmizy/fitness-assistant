/**
 * Calendars split by role (mobile). TEST FIXTURE (pure functions): a PT who also trains as a client has sessions in both
 * roles in /sessions/upcoming; the PT screens keep ptUserId === me, the client screens clientUserId === me, and the
 * query keys are role- and identity-scoped under the "sessions-upcoming" prefix the notification refresh invalidates.
 * Run: npx tsx --test src/features/__tests__/sessionRoleView.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { clientUpcomingKey, normalizeSessions, rawSessionsForRole } from "../services/sessions";
import { sessionsOf } from "../pt/pt";

const ME = "pt-a";
const start = "2030-01-05T07:00:00.000Z";
const rows = [
  { id: "teach-1", ptUserId: ME, clientUserId: "c1", scheduledStartAt: start, status: "CONFIRMED" },
  { id: "attend-1", ptUserId: "pt-b", clientUserId: ME, scheduledStartAt: start, status: "REQUESTED" },
  { id: "other", ptUserId: "pt-x", clientUserId: "c9", scheduledStartAt: start, status: "CONFIRMED" },
];

describe("rawSessionsForRole", () => {
  it("pt keeps only the sessions the user teaches (PT schedule / dashboard)", () => {
    assert.deepEqual(sessionsOf(rawSessionsForRole(rows, "pt", ME)).map((s) => s.id), ["teach-1"]);
  });
  it("client keeps only the sessions the user attends (client booking screen)", () => {
    assert.deepEqual(normalizeSessions(rawSessionsForRole(rows, "client", ME)).map((s) => s.id), ["attend-1"]);
  });
  it("tolerates a missing/odd payload", () => {
    assert.deepEqual(rawSessionsForRole(undefined, "pt", ME), []);
    assert.deepEqual(rawSessionsForRole({ nope: 1 }, "client", ME), []);
  });
});

describe("query keys", () => {
  it("client key is role- and identity-scoped and keeps the invalidation prefix", () => {
    const a = clientUpcomingKey("u1");
    assert.equal(a[0], "sessions-upcoming");
    assert.notDeepEqual(a, clientUpcomingKey("u2"));
    assert.notDeepEqual(a, ["pt-sessions-upcoming", "u1"]);
  });
});

describe("screens use the split (CODE AUDIT)", () => {
  // `npm run test:unit` runs from frontend/mobile, so paths are relative to the package root.
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  it("PT screens ask for as=pt, client screens for as=client", () => {
    assert.match(read("app/pt/schedule.tsx"), /getMyUpcoming\("pt"\)/);
    assert.match(read("app/pt/dashboard.tsx"), /getMyUpcoming\("pt"\)/);
    assert.match(read("app/client/services/booking.tsx"), /getMyUpcoming\("client"\)/);
    assert.match(read("app/client/dashboard.tsx"), /getMyUpcoming\("client"\)/);
  });
});
