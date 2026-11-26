/**
 * Calendars split by role: a PT who also trains as a client has sessions in both roles in /sessions/upcoming.
 * TEST FIXTURE (pure functions): the PT schedule keeps ptUserId === me, the client calendar keeps clientUserId === me,
 * the query keys differ by role and by user. Run: npx tsx --test src/app/utils/__tests__/sessionRoleView.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sessionsForRole, upcomingSessionsKey } from "../sessionRoleView";

const ME = "pt-a";
const rows = [
  { id: "teach-1", ptUserId: ME, clientUserId: "c1" },
  { id: "attend-1", ptUserId: "pt-b", clientUserId: ME },
  { id: "teach-2", ptUserId: ME, clientUserId: "c2" },
  { id: "other", ptUserId: "pt-x", clientUserId: "c9" },
];

describe("sessionsForRole", () => {
  it("pt keeps only sessions the user teaches", () => {
    assert.deepEqual(sessionsForRole(rows, "pt", ME).map((s) => s.id), ["teach-1", "teach-2"]);
  });
  it("client keeps only sessions the user attends", () => {
    assert.deepEqual(sessionsForRole(rows, "client", ME).map((s) => s.id), ["attend-1"]);
  });
  it("tolerates a missing list and an unknown user", () => {
    assert.deepEqual(sessionsForRole(undefined, "pt", ME), []);
    assert.equal(sessionsForRole(rows, "pt", undefined).length, rows.length);
  });
});

describe("upcomingSessionsKey", () => {
  it("is role-scoped and identity-scoped, under the shared invalidation prefix", () => {
    assert.notDeepEqual(upcomingSessionsKey("pt", ME), upcomingSessionsKey("client", ME));
    assert.notDeepEqual(upcomingSessionsKey("pt", ME), upcomingSessionsKey("pt", "other"));
    assert.equal(upcomingSessionsKey("pt", ME)[0], "sessions-upcoming");
  });
});

describe("pages use the split (CODE AUDIT)", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  it("PT schedule and dashboard read the pt calendar, the client booking page the client calendar", () => {
    assert.match(read("../../pages/pt/PTSchedulePage.tsx"), /upcomingSessionsKey\("pt"/);
    assert.match(read("../../pages/pt/PTDashboard.tsx"), /upcomingSessionsKey\("pt"/);
    assert.match(read("../../pages/client/BookingPage.tsx"), /upcomingSessionsKey\("client"/);
  });
});
