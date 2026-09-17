/**
 * Phase 7 end-to-end: the three money-adjacent flows a client can drive alone, each checked at the
 * BACKEND after every step — never at the UI, and never at the response of the call that made the
 * change.
 *
 * What makes this worth running rather than a second copy of the unit tests: every request body is
 * built by the SAME functions the screens use (`buildContractRequestPayload`, `buildBookingPayload`,
 * `buildReschedulePayload`, the membership arguments), so a change that breaks what the app sends
 * fails here too. The assertions then read the state back with a separate GET.
 *
 * It needs the dev backend running, and it cleans up everything it creates:
 *   pnpm test:e2e            (gateway at http://localhost:3000, account john.doe@example.com)
 *   E2E_BASE_URL=... E2E_EMAIL=... E2E_PASSWORD=... pnpm test:e2e
 *
 * It is deliberately NOT part of `pnpm test`: that suite must pass with no server at all.
 *
 * Một lưu ý về dữ liệu: kịch bản hai phía (PT đề nghị – khách trả lời) **dời một buổi đi rồi dời
 * lại về chỗ cũ**, tức là dùng hết ngân sách "tối đa 2 lần dời" của buổi đó. Nó luôn chọn một buổi
 * chưa từng bị dời, và mỗi lượt chạy tiêu đúng một buổi như vậy.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildContractRequestPayload, normalizePts } from "../src/features/services/ptDiscovery";
import { normalizeGyms, normalizePlans, planOnSale } from "../src/features/services/gymDirectory";
import { normalizeContracts } from "../src/features/services/contracts";
import {
  RESCHEDULE_MAX_MOVES,
  acceptedMoves,
  withRescheduleHistory,
  buildBookingPayload,
  buildReschedulePayload,
  hoursUntil,
  normalizeRescheduleHistory,
  normalizeSessions,
  normalizeSlots,
  pendingReschedule,
  type SessionRow,
} from "../src/features/services/sessions";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "john.doe@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";

/**
 * The two-sided scenario needs the TRAINER on the client's active contract, because only the other
 * party may answer a proposal. Credentials are read from the environment and never stored here; with
 * none set, that one test skips and the rest still run.
 */
const PT_EMAIL = process.env.E2E_PT_EMAIL ?? "";
const PT_PASSWORD = process.env.E2E_PT_PASSWORD ?? "";

let token = "";

type Json = any;

async function call(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  asToken?: string,
): Promise<{ status: number; data: Json }> {
  const bearer = asToken ?? token;
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data: Json = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

const get = (path: string, asToken?: string) => call("GET", path, undefined, asToken);
const post = (path: string, body?: unknown, asToken?: string) => call("POST", path, body, asToken);
const patch = (path: string, body?: unknown, asToken?: string) => call("PATCH", path, body, asToken);
const del = (path: string) => call("DELETE", path);

/** Everything created during the run, undone in reverse in the `after` hook. */
const cleanup: Array<() => Promise<void>> = [];

async function backendIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(4000) });
    return response.ok;
  } catch {
    return false;
  }
}

let skipAll = false;

before(async () => {
  if (!(await backendIsUp())) {
    skipAll = true;
    // A missing dev stack is not a test failure — it means this suite has nothing to talk to.
    console.log(`[e2e] Bỏ qua: không thấy backend ở ${BASE_URL}`);
    return;
  }
  const login = await post("/auth/login", { email: EMAIL, password: PASSWORD });
  assert.equal(login.status, 200, `đăng nhập thất bại: ${JSON.stringify(login.data).slice(0, 200)}`);
  token = login.data?.accessToken ?? login.data?.token ?? "";
  assert.ok(token, "không lấy được accessToken");
});

after(async () => {
  for (const undo of cleanup.reverse()) {
    try {
      await undo();
    } catch (error: any) {
      console.log("[e2e] dọn dẹp lỗi:", error?.message ?? error);
    }
  }
});

