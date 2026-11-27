/**
 * TEST FIXTURE (pure functions) - member search of the Hội viên tab (`GET /owner/gyms/:gymId/memberships?q=`):
 * who gets the box, what is typed vs what is asked, the six documented API answers, the summary sentence, and a source guard
 * that the page never filters the loaded rows itself and never searches email / phone.
 * Run: npx tsx --test src/app/features/gym-owner/__tests__/memberSearchModel.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MEMBER_SEARCH_MAX_LENGTH,
  MEMBER_SEARCH_MIN_LENGTH,
  canSearchMembers,
  memberSearchError,
  pageSummary,
  parseMemberSearchInput,
} from "../members/membersModel";
import { canOf } from "./permFixture";

const http = (status: number, code?: string) => ({ response: { status, data: { success: false, error: code ? { code, message: code } : {} } } });

describe("member search: who may search", () => {
  it("owner and manager get the box, accountant and receptionist do not", () => {
    for (const [role, want] of [["OWNER", true], ["MANAGER", true], ["ACCOUNTANT", false], ["RECEPTIONIST", false]] as const) {
      assert.equal(canSearchMembers(canOf(role)), want, role);
    }
  });
});

describe("member search: typed text vs the term that is asked", () => {
  it("nothing typed is idle; fewer than 2 visible characters makes no call", () => {
    assert.deepEqual(parseMemberSearchInput(""), { state: "idle", term: "" });
    assert.deepEqual(parseMemberSearchInput("   "), { state: "idle", term: "" });
    assert.equal(parseMemberSearchInput("a").state, "short");
    assert.equal(parseMemberSearchInput(" a ").state, "short");
    assert.equal(parseMemberSearchInput("́́").state, "short"); // only combining marks = nothing visible
  });
  it("two characters or more is ready, trimmed, accents kept for the server to fold", () => {
    assert.deepEqual(parseMemberSearchInput("  Nguyễn  "), { state: "ready", term: "Nguyễn" });
    assert.equal(parseMemberSearchInput("an").state, "ready");
    assert.equal(MEMBER_SEARCH_MIN_LENGTH, 2);
  });
  it("never sends more than 64 characters", () => {
    const r = parseMemberSearchInput("x".repeat(100));
    assert.equal(r.state, "ready");
    assert.equal(r.term.length, MEMBER_SEARCH_MAX_LENGTH);
  });
});

describe("member search: every documented error has its own sentence and is never an empty result", () => {
  const cases: [number, string, string, boolean][] = [
    [400, "INVALID_QUERY", "invalid", false],
    [429, "SEARCH_RATE_LIMITED", "rate-limited", true],
    [422, "MEMBER_SEARCH_TOO_BROAD", "too-broad", false],
    [503, "MEMBER_SEARCH_UNAVAILABLE", "unavailable", true],
    [403, "MEMBER_SEARCH_FORBIDDEN", "forbidden", false],
  ];
  for (const [status, code, kind, retryable] of cases) {
    it(`${status} ${code}`, () => {
      const e = memberSearchError(http(status, code));
      assert.equal(e.kind, kind);
      assert.equal(e.retryable, retryable);
      assert.ok(e.message.length > 10 && /[à-ỹ]/i.test(e.message), "Vietnamese sentence");
      assert.ok(!/MEMBER_SEARCH|INVALID_QUERY|SEARCH_RATE/.test(e.message), "no internal code in the sentence");
    });
  }
  it("the code decides even when the status is odd, and a status alone still maps", () => {
    assert.equal(memberSearchError(http(500, "MEMBER_SEARCH_UNAVAILABLE")).kind, "unavailable");
    assert.equal(memberSearchError(http(429)).kind, "rate-limited");
  });
  it("network error / unknown error is 'other', retryable, and says the answer is unknown", () => {
    for (const err of [new Error("Network Error"), null, http(500)]) {
      const e = memberSearchError(err);
      assert.equal(e.kind, "other");
      assert.equal(e.retryable, true);
      assert.match(e.message, /Chưa kết luận/);
    }
  });
});

describe("member search: summary sentence", () => {
  it("names the term and the status filter, and keeps the paging claim honest", () => {
    assert.equal(pageSummary(3, false, "full", "all", "Lan"), 'Đã tải hết 3 hội viên khớp "Lan", mới nhất trước.');
    assert.match(pageSummary(100, true, "full", "ACTIVE", "Lan"), /khớp "Lan" thuộc nhóm "Đang hoạt động".*Xem thêm/);
    assert.equal(pageSummary(2, false, "full", "all"), "Đã tải hết 2 hội viên, mới nhất trước.");
  });
});

describe("member search: source guard (CODE AUDIT)", () => {
  const tab = readFileSync(new URL("../members/MembersTab.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../../../services/api.ts", import.meta.url), "utf8");
  it("the term goes to the server through the query key, the abort signal and `q`, not through a filter on the loaded rows", () => {
    assert.match(tab, /queryKey: goKey\(scope, "members", \{ status, q: term \}\)/);
    assert.match(tab, /queryFn: async \(\{ pageParam, signal \}\)/);
    assert.match(tab, /q: term \|\| undefined/);
    assert.ok(!/filterMembers|applyMemberView/.test(tab), "no client-side filtering of the page");
  });
  it("the box is only drawn for roles that may search, and the page says it does not search email / phone", () => {
    assert.match(tab, /\{searchable && \(/);
    assert.match(tab, /Không tìm theo email hay số điện thoại/);
    assert.ok(!/memberCode.*includes|email.*includes|phone.*includes/i.test(tab));
  });
  it("the api sends q only when it has a value, with the abort signal", () => {
    assert.match(api, /q: params\.q \|\| undefined/);
    assert.match(api, /signal,\n\s*\}\);\n\s*const items = \(data\?\.data \?\? \[\]\) as GymMembershipContract\[\]/);
  });
});
