/**
 * Phase 4 (PT Copilot, step 2) — DRAFTED proposals for a PT to approve (plan §5.3: nothing is sent, no client data changes).
 * Part 1: pure (matcher, client choice only inside the roster, template content). Part 2: real fitnessAgent.tryTurn / execute / dismissDraft on the
 * ai test DB with only the fitness/user tool calls stubbed and COUNTED — the point is what is NOT called.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isPtProposalRequest, pickProposalClient, buildClientProposals, greetingName, proposalLines } from "../services/pt-copilot-proposals";
import type { RosterRowView } from "../services/pt-copilot-roster";

const row = (id: string, status: RosterRowView["status"], over: Partial<RosterRowView> = {}): RosterRowView => ({
  clientUserId: id, status, workout: { scheduled: 5, completed: 1, adherencePercent: 20 },
  signals: status === "AT_RISK" ? [{ code: "LOW_ADHERENCE", severity: "HIGH", evidence: "Hoàn thành 1/5 buổi (≈20%) trong 14 ngày gần nhất." }] : [], dataGaps: [], ...over,
});
const rows: RosterRowView[] = [
  row("u-risk-1111", "AT_RISK"),
  row("u-nolog-2222", "NEEDS_ATTENTION", { workout: { scheduled: 3, completed: 3, adherencePercent: 100 }, signals: [{ code: "NUTRITION_NOT_LOGGED", severity: "MEDIUM", evidence: "Có thực đơn đang áp dụng nhưng không ghi nhận bữa ăn nào trong 14 ngày gần nhất." }], dataGaps: ["NO_NUTRITION_LOGS"] }),
  row("u-good-3333", "ON_TRACK", { workout: { scheduled: 5, completed: 5, adherencePercent: 100 } }),
  row("u-empty-4444", "NO_DATA", { workout: { scheduled: 0, completed: 0, adherencePercent: null }, dataGaps: ["NO_SCHEDULED_SESSIONS", "NO_ACTIVE_NUTRITION_PROGRAM"] }),
];
const names = new Map([["u-risk-1111", "Nguyễn Văn An"], ["u-nolog-2222", "Trần Thị Bình"], ["u-good-3333", "Lê Văn An"], ["u-empty-4444", "dung.pham@example.com"]]);

test("matcher: a PT asking to DRAFT/PROPOSE something about clients; the plain overview question and customer messages are not proposal requests", () => {
  for (const q of [
    "Đề xuất cách xử lý cho client chậm tiến độ",
    "Soạn tin nhắn nhắc nhở học viên bỏ tập giúp tôi",
    "Tôi nên làm gì với client An?",
    "de xuat huong tiep can voi hoc vien cua toi",
    "gợi ý cách chăm sóc client Bình",
  ]) assert.equal(isPtProposalRequest(q), true, q);
  for (const q of ["Client nào đang chậm tiến độ?", "Đề xuất cho tôi một lịch tập", "Tôi nên làm gì để giảm cân?", "Soạn thực đơn cho tôi", "client"]) assert.equal(isPtProposalRequest(q), false, q);
});

test("client choice happens ONLY inside the roster: by name, ambiguous, unknown name, or (no name) the client who needs attention most", () => {
  const one: any = pickProposalClient("Đề xuất cho client Bình", rows, names);
  assert.equal(one.kind, "CLIENT"); assert.equal(one.row.clientUserId, "u-nolog-2222");
  assert.equal((pickProposalClient("soạn tin nhắn cho học viên An", rows, names) as any).kind, "AMBIGUOUS");
  assert.equal(pickProposalClient("đề xuất cho client Hoàng", rows, names).kind, "NOT_FOUND", "a name that matches nobody on the roster");
  const top: any = pickProposalClient("Đề xuất cách xử lý cho client cần chú ý", rows, names);
  assert.equal(top.kind, "CLIENT"); assert.equal(top.row.clientUserId, "u-risk-1111", "default = most in need");
  assert.equal(pickProposalClient("đề xuất xử lý client", rows.filter((r) => r.status === "ON_TRACK"), names).kind, "NONE_FLAGGED");
  assert.equal((pickProposalClient("đề xuất cho client dung", rows, names) as any).row.clientUserId, "u-empty-4444", "email local part is a usable handle for matching");
});

test("proposals: drafted from the real evidence numbers; the message greets by first name, never by email/id; at most 4; deduplicated by type", () => {
  const risk = buildClientProposals(rows[0], "Nguyễn Văn An", 14);
  assert.deepEqual(risk.map((p) => p.type), ["MESSAGE_DRAFT", "PLAN_REVIEW_SUGGESTION"]);
  assert.match(risk[0].body, /^Chào An,/);
  assert.match(risk[0].body, /1\/5 buổi/);
  assert.deepEqual(risk[0].basedOn, ["Hoàn thành 1/5 buổi (≈20%) trong 14 ngày gần nhất."]);
  const zero = buildClientProposals(row("z", "AT_RISK", { workout: { scheduled: 4, completed: 0, adherencePercent: 0 }, signals: [{ code: "NO_COMPLETED_SESSIONS", severity: "HIGH", evidence: "Chưa hoàn thành buổi nào trong 4 buổi đã lên lịch (14 ngày gần nhất)." }] }), "dung.pham@example.com", 14);
  assert.match(zero[0].body, /^Chào bạn,/);
  assert.doesNotMatch(JSON.stringify(zero), /example\.com|dung\.pham/, "the email is never put into a message");
  assert.equal(greetingName("Client …1111"), "bạn");
  const nolog = buildClientProposals(rows[1], "Trần Thị Bình", 14);
  assert.deepEqual(nolog.map((p) => p.type), ["CHECKIN_QUESTION"]);
  const none = buildClientProposals(rows[3], "x@y.z", 14);
  assert.deepEqual(none.map((p) => p.type), ["ASSIGN_PLAN_SUGGESTION"], "no scheduled sessions -> suggests assigning a plan, judges nothing");
  assert.deepEqual(buildClientProposals(rows[2], "Lê Văn An", 14), [], "a client who is fine gets no proposal");
  assert.ok(buildClientProposals(rows[0], "A", 14).length <= 4);
});

test("proposal text never contains medical claims, promises or diagnoses", () => {
  const all = [rows[0], rows[1], rows[3]].flatMap((r) => buildClientProposals(r, "Bình", 14)).map((p) => p.body).join("\n");
  assert.doesNotMatch(all, /chẩn đoán|bệnh|chấn thương|đảm bảo|cam kết|chắc chắn sẽ|thuốc|giảm \d+ ?kg/i);
  assert.equal(proposalLines(buildClientProposals(rows[0], "An", 14))[0].startsWith("[Tin nhắn]"), true);
});

// ── Part 2: through the real agent turn ────────────────────────────────────────────────────────────────
const dbUrl = process.env.DATABASE_URL ?? "";
const canUseDb = /localhost:55433\/[a-z_]*_test(\?|$)/.test(dbUrl);
const dbOpts = { skip: canUseDb ? false : "Requires DATABASE_URL on the isolated ai test DB (localhost:55433/*_test).", timeout: 60_000 };

async function rig(opts: { decision?: "ok" | "forbidden" | "down" } = {}) {
  const { prisma } = await import("../repositories/conversation.repository");
  const { fitnessAgent, fitnessAgentDeps } = await import("../services/fitness-agent.service");
  const tools = fitnessAgentDeps.tools as any;
  const saved = { roster: tools.getRosterAdherence, names: tools.getActiveClientNames, decide: tools.recordPtProposalDecision };
  const userId = `ptp-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "pt proposals" } });
  const decisions: any[] = []; let rosterCalls = 0;
  const view = { window: { days: 14 }, summary: { totalClients: 4, AT_RISK: 1, NEEDS_ATTENTION: 1, ON_TRACK: 1, NO_DATA: 1 }, clients: rows };
  tools.getRosterAdherence = async () => { rosterCalls++; return view; };
  tools.getActiveClientNames = async () => names;
  const state = { mode: opts.decision ?? "ok" };
  tools.recordPtProposalDecision = async (_id: any, clientUserId: string, input: any) => {
    decisions.push({ clientUserId, ...input });
    if (state.mode === "forbidden") throw Object.assign(new Error("No active PT-client relationship with this client"), { status: 403 });
    if (state.mode === "down") throw Object.assign(new Error("Domain service unavailable"), { status: 503 });
    return { success: true, data: { recorded: true } };
  };
  const identity = { userId } as any;
  const restore = async () => { tools.getRosterAdherence = saved.roster; tools.getActiveClientNames = saved.names; tools.recordPtProposalDecision = saved.decide; await prisma.fitnessAgentAction.deleteMany({ where: { userId } }); await prisma.chatSession.deleteMany({ where: { userId } }); };
  return { prisma, fitnessAgent, userId, sessionId: session.id, identity, decisions, state, rosterCalls: () => rosterCalls, restore };
}

test("TURN: a proposal request drafts proposals for the right roster client, stores ONE pending action, and records/sends NOTHING", dbOpts, async () => {
  const r = await rig();
  try {
    const out: any = await r.fitnessAgent.tryTurn("Đề xuất cách xử lý cho client Bình", r.identity, r.sessionId);
    assert.ok(out);
    const block = out.blocks[0];
    assert.equal(block.type, "ACTION_CONFIRMATION");
    assert.equal(block.kind, "PT_CLIENT_ACTION_PROPOSAL");
    assert.equal(block.summary.clientLabel, "Trần Thị Bình");
    assert.deepEqual(block.summary.proposals.map((p: any) => p.type), ["CHECKIN_QUESTION"]);
    assert.match(block.note, /không gửi gì cho client/);
    assert.match(out.answer, /KHÔNG gửi tin nhắn và KHÔNG thay đổi dữ liệu/);
    assert.deepEqual(r.decisions, [], "nothing is recorded until the PT approves");
    const rows = await r.prisma.fitnessAgentAction.findMany({ where: { userId: r.userId } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "PT_CLIENT_ACTION_PROPOSAL");
    assert.equal(rows[0].status, "PENDING");
    assert.equal((rows[0].payload as any).clientUserId, "u-nolog-2222");
  } finally { await r.restore(); await r.prisma.$disconnect(); }
});

test("TURN: unknown name / ambiguous name / nobody flagged -> an honest reply and NO action row; a name outside the roster is never confirmed to exist", dbOpts, async () => {
  const r = await rig();
  try {
    const none: any = await r.fitnessAgent.tryTurn("đề xuất cho client Hoàng", r.identity, r.sessionId);
    assert.match(none.answer, /không thấy client nào trong danh sách của bạn khớp/);
    const amb: any = await r.fitnessAgent.tryTurn("soạn tin nhắn cho học viên An", r.identity, r.sessionId);
    assert.match(amb.answer, /Có nhiều client khớp: Nguyễn Văn An; Lê Văn An/);
    assert.equal(await r.prisma.fitnessAgentAction.count({ where: { userId: r.userId } }), 0);
  } finally { await r.restore(); await r.prisma.$disconnect(); }
});

test("EXECUTE: approval records an AUDITED approval through fitness-service (re-verifies the relationship) and only then shows the draft text; still sends nothing", dbOpts, async () => {
  const r = await rig();
  try {
    const out: any = await r.fitnessAgent.tryTurn("Đề xuất cách xử lý cho client cần chú ý", r.identity, r.sessionId);
    const actionId = out.blocks[0].actionId;
    const res: any = await r.fitnessAgent.execute(r.identity, actionId, true);
    assert.equal(res.type, "ACTION_RESULT");
    assert.match(res.message, /Đã ghi nhận bạn duyệt đề xuất cho Nguyễn Văn An/);
    assert.match(res.message, /chưa gửi gì cho client và chưa thay đổi dữ liệu nào/);
    assert.ok(res.steps.some((s: string) => s.startsWith("[Tin nhắn]")), "the draft is shown to the PT");
    assert.equal(r.decisions.length, 1);
    assert.deepEqual({ clientUserId: r.decisions[0].clientUserId, decision: r.decisions[0].decision, proposalId: r.decisions[0].proposalId }, { clientUserId: "u-risk-1111", decision: "APPROVED", proposalId: actionId });
    assert.equal((await r.prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id: actionId } })).status, "COMPLETED");
    await r.fitnessAgent.execute(r.identity, actionId, true);
    assert.equal(r.decisions.length, 1, "a repeated confirm does not record the approval twice");
  } finally { await r.restore(); await r.prisma.$disconnect(); }
});

test("EXECUTE: the relationship ended in the meantime (403) -> terminal, honest, and the client's draft is NOT shown; a transient failure stays retryable", dbOpts, async () => {
  const forbidden = await rig({ decision: "forbidden" });
  try {
    const out: any = await forbidden.fitnessAgent.tryTurn("đề xuất xử lý client cần chú ý", forbidden.identity, forbidden.sessionId);
    const res: any = await forbidden.fitnessAgent.execute(forbidden.identity, out.blocks[0].actionId, true);
    assert.match(res.message, /không còn quan hệ huấn luyện đang hiệu lực/);
    assert.deepEqual(res.steps, []);
    assert.equal((await forbidden.prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id: out.blocks[0].actionId } })).status, "COMPLETED");
  } finally { await forbidden.restore(); }
  const down = await rig({ decision: "down" });
  try {
    const out: any = await down.fitnessAgent.tryTurn("đề xuất xử lý client cần chú ý", down.identity, down.sessionId);
    const res: any = await down.fitnessAgent.execute(down.identity, out.blocks[0].actionId, true);
    assert.match(res.message, /Chưa ghi nhận được việc duyệt do lỗi hệ thống/);
    assert.equal((await down.prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id: out.blocks[0].actionId } })).status, "PENDING", "back to PENDING: the PT can retry");
    down.state.mode = "ok";
    const again: any = await down.fitnessAgent.execute(down.identity, out.blocks[0].actionId, true);
    assert.match(again.message, /Đã ghi nhận bạn duyệt/);
  } finally { await down.restore(); await down.prisma.$disconnect(); }
});

test("DISMISS: the proposal is cancelled, the dismissal is audited (best effort), nothing is approved", dbOpts, async () => {
  const r = await rig();
  try {
    const out: any = await r.fitnessAgent.tryTurn("đề xuất xử lý client cần chú ý", r.identity, r.sessionId);
    const actionId = out.blocks[0].actionId;
    const res: any = await r.fitnessAgent.dismissDraft(r.identity, actionId);
    assert.match(res.message, /Đã bỏ qua đề xuất này/);
    assert.deepEqual(r.decisions.map((d) => d.decision), ["DISMISSED"]);
    assert.equal((await r.prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id: actionId } })).status, "CANCELLED");
    await assert.rejects(() => r.fitnessAgent.execute(r.identity, actionId, true), /CANCELLED/);
    assert.equal(r.decisions.length, 1, "a cancelled proposal can never be approved afterwards");
  } finally { await r.restore(); await r.prisma.$disconnect(); }
});

test("TURN: a roster outage is said plainly and creates nothing; an ordinary customer message is never taken as a proposal request", dbOpts, async () => {
  const r = await rig();
  try {
    (r as any).prisma; // keep the rig's stubs, then break the roster read
    const { fitnessAgentDeps } = await import("../services/fitness-agent.service");
    (fitnessAgentDeps.tools as any).getRosterAdherence = async () => { throw Object.assign(new Error("Domain service unavailable"), { status: 503 }); };
    const down: any = await r.fitnessAgent.tryTurn("đề xuất xử lý client cần chú ý", r.identity, r.sessionId);
    assert.match(down.answer, /chưa đọc được dữ liệu của các client/);
    assert.equal(await r.prisma.fitnessAgentAction.count({ where: { userId: r.userId } }), 0);
    await r.fitnessAgent.tryTurn("Đề xuất cho tôi một lịch tập", r.identity, r.sessionId).catch(() => null);
    assert.equal(await r.prisma.fitnessAgentAction.count({ where: { userId: r.userId, kind: "PT_CLIENT_ACTION_PROPOSAL" } }), 0);
  } finally { await r.restore(); await r.prisma.$disconnect(); }
});