describe("Phase 7 — yêu cầu hợp đồng PT", () => {
  it("tạo yêu cầu bằng đúng payload của màn hình, rồi rút lại", async (t) => {
    if (skipAll) return t.skip("backend chưa chạy");

    const ptsResponse = await get("/profile/pts?limit=20");
    assert.equal(ptsResponse.status, 200);
    const trainers = normalizePts(ptsResponse.data);
    assert.ok(trainers.length > 0, "không có PT nào để thử");

    // A trainer with at least one package still on sale, and no open contract with us already.
    const contractsBefore = normalizeContracts((await get("/contracts/client")).data);
    const busyWith = new Set(
      contractsBefore
        .filter((c) => ["PENDING_REVIEW", "PENDING_SIGNATURE", "PENDING_PAYMENT", "ACTIVE"].includes(c.status))
        .map((c) => c.ptUserId),
    );

    let chosen: { ptUserId: string; pkg: any } | null = null;
    for (const trainer of trainers) {
      if (busyWith.has(trainer.userId)) continue;
      const packages = (await get(`/profile/pts/${trainer.userId}/service-packages`)).data?.packages ?? [];
      const online = packages.find((p: any) => p?.sessionMode === "ONLINE" && p?.isActive !== false);
      if (online) {
        chosen = { ptUserId: trainer.userId, pkg: online };
        break;
      }
    }
    if (!chosen) return t.skip("không tìm được PT rảnh có gói online để thử");

    const payload = buildContractRequestPayload({
      ptUserId: chosen.ptUserId,
      pkg: {
        id: String(chosen.pkg.id),
        name: String(chosen.pkg.name ?? ""),
        sessionCount: Number(chosen.pkg.sessionCount) || 0,
        price: Number(chosen.pkg.price) || 0,
        sessionMode: "ONLINE",
      },
      message: "E2E Phase 7 — yeu cau tu kich ban tu dong",
    });
    // The screen never sends a price; the server prices the package itself.
    assert.equal("price" in payload, false);

    const created = await post("/contracts/request", payload);
    assert.equal(created.status, 201, `tạo hợp đồng thất bại: ${JSON.stringify(created.data).slice(0, 200)}`);
    const contractId = created.data?.id ?? created.data?.contract?.id;
    assert.ok(contractId, "không nhận được id hợp đồng");
    cleanup.push(async () => {
      await patch(`/contracts/${contractId}/cancel`, { reason: "E2E cleanup" });
    });

    // Read it back: the state that matters is the server's, not the create response's.
    const readBack = normalizeContracts((await get("/contracts/client")).data).find(
      (c) => c.id === contractId,
    );
    assert.ok(readBack, "hợp đồng vừa tạo không có trong danh sách của khách");
    assert.equal(readBack.status, "PENDING_REVIEW");
    assert.equal(readBack.price, Number(chosen.pkg.price));
    assert.equal(readBack.totalSessions, Number(chosen.pkg.sessionCount));
    assert.equal(readBack.usedSessions, 0);
    assert.equal(readBack.paid, false, "hợp đồng chưa thanh toán mà bị đánh dấu đã trả");

    // Withdrawing before money settles is a plain status flip.
    const withdrawn = await patch(`/contracts/${contractId}/cancel`, { reason: "E2E rút yêu cầu" });
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.data).slice(0, 200));

    const afterWithdraw = normalizeContracts((await get("/contracts/client")).data).find(
      (c) => c.id === contractId,
    );
    assert.equal(afterWithdraw?.status, "CANCELLED");
  });
});

