/**
 * Phase 3 (AI plan) — roadmap TIME CONTRACT (audit BDG-18). Pure unit tests: many independent phrasings, units, "no limit", ambiguity,
 * frequency look-alikes and the disclosure texts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAgentText } from "../services/fitness-agent-intent";
import {
  parseRoadmapTimeframe, resolveRoadmapTimeframe, timeframeForGenerator, draftTotalWeeks, timeframeMet, describeTimeframe,
  DEFAULT_ROADMAP_TIMEFRAME_WEEKS, MAX_ROADMAP_TIMEFRAME_WEEKS,
} from "../services/revision/roadmap-timeframe";

const parse = (t: string) => parseRoadmapTimeframe(normalizeAgentText(t));
const weeks = (t: string) => { const r = parse(t); return r.kind === "WEEKS" ? r.weeks : r.kind; };

test("a stated deadline in weeks / months / days / years / half-year is converted to whole weeks", () => {
  assert.equal(weeks("Tạo lộ trình 12 tuần cho tôi"), 12);
  assert.equal(weeks("tao lo trinh trong 8 tuan"), 8);
  assert.equal(weeks("Tôi muốn giảm 5kg trong 3 tháng"), 13);
  assert.equal(weeks("lộ trình 6 tháng"), 26);
  assert.equal(weeks("trong 90 ngày"), 13);
  assert.equal(weeks("lộ trình 1 năm"), 52);
  assert.equal(weeks("kế hoạch một năm"), 52);
  assert.equal(weeks("nửa năm là đủ"), 26);
  assert.equal(weeks("khoảng 2 năm"), 104);
  assert.equal(weeks("Lộ trình 10 tuần, 4 buổi mỗi tuần"), 10, "'4 buổi mỗi tuần' is a frequency, not a second deadline");
  assert.equal(weeks("trong 1,5 tháng"), 7);
});

test("over the 104-week cap -> capped and flagged, never silently larger", () => {
  assert.deepEqual(parse("lộ trình 3 năm"), { kind: "WEEKS", weeks: MAX_ROADMAP_TIMEFRAME_WEEKS, capped: true });
});

test("'no time limit' in many phrasings -> UNLIMITED (never a hidden number)", () => {
  for (const t of ["Tạo lộ trình không giới hạn thời gian", "không đặt thời hạn", "tôi không cần thời hạn", "thoải mái thời gian", "bao lâu cũng được", "lộ trình lâu dài", "không có deadline", "không vội"]) {
    assert.equal(parse(t).kind, "UNLIMITED", t);
  }
  assert.equal(timeframeForGenerator({ source: "UNLIMITED", weeks: null }), undefined);
});

test("nothing about time -> UNSPECIFIED; frequencies and unrelated numbers are not deadlines", () => {
  for (const t of ["Tạo lộ trình cho tôi", "tôi nặng 78 kg, cao 175 cm", "tập 4 buổi mỗi tuần", "cứ mỗi 2 tuần đo một lần", "giảm 5 kg", "tôi 30 tuổi"]) {
    assert.equal(parse(t).kind, "UNSPECIFIED", t);
  }
});

test("conflicting statements -> AMBIGUOUS (the agent must ask, not guess)", () => {
  assert.equal(parse("không giới hạn thời gian nhưng muốn xong trong 12 tuần").kind, "AMBIGUOUS");
  assert.equal(parse("12 tuần hoặc 6 tháng").kind, "AMBIGUOUS");
  assert.equal(parse("8 tuần").kind, "WEEKS");
});

test("resolve: newest explicit statement wins; default only when nothing was said; ambiguity is surfaced", () => {
  assert.deepEqual(resolveRoadmapTimeframe(["ok tạo đi", "tạo lộ trình 12 tuần"]), { timeframe: { source: "USER", weeks: 12, capped: false } });
  assert.deepEqual(resolveRoadmapTimeframe(["đổi sang 8 tuần", "tạo lộ trình 12 tuần"]), { timeframe: { source: "USER", weeks: 8, capped: false } }, "newest wins");
  assert.deepEqual(resolveRoadmapTimeframe(["ok", "không giới hạn thời gian"]), { timeframe: { source: "UNLIMITED", weeks: null } });
  assert.deepEqual(resolveRoadmapTimeframe(["tạo lộ trình cho tôi", "tôi 30 tuổi"]), { timeframe: { source: "DEFAULT", weeks: DEFAULT_ROADMAP_TIMEFRAME_WEEKS } });
  assert.deepEqual(resolveRoadmapTimeframe([]), { timeframe: { source: "DEFAULT", weeks: DEFAULT_ROADMAP_TIMEFRAME_WEEKS } });
  assert.ok("ambiguous" in resolveRoadmapTimeframe(["12 tuần hoặc 6 tháng"]));
});

test("draftTotalWeeks sums phase dates (fallback: planned durations); timeframeMet allows max(1 week, 10%)", () => {
  const d = { phases: [
    { plannedStartAt: "2026-11-02T00:00:00Z", plannedEndAt: "2026-11-30T00:00:00Z" },
    { plannedStartAt: "2026-11-30T00:00:00Z", plannedEndAt: "2027-01-25T00:00:00Z" },
  ] };
  assert.equal(draftTotalWeeks(d), 12);
  assert.equal(draftTotalWeeks({ phases: [{ plannedDurationWeeks: 6 }, { plannedDurationWeeks: 4 }] }), 10);
  assert.equal(draftTotalWeeks(null), 0);
  assert.equal(timeframeMet(12, 12), true);
  assert.equal(timeframeMet(12, 13), true);
  assert.equal(timeframeMet(12, 14), false);
  assert.equal(timeframeMet(40, 44), true);
  assert.equal(timeframeMet(40, 45), false);
});

test("disclosure texts are truthful for every source and never claim a length the draft does not have", () => {
  assert.match(describeTimeframe({ source: "DEFAULT", weeks: 16 }, 16), /chưa nêu thời hạn nên mình dùng mặc định 16 tuần/);
  assert.match(describeTimeframe({ source: "DEFAULT", weeks: 16 }, 24), /thực tế dài 24 tuần/);
  assert.match(describeTimeframe({ source: "UNLIMITED", weeks: null }, 20), /không ép khung thời gian.*20 tuần/);
  assert.match(describeTimeframe({ source: "USER", weeks: 12, capped: false }, 12), /Lộ trình dài 12 tuần theo yêu cầu/);
  const mismatch = describeTimeframe({ source: "USER", weeks: 12, capped: false }, 24);
  assert.match(mismatch, /yêu cầu 12 tuần nhưng AI chỉ xếp được 24 tuần/);
  assert.match(mismatch, /đổi sang 12 tuần/);
  assert.match(describeTimeframe({ source: "USER", weeks: 104, capped: true }, 104), /tối đa 104 tuần/);
});
