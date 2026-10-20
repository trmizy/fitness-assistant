/**
 * Phase 4 (PT Copilot, step 1) — chat overview of roster adherence. Part 1/2 are pure (matcher + formatter); part 3 runs the real
 * fitnessAgent.tryTurn on the ai test DB with only the two fitness/user tool calls stubbed: it proves that the handler is reached only by a
 * PT-side question, that identity is the verified caller's, that failures are said plainly, and that NO model and NO write is involved.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isPtRosterAdherenceQuestion, parseRosterWindow, formatRosterOverview, type RosterView } from "../services/pt-copilot-roster";

test("matcher: PT-side questions about client progress/adherence are recognised in many phrasings (with and without diacritics)", () => {
  for (const q of [
    "Client nào đang chậm tiến độ?",
    "Học viên nào cần chú ý tuần này?",
    "cho tôi biết tình hình các client của tôi",
    "client nao dang bo tap vay",
    "Ai trong số học viên của tôi đang có nguy cơ bỏ tập?",
    "Khách hàng của tôi đang tuân thủ lịch tập thế nào?",
    "Tình trạng tuân thủ của các client trong 1 tháng qua",
    "client nào kém tiến độ nhất",
  ]) assert.equal(isPtRosterAdherenceQuestion(q), true, q);
});

test("matcher: ordinary customer / general messages are NEVER taken over", () => {
  for (const q of [
    "Tiến độ của tôi thế nào?",
    "Tôi tập 4 buổi mỗi tuần, cân nặng của tôi giảm chậm",
    "Tạo lịch tập cho tôi",
    "Protein giúp gì cho cơ bắp?",
    "Tôi muốn trở thành client của PT này",
    "client",
    "chậm tiến độ",
    "Đổi buổi thứ 6 sang thứ 7",
    "",
    "1234",
  ]) assert.equal(isPtRosterAdherenceQuestion(q), false, q);
});

test("window parsing: 7 / 14 (default) / 28 days", () => {
  assert.equal(parseRosterWindow("client nào chậm tiến độ trong 7 ngày"), 7);
  assert.equal(parseRosterWindow("tuần qua học viên nào bỏ tập"), 7);
  assert.equal(parseRosterWindow("tình hình client 1 tháng"), 28);
  assert.equal(parseRosterWindow("client nào chậm tiến độ"), 14);
});

const view = (over: Partial<RosterView> = {}): RosterView => ({
  window: { days: 14 },
  summary: { totalClients: 4, AT_RISK: 1, NEEDS_ATTENTION: 1, ON_TRACK: 1, NO_DATA: 1 },
  clients: [
    { clientUserId: "u-risk-1111", status: "AT_RISK", workout: { scheduled: 5, completed: 1, adherencePercent: 20 }, signals: [{ code: "LOW_ADHERENCE", severity: "HIGH", evidence: "Hoàn thành 1/5 buổi (≈20%) trong 14 ngày gần nhất." }], dataGaps: [] },
    { clientUserId: "u-nolog-2222", status: "NEEDS_ATTENTION", workout: { scheduled: 3, completed: 3, adherencePercent: 100 }, signals: [{ code: "NUTRITION_NOT_LOGGED", severity: "MEDIUM", evidence: "Có thực đơn đang áp dụng nhưng không ghi nhận bữa ăn nào trong 14 ngày gần nhất." }], dataGaps: ["NO_NUTRITION_LOGS"] },
    { clientUserId: "u-empty-3333", status: "NO_DATA", workout: { scheduled: 0, completed: 0, adherencePercent: null }, signals: [], dataGaps: ["NO_SCHEDULED_SESSIONS", "NO_ACTIVE_NUTRITION_PROGRAM"] },
    { clientUserId: "u-good-4444", status: "ON_TRACK", workout: { scheduled: 5, completed: 5, adherencePercent: 100 }, signals: [], dataGaps: [] },
  ],
  ...over,
});

test("formatter: flagged clients with their evidence, no-data clients listed as 'not judged' with the missing data, a read-only closing line", () => {
  const text = formatRosterOverview(view(), new Map([["u-risk-1111", "Nguyễn Văn A"]]));
  assert.match(text, /Tổng hợp 4 client trong 14 ngày gần nhất: 1 cần xử lý ngay, 1 cần chú ý, 1 đang ổn, 1 chưa đủ dữ liệu/);
  assert.match(text, /\*\*Nguyễn Văn A\*\* \(cần xử lý ngay\)/);
  assert.match(text, /Hoàn thành 1\/5 buổi \(≈20%\)/);
  assert.match(text, /Client …2222/, "unknown names get a neutral label, never a guess");
  assert.match(text, /Thiếu dữ liệu: chưa ghi nhận bữa ăn nào/);
  assert.match(text, /Chưa đủ dữ liệu để nhận định.*không đoán/);
  assert.match(text, /chưa chắc có lịch tập|chưa có buổi tập nào được lên lịch/);
  assert.match(text, /1 client còn lại đang ổn/);
  assert.match(text, /mình chưa nhắn tin hay thay đổi gì cho client nào/);
  assert.doesNotMatch(text, /u-risk-1111|u-good-4444/, "raw ids are never shown when a name is known or the client is fine");
});

test("formatter: an empty roster says so plainly (and that only the PT's own active clients are read)", () => {
  const text = formatRosterOverview(view({ summary: { totalClients: 0, AT_RISK: 0, NEEDS_ATTENTION: 0, ON_TRACK: 0, NO_DATA: 0 }, clients: [] }), new Map());
  assert.match(text, /không thấy client nào đang có hợp đồng còn hiệu lực/);
});

test("formatter: long lists are capped and the remainder is counted, not silently dropped", () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ clientUserId: `u-${i}-0000`, status: "AT_RISK" as const, workout: { scheduled: 4, completed: 0, adherencePercent: 0 }, signals: [{ code: "NO_COMPLETED_SESSIONS", severity: "HIGH", evidence: "Chưa hoàn thành buổi nào." }], dataGaps: [] }));
  const text = formatRosterOverview(view({ summary: { totalClients: 11, AT_RISK: 11, NEEDS_ATTENTION: 0, ON_TRACK: 0, NO_DATA: 0 }, clients: many }), new Map());
  assert.equal((text.match(/cần xử lý ngay\):/g) ?? []).length, 8);
  assert.match(text, /…và 3 client khác cũng cần xem xét/);
});

// ── Part 3: through the real agent turn ────────────────────────────────────────────────────────────────
const dbUrl = process.env.DATABASE_URL ?? "";
const canUseDb = /localhost:55433\/[a-z_]*_test(\?|$)/.test(dbUrl);
const dbOpts = { skip: canUseDb ? false : "Requires DATABASE_URL on the isolated ai test DB (localhost:55433/*_test).", timeout: 60_000 };

async function rig() {
  const { prisma } = await import("../repositories/conversation.repository");
  const { fitnessAgent, fitnessAgentDeps } = await import("../services/fitness-agent.service");
  const tools = fitnessAgentDeps.tools as any;
  const saved = { roster: tools.getRosterAdherence, names: tools.getActiveClientNames };
  const userId = `ptc-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "pt copilot" } });
  const seen: Array<{ userId: string; windowDays: number }> = [];
  tools.getRosterAdherence = async (identity: any, windowDays: number) => { seen.push({ userId: identity.userId, windowDays }); return view(); };
  tools.getActiveClientNames = async () => new Map([["u-risk-1111", "Nguyễn Văn A"]]);
  const restore = async () => { tools.getRosterAdherence = saved.roster; tools.getActiveClientNames = saved.names; await prisma.chatSession.deleteMany({ where: { userId } }); };
  return { prisma, fitnessAgent, tools, userId, sessionId: session.id, seen, restore, saved };
}

test("TURN: a PT question is answered from the roster read of the VERIFIED caller, with names, evidence and no blocks/actions", dbOpts, async () => {
  const r = await rig();
  try {
    const out: any = await r.fitnessAgent.tryTurn("Client nào đang chậm tiến độ trong 7 ngày?", { userId: r.userId } as any, r.sessionId);
    assert.ok(out);
    assert.deepEqual(r.seen, [{ userId: r.userId, windowDays: 7 }], "identity and window come from the turn, nothing from the text");
    assert.match(out.answer, /Nguyễn Văn A/);
    assert.match(out.answer, /Hoàn thành 1\/5 buổi/);
    assert.deepEqual(out.blocks, [], "text only: no action card, nothing to confirm");
    assert.equal(await r.prisma.fitnessAgentAction.count({ where: { userId: r.userId } }), 0, "no write of any kind");
  } finally { await r.restore(); await r.prisma.$disconnect(); }
});

test("TURN: a read failure is said plainly (no invented summary); an empty roster is answered truthfully", dbOpts, async () => {
  const r = await rig();
  try {
    r.tools.getRosterAdherence = async () => { throw Object.assign(new Error("Domain service unavailable"), { status: 503 }); };
    const down: any = await r.fitnessAgent.tryTurn("học viên nào cần chú ý", { userId: r.userId } as any, r.sessionId);
    assert.match(down.answer, /chưa đọc được dữ liệu tuân thủ.*chưa nhận định gì/);
    r.tools.getRosterAdherence = async () => view({ summary: { totalClients: 0, AT_RISK: 0, NEEDS_ATTENTION: 0, ON_TRACK: 0, NO_DATA: 0 }, clients: [] });
    let namesCalled = false;
    r.tools.getActiveClientNames = async () => { namesCalled = true; return new Map(); };
    const none: any = await r.fitnessAgent.tryTurn("tình hình các client của tôi", { userId: r.userId } as any, r.sessionId);
    assert.match(none.answer, /không thấy client nào đang có hợp đồng còn hiệu lực/);
    assert.equal(namesCalled, false, "no roster -> no name lookup");
  } finally { await r.restore(); await r.prisma.$disconnect(); }
});

test("TURN: an ordinary customer message does not reach the roster handler at all", dbOpts, async () => {
  const r = await rig();
  try {
    await r.fitnessAgent.tryTurn("Tiến độ của tôi thế nào?", { userId: r.userId } as any, r.sessionId).catch(() => null);
    await r.fitnessAgent.tryTurn("Protein giúp gì cho cơ bắp?", { userId: r.userId } as any, r.sessionId).catch(() => null);
    assert.deepEqual(r.seen, [], "the roster tool was never called for a customer's own questions");
  } finally { await r.restore(); await r.prisma.$disconnect(); }
});