describe("Phase 7 — gói hội viên phòng gym", () => {
  it("mua tới đúng 'chờ thanh toán' đúng giá, rồi huỷ", async (t) => {
    if (skipAll) return t.skip("backend chưa chạy");

    const gyms = normalizeGyms((await get("/gyms")).data);
    const open = gyms.filter((gym) => gym.status === "APPROVED" && gym.operationalStatus === "OPEN");
    assert.ok(open.length > 0, "không có phòng gym nào đang mở");

    const mine = (await get("/me/gym-memberships")).data?.data ?? [];
    const alreadyOpenAt = new Set(
      mine
        .filter((m: any) => ["ACTIVE", "PENDING_PAYMENT"].includes(String(m?.status)))
        .map((m: any) => String(m?.gymId)),
    );

    let target: { gymId: string; plan: any } | null = null;
    for (const gym of open) {
      if (alreadyOpenAt.has(gym.id)) continue;
      const plans = normalizePlans((await get(`/gyms/${gym.id}/plans`)).data).filter((plan) =>
        planOnSale(plan),
      );
      if (plans.length > 0) {
        target = { gymId: gym.id, plan: plans[0] };
        break;
      }
    }
    if (!target) return t.skip("không tìm được phòng gym có gói đang mở bán");

    // The screen asks this before confirming; it warns, it never blocks.
    const warnings = await get(`/gyms/${target.gymId}/membership-warnings`);
    assert.equal(warnings.status, 200);
    const acknowledged = (warnings.data?.data ?? []).length > 0;

    const bought = await post(`/gyms/${target.gymId}/memberships`, {
      planId: target.plan.id,
      ...(acknowledged ? { acknowledgedMultiGymWarning: true } : {}),
    });
    assert.ok(
      bought.status >= 200 && bought.status < 300,
      `mua gói thất bại: ${JSON.stringify(bought.data).slice(0, 200)}`,
    );

    const list = (await get("/me/gym-memberships")).data?.data ?? [];
    const membership = list.find(
      (m: any) => String(m?.gymId) === target!.gymId && String(m?.status) === "PENDING_PAYMENT",
    );
    assert.ok(membership, "không thấy gói ở trạng thái chờ thanh toán");
    cleanup.push(async () => {
      await post(`/me/gym-memberships/${membership.id}/cancel`);
    });

    // Đúng giá, đúng thời hạn — snapshot của gói tại thời điểm mua.
    assert.equal(Number(membership.priceAtPurchase), target.plan.price);
    assert.equal(Number(membership.durationDaysSnapshot), target.plan.durationDays);
    assert.equal(membership.paymentTxnId ?? null, null, "chưa thanh toán mà đã có giao dịch");
    assert.equal(membership.startDate ?? null, null, "chưa kích hoạt mà đã có ngày bắt đầu");

    const cancelled = await post(`/me/gym-memberships/${membership.id}/cancel`);
    assert.ok(cancelled.status >= 200 && cancelled.status < 300);

    const afterCancel = ((await get("/me/gym-memberships")).data?.data ?? []).find(
      (m: any) => String(m?.id) === String(membership.id),
    );
    assert.equal(String(afterCancel?.status), "CANCELLED");
  });
});

describe("Phase 7 — đặt buổi tập trên hợp đồng đang hiệu lực", () => {
  it("đặt, đề nghị đổi lịch, rồi huỷ — mỗi bước đọc lại từ máy chủ", async (t) => {
    if (skipAll) return t.skip("backend chưa chạy");

    const contracts = normalizeContracts((await get("/contracts/client")).data);
    const active = contracts.find((c) => c.status === "ACTIVE" && c.totalSessions > c.usedSessions);
    if (!active) return t.skip("không có hợp đồng ACTIVE còn buổi để đặt");

    // A day far enough ahead that the 24h cancel rule and the 12h reschedule rule both hold.
    const day = new Date();
    day.setDate(day.getDate() + 3);
    const date = [
      day.getFullYear(),
      String(day.getMonth() + 1).padStart(2, "0"),
      String(day.getDate()).padStart(2, "0"),
    ].join("-");

    const slotsResponse = await get(`/availability/${active.ptUserId}/slots?date=${date}`);
    assert.equal(slotsResponse.status, 200);
    const slots: string[] = Array.isArray(slotsResponse.data) ? slotsResponse.data : [];
    if (slots.length === 0) return t.skip(`PT không có khung giờ trống ngày ${date}`);

    const booked = await post("/sessions", {
      contractId: active.id,
      ...buildBookingPayload({
        date,
        time: slots[0],
        sessionMode: active.sessionMode,
        notes: "E2E Phase 7",
      }),
    });
    assert.ok(
      booked.status >= 200 && booked.status < 300,
      `đặt buổi thất bại: ${JSON.stringify(booked.data).slice(0, 200)}`,
    );
    const sessionId = booked.data?.id ?? booked.data?.session?.id;
    assert.ok(sessionId, "không nhận được id buổi tập");
    cleanup.push(async () => {
      await patch(`/sessions/${sessionId}/cancel`, { reason: "E2E cleanup" });
    });

    const upcoming = normalizeSessions((await get("/sessions/upcoming")).data);
    const session = upcoming.find((s: SessionRow) => s.id === sessionId);
    assert.ok(session, "buổi vừa đặt không có trong danh sách sắp tới");
    // A booking waits for the PT, and nothing is charged before it is delivered.
    assert.equal(session.status, "REQUESTED");
    assert.equal(session.deducted, false);
    assert.ok((hoursUntil(session) ?? 0) > 24, "buổi thử phải cách hơn 24 giờ");

    // A REQUESTED session cannot be moved — the server says so, and the app hides the button.
    const tooEarly = await post(`/sessions/${sessionId}/reschedule`, {
      ...buildReschedulePayload(session, date, slots[slots.length - 1])!,
      reason: "E2E doi lich tren buoi chua xac nhan",
    });
    assert.equal(tooEarly.status, 400, "đổi lịch trên buổi REQUESTED lẽ ra phải bị từ chối");

    // Cancelling outside the 24-hour window must not cost a session.
    const cancelled = await patch(`/sessions/${sessionId}/cancel`, { reason: "E2E huỷ buổi" });
    assert.ok(cancelled.status >= 200 && cancelled.status < 300, JSON.stringify(cancelled.data).slice(0, 200));

    const all = normalizeSessions((await get(`/sessions/contract/${active.id}`)).data);
    const afterCancel = all.find((s: SessionRow) => s.id === sessionId);
    assert.equal(afterCancel?.status, "CANCELLED");
    assert.equal(afterCancel?.deducted, false, "huỷ trước 24 giờ mà vẫn bị trừ buổi");

    // The contract's quota is untouched by a cancelled session.
    const contractAfter = normalizeContracts((await get("/contracts/client")).data).find(
      (c) => c.id === active.id,
    );
    assert.equal(contractAfter?.usedSessions, active.usedSessions);
  });

  it("đề nghị đổi lịch trên buổi đã xác nhận, đọc lại rồi thu hồi", async (t) => {
    if (skipAll) return t.skip("backend chưa chạy");

    const upcoming = normalizeSessions((await get("/sessions/upcoming")).data);
    // The server allows a session to be MOVED at most twice; a third proposal is a 409. The list
    // endpoint attaches only the PENDING proposal, so the count has to come from each session's
    // own history.
    const candidates = upcoming.filter(
      (s: SessionRow) => s.status === "CONFIRMED" && (hoursUntil(s) ?? 0) > 12 && !pendingReschedule(s),
    );
    let movable: SessionRow | undefined;
    for (const candidate of candidates) {
      const history = normalizeRescheduleHistory((await get(`/sessions/${candidate.id}/reschedule-history`)).data);
      if (acceptedMoves(withRescheduleHistory(candidate, history)) < RESCHEDULE_MAX_MOVES) {
        movable = candidate;
        break;
      }
    }
    if (!movable) {
      return t.skip("không có buổi CONFIRMED nào còn hơn 12 giờ, chưa có đề nghị mở và chưa dời quá 2 lần");
    }

    const day = new Date(movable.startAt!);
    day.setDate(day.getDate() + 1);
    const date = [
      day.getFullYear(),
      String(day.getMonth() + 1).padStart(2, "0"),
      String(day.getDate()).padStart(2, "0"),
    ].join("-");

    const payload = buildReschedulePayload(movable, date, "09:00");
    assert.ok(payload, "không dựng được payload đổi lịch");

    const requested = await post(`/sessions/${movable.id}/reschedule`, {
      ...payload,
      reason: "E2E Phase 7 - de nghi doi lich tu kich ban",
    });
    assert.ok(
      requested.status >= 200 && requested.status < 300,
      `đề nghị đổi lịch thất bại: ${JSON.stringify(requested.data).slice(0, 200)}`,
    );
    const requestId = requested.data?.id;
    assert.ok(requestId, "không nhận được id đề nghị");
    cleanup.push(async () => {
      await del(`/sessions/reschedules/${requestId}`);
    });

    // The proposal must come back attached to the session — this is the field the UI reads, and
    // the per-contract list does NOT carry it.
    const withProposal = normalizeSessions((await get("/sessions/upcoming")).data).find(
      (s: SessionRow) => s.id === movable.id,
    );
    const open = withProposal ? pendingReschedule(withProposal) : null;
    assert.ok(open, "đề nghị vừa gửi không gắn vào buổi tập");
    assert.equal(open.requestedBy, "CLIENT");
    assert.equal(open.status, "PENDING");
    assert.equal(open.proposedStartAt, payload!.proposedStartAt);

    // Only the other side may answer it.
    const ownAnswer = await post(`/sessions/reschedules/${requestId}/respond`, { action: "ACCEPT" });
    assert.equal(ownAnswer.status, 403, "khách lẽ ra không được tự trả lời đề nghị của mình");

    const withdrawn = await del(`/sessions/reschedules/${requestId}`);
    assert.ok(withdrawn.status >= 200 && withdrawn.status < 300);

    const history = (await get(`/sessions/${movable.id}/reschedule-history`)).data ?? [];
    const row = history.find((h: any) => h?.id === requestId);
    assert.equal(String(row?.status), "CANCELLED");
  });
});

describe("Phase 7 — PT đề nghị đổi lịch, khách trả lời", () => {
  it("từ chối giữ nguyên giờ cũ, đồng ý chuyển sang giờ mới", async (t) => {
    if (skipAll) return t.skip("backend chưa chạy");
    if (!PT_EMAIL || !PT_PASSWORD) {
      return t.skip("chưa đặt E2E_PT_EMAIL/E2E_PT_PASSWORD — không tạo được đề nghị từ phía PT");
    }

    const contracts = normalizeContracts((await get("/contracts/client")).data);
    const active = contracts.find((c) => c.status === "ACTIVE" && c.totalSessions > c.usedSessions);
    if (!active) return t.skip("không có hợp đồng ACTIVE còn buổi");

    const ptLogin = await post("/auth/login", { email: PT_EMAIL, password: PT_PASSWORD });
    assert.equal(ptLogin.status, 200, "đăng nhập PT thất bại");
    const ptToken = ptLogin.data?.accessToken ?? ptLogin.data?.token ?? "";
    assert.ok(ptToken, "không lấy được token PT");

    // The scenario books its OWN session rather than moving one from the seed data: a session's
    // original hour may sit outside the trainer's availability (the seeded 22:00 ones do), and then
    // there is no way to put it back. Two free slots on one day is all it needs.
    const day = new Date();
    let dateKey = "";
    let slots: string[] = [];
    for (let ahead = 2; ahead <= 9 && slots.length < 2; ahead += 1) {
      const probe = new Date(day.getFullYear(), day.getMonth(), day.getDate() + ahead);
      const key = [
        probe.getFullYear(),
        String(probe.getMonth() + 1).padStart(2, "0"),
        String(probe.getDate()).padStart(2, "0"),
      ].join("-");
      const free = normalizeSlots((await get(`/availability/${active.ptUserId}/slots?date=${key}`)).data);
      if (free.length >= 2) {
        dateKey = key;
        slots = free;
      }
    }
    if (slots.length < 2) return t.skip("PT không có ngày nào còn ít nhất 2 khung giờ trống");

    const booked = await post("/sessions", {
      contractId: active.id,
      ...buildBookingPayload({ date: dateKey, time: slots[0], sessionMode: active.sessionMode }),
    });
    assert.ok(
      booked.status >= 200 && booked.status < 300,
      `đặt buổi thất bại: ${JSON.stringify(booked.data).slice(0, 200)}`,
    );
    const sessionId = String(booked.data?.id ?? booked.data?.session?.id);
    assert.ok(sessionId, "không nhận được id buổi tập");
    cleanup.push(async () => {
      await patch(`/sessions/${sessionId}/cancel`, { reason: "E2E cleanup" });
    });

    // The trainer confirms it, because only a CONFIRMED session may be moved.
    const confirmed = await patch(`/sessions/${sessionId}/confirm`, undefined, ptToken);
    assert.ok(
      confirmed.status >= 200 && confirmed.status < 300,
      `PT xác nhận thất bại: ${JSON.stringify(confirmed.data).slice(0, 200)}`,
    );

    const sessionNow = async (): Promise<SessionRow> => {
      const rows = normalizeSessions((await get("/sessions/upcoming")).data);
      const found = rows.find((s: SessionRow) => s.id === sessionId);
      assert.ok(found, "không đọc lại được buổi tập");
      return found;
    };

    const propose = async (time: string, reason: string) => {
      const session = await sessionNow();
      const payload = buildReschedulePayload(session, dateKey, time);
      assert.ok(payload, "không dựng được payload đổi lịch");
      const created = await post(
        `/sessions/${sessionId}/reschedule`,
        { ...payload, reason },
        ptToken,
      );
      assert.ok(
        created.status >= 200 && created.status < 300,
        `PT gửi đề nghị thất bại: ${JSON.stringify(created.data).slice(0, 200)}`,
      );
      return String(created.data?.id);
    };

    const originalStart = (await sessionNow()).startAt;

    // ── Từ chối: đề nghị đóng lại, buổi tập KHÔNG đổi giờ và KHÔNG bị huỷ.
    const rejectId = await propose(slots[1], "E2E - PT de nghi doi, khach se tu choi");
    const incoming = pendingReschedule(await sessionNow());
    assert.equal(incoming?.requestedBy, "PT", "đề nghị phải hiện ra là do PT gửi");

    const rejected = await post(`/sessions/reschedules/${rejectId}/respond`, { action: "REJECT" });
    assert.ok(rejected.status >= 200 && rejected.status < 300, JSON.stringify(rejected.data).slice(0, 200));

    const afterReject = await sessionNow();
    assert.equal(afterReject.status, "CONFIRMED", "từ chối đề nghị không được huỷ buổi tập");
    assert.equal(afterReject.startAt, originalStart, "từ chối mà giờ vẫn bị đổi");

    // ── Đồng ý: buổi chuyển sang giờ mới, vẫn CONFIRMED, vẫn chưa trừ buổi.
    const acceptId = await propose(slots[1], "E2E - PT de nghi doi, khach se dong y");
    const accepted = await post(`/sessions/reschedules/${acceptId}/respond`, { action: "ACCEPT" });
    assert.ok(accepted.status >= 200 && accepted.status < 300, JSON.stringify(accepted.data).slice(0, 200));

    const afterAccept = await sessionNow();
    assert.notEqual(afterAccept.startAt, originalStart, "đồng ý mà giờ không đổi");
    assert.equal(afterAccept.status, "CONFIRMED");
    assert.equal(afterAccept.deducted, false, "đổi lịch không được tính là đã dạy");
    assert.equal(pendingReschedule(afterAccept), null, "đề nghị đã trả lời mà vẫn còn mở");
  });
});
