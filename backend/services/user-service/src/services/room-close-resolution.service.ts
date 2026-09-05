import axios from "axios";
import { logger } from "@gym-coach/shared";
import { SessionStatus } from "../generated/prisma";
import { sessionRepository } from "../repositories/session.repository";
import { notificationService } from "./notification.service";
import { compensateLateArrivalMoney, compensateNoShowMoney } from "./contract-payout.service";
import { contractService } from "./contract.service";

const INTERVAL_MS = Number(
  process.env.ROOM_CLOSE_RESOLUTION_INTERVAL_MS ?? 5 * 60 * 1000,
);
const BATCH_SIZE = 100;
const NO_SHOW_GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * 60 * 1000;
const AUTO_CONFIRM_MS = Number(process.env.SESSION_AUTO_CONFIRM_DAYS ?? "3") * 24 * 60 * 60 * 1000;

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || "http://chat-service:3005";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

/**
 * Best-effort, fire-and-forget: tells chat-service to force-end any lingering CallSession row
 * for this coaching session, now that its room's own window has closed. chat-service's WebRTC
 * signaling layer has no other way to learn this happened (it never sees Session rows) — see
 * call.service.ts's endCallsForCoachingSession doc comment for why a stale row matters (it
 * would otherwise wrongly count as "already in a call" for a LATER, unrelated session). Never
 * awaited by the caller in a way that could delay or fail the sweep's own resolution — losing
 * this call just leaves one harmless stale row, not an incorrect session outcome.
 */
function endOpenRoomCall(coachingSessionId: string, reason: string): void {
  axios
    .post(
      `${CHAT_SERVICE_URL}/internal/calls/end-by-session`,
      { coachingSessionId, reason },
      { timeout: 3000, headers: { "x-internal-secret": INTERNAL_API_SECRET } },
    )
    .catch((err) =>
      logger.warn({ err: err.message, coachingSessionId }, "Failed to end lingering call for a closed room"),
    );
}

/**
 * "Meeting room" resolution for open-room online sessions — the counterpart to
 * session-autoconfirm.service.ts, but triggered by the room's own attendance record
 * (roomPtJoinedAt / roomClientJoinedAt) instead of a manual completeSession/markNoShow click.
 *
 * Runs once the room has closed (scheduledEndAt has passed) on every session still sitting in
 * CONFIRMED (nobody clicked anything by hand in the meantime — completeSession/cancelSession/
 * markNoShow all move a session OUT of CONFIRMED, so this sweep's own query naturally never
 * re-processes one that a human already resolved). Four outcomes, purely from who showed up:
 *
 *  1. Neither side ever joined       → CANCELLED, session returned, nobody penalised.
 *  2. PT never joined, client did    → PT full no-show. Mirrors markNoShow's own
 *                                       PT-self-admits-absence branch exactly: straight to
 *                                       NO_SHOW with the existing 100% compensation, no
 *                                       confirmation window needed (the room log already
 *                                       settles the fact, it isn't a claim against the client).
 *  3. PT joined, client never did    → client no-show. Mirrors markNoShow's OTHER branch (PT
 *                                       reporting a client no-show) exactly: routed to
 *                                       PENDING_CLIENT_CONFIRMATION, same deadline, same
 *                                       dispute door — the actual quota charge + PT payout
 *                                       only happens when THAT resolves (clientConfirmSession
 *                                       or the existing 3-day auto-confirm sweep), never here
 *                                       directly. This is deliberate, not a simplification:
 *                                       the user's own instruction for this case was "như hiện
 *                                       tại" (like the existing mechanism) — reusing the exact
 *                                       path rather than a new bespoke one is the point. No
 *                                       penalty on the PT either way, even if the PT was also
 *                                       late (the client never showing up decides this case on
 *                                       its own, independent of the PT's timing).
 *  4. Both joined, PT on time        → auto-progress to PENDING_CLIENT_CONFIRMATION, exactly
 *                                       what completeSession() does by hand — the EXISTING
 *                                       auto-confirm sweep and disputeSession flow take it from
 *                                       there, unchanged.
 *  5. Both joined, PT later than the grace window → same PENDING_CLIENT_CONFIRMATION path as
 *                                       #4 (still auto-completes, client can still dispute) —
 *                                       PLUS a half-rate cash compensation for the PT's
 *                                       lateness, session NOT deducted from the client's
 *                                       entitlement either way. Deliberately NOT marked
 *                                       ptAtFault: this is a lesser penalty than a full
 *                                       no-show precisely because it is a lesser offence, and
 *                                       must not silently accelerate the 3-strikes
 *                                       PT_REPEATED_NO_SHOW termination right meant for the
 *                                       worse pattern.
 *
 * OFFLINE sessions are untouched by this sweep — there is no room, so the existing
 * markNoShow/reportPtNoShow manual buttons stay the only way to resolve those.
 */
let running = false;

export interface RoomCloseDeps {
  findDue: (before: Date, limit: number) => Promise<
    Array<{
      id: string;
      contractId: string;
      clientUserId: string;
      ptUserId: string;
      scheduledStartAt: Date;
      roomPtJoinedAt: Date | null;
      roomClientJoinedAt: Date | null;
    }>
  >;
  transitionStatus: (
    id: string,
    expected: SessionStatus[],
    next: SessionStatus,
    extra?: Record<string, unknown>,
  ) => Promise<boolean>;
  compensateNoShowMoney: (contractId: string, sessionId: string) => Promise<void>;
  compensateLateArrivalMoney: (contractId: string, sessionId: string) => Promise<void>;
  checkAndCompleteContract: (contractId: string) => Promise<unknown>;
  notify: (params: { userId: string; text: string; eventType: string; entityType: string; entityId: string; link: string }) => Promise<unknown>;
}

const defaultDeps: RoomCloseDeps = {
  findDue: (before, limit) => sessionRepository.findConfirmedOnlineSessionsPastEnd(before, limit),
  transitionStatus: (id, expected, next, extra) => sessionRepository.transitionStatus(id, expected, next, extra),
  compensateNoShowMoney: (contractId, sessionId) => compensateNoShowMoney(contractId, sessionId),
  compensateLateArrivalMoney: (contractId, sessionId) => compensateLateArrivalMoney(contractId, sessionId),
  checkAndCompleteContract: (contractId) => contractService.checkAndCompleteContract(contractId),
  notify: (params) => notificationService.create(params).catch(() => undefined),
};

export function startRoomCloseResolutionJob(): void {
  logger.info(
    `Room-close resolution job started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`,
  );
  setInterval(() => {
    void runRoomCloseResolution();
  }, INTERVAL_MS);
}

export async function runRoomCloseResolution(
  deps: RoomCloseDeps = defaultDeps,
): Promise<{ scanned: number; resolved: number }> {
  if (running) {
    logger.info("[RoomCloseResolution] Previous run still in progress — skipping tick");
    return { scanned: 0, resolved: 0 };
  }
  running = true;

  let scanned = 0;
  let resolved = 0;
  try {
    const due = await deps.findDue(new Date(), BATCH_SIZE);
    scanned = due.length;
    if (scanned === 0) return { scanned, resolved };

    logger.info(`[RoomCloseResolution] ${scanned} open-room session(s) past close`);

    for (const session of due) {
      try {
        const ptJoined = !!session.roomPtJoinedAt;
        const clientJoined = !!session.roomClientJoinedAt;
        const ptLate =
          ptJoined && session.roomPtJoinedAt!.getTime() > session.scheduledStartAt.getTime() + NO_SHOW_GRACE_MS;

        if (!ptJoined && !clientJoined) {
          // Case 1 — nobody showed. Pure status flip, no money, no quota touched.
          const won = await deps.transitionStatus(session.id, [SessionStatus.CONFIRMED], SessionStatus.CANCELLED, {
            cancelledBy: "SYSTEM",
            cancellationReason: "Không bên nào tham gia phòng học trước khi hết giờ.",
          });
          if (won) {
            resolved++;
            endOpenRoomCall(session.id, "room_cancelled_nobody_joined");
            for (const userId of [session.clientUserId, session.ptUserId]) {
              await deps.notify({
                userId,
                text: "Không ai vào phòng học trước khi hết giờ — buổi tập đã được huỷ, trả lại buổi cho khách.",
                eventType: "SESSION_CANCELLED",
                entityType: "SESSION",
                entityId: session.id,
                link: userId === session.clientUserId ? "/client/booking" : "/pt/schedule",
              });
            }
          }
          continue;
        }

        if (!ptJoined && clientJoined) {
          // Case 2 — PT full no-show. Mirrors markNoShow's PT-self-admit branch exactly.
          const won = await deps.transitionStatus(session.id, [SessionStatus.CONFIRMED], SessionStatus.NO_SHOW, {
            sessionDeducted: false,
            ptNotes: "PT không vào phòng học",
            ptAtFault: true,
          });
          if (won) {
            await deps.compensateNoShowMoney(session.contractId, session.id);
            await deps.checkAndCompleteContract(session.contractId);
            resolved++;
            endOpenRoomCall(session.id, "pt_no_show");
            // System-determined, not self-admitted — unlike markNoShow's PT-self-admit
            // branch, the PT here doesn't already know this happened, so (like
            // resolveDispute's PT_NO_SHOW_CONFIRMED branch) both sides are told.
            await deps.notify({
              userId: session.clientUserId,
              text: "Huấn luyện viên không vào phòng học. Bạn được hoàn tiền một buổi vào ví và buổi tập không bị trừ.",
              eventType: "SESSION_NO_SHOW_PT",
              entityType: "SESSION",
              entityId: session.id,
              link: "/client/wallet",
            });
            await deps.notify({
              userId: session.ptUserId,
              text: "Bạn không vào phòng học trước khi hết giờ — buổi tập được ghi nhận vắng mặt, khách được bồi thường.",
              eventType: "SESSION_NO_SHOW_PT",
              entityType: "SESSION",
              entityId: session.id,
              link: "/pt/schedule",
            });
          }
          continue;
        }

        if (ptJoined && !clientJoined) {
          // Case 3 — client no-show. PT showed up (on time or late — a lateness that never
          // meets a client is not late toward anyone). Do NOT settle quota/money here directly:
          // park it in PENDING_CLIENT_CONFIRMATION exactly like markNoShow's "PT reports
          // client no-show" branch does, so the client keeps their normal confirm/dispute
          // window and the eventual charge runs through the one place deductQuotaOnce +
          // releaseSessionMoney already live (clientConfirmSession, or the 3-day auto-confirm
          // sweep) — not a second, parallel implementation of the same charge here.
          const deadline = new Date(Date.now() + AUTO_CONFIRM_MS);
          const won = await deps.transitionStatus(session.id, [SessionStatus.CONFIRMED], SessionStatus.PENDING_CLIENT_CONFIRMATION, {
            ptNotes: "Client không vào phòng học",
            clientConfirmDeadline: deadline,
          });
          if (won) {
            resolved++;
            endOpenRoomCall(session.id, "client_no_show");
            await deps.notify({
              userId: session.clientUserId,
              text: `Bạn đã không vào phòng học. Nếu có nhầm lẫn, hãy khiếu nại trước ${deadline.toLocaleDateString("vi-VN")} — quá hạn buổi tập sẽ bị trừ và huấn luyện viên vẫn được thanh toán.`,
              eventType: "SESSION_PENDING_CONFIRMATION",
              entityType: "SESSION",
              entityId: session.id,
              link: "/client/booking",
            });
            await deps.notify({
              userId: session.ptUserId,
              text: "Học viên không vào phòng học. Buổi tập sẽ được tính đã dùng và bạn vẫn được thanh toán trừ khi khách khiếu nại.",
              eventType: "SESSION_PENDING_CONFIRMATION",
              entityType: "SESSION",
              entityId: session.id,
              link: "/pt/schedule",
            });
          }
          continue;
        }

        // Case 4/5 — both showed. Auto-progress exactly like a manual completeSession() would,
        // so the existing auto-confirm sweep and disputeSession flow both keep working
        // unchanged. Late arrival ALSO gets a half-rate cash top-up, on top of — not instead
        // of — the normal completion path (the client keeps their dispute window either way).
        const deadline = new Date(Date.now() + AUTO_CONFIRM_MS);
        const won = await deps.transitionStatus(session.id, [SessionStatus.CONFIRMED], SessionStatus.PENDING_CLIENT_CONFIRMATION, {
          ptNotes: ptLate ? "PT vào phòng học muộn" : undefined,
          clientConfirmDeadline: deadline,
        });
        if (won) {
          resolved++;
          endOpenRoomCall(session.id, ptLate ? "session_completed_pt_late" : "session_completed");
          if (ptLate) {
            await deps.compensateLateArrivalMoney(session.contractId, session.id);
          }
          await deps.notify({
            userId: session.clientUserId,
            text: ptLate
              ? `Huấn luyện viên vào muộn — bạn được bồi thường một phần vào ví, buổi tập không bị trừ. Vui lòng xác nhận buổi tập trước ${deadline.toLocaleDateString("vi-VN")} nếu có vấn đề, hãy khiếu nại.`
              : `Buổi tập đã kết thúc. Vui lòng xác nhận trước ${deadline.toLocaleDateString("vi-VN")} — quá hạn hệ thống sẽ tự xác nhận.`,
            eventType: "SESSION_PENDING_CONFIRMATION",
            entityType: "SESSION",
            entityId: session.id,
            link: "/client/booking",
          });
        }
      } catch (err) {
        // One bad row must not stop the sweep — the rest still settle.
        logger.error({
          error: "Room-close resolution failed for session",
          sessionId: session.id,
          message: (err as Error).message,
        });
      }
    }

    logger.info(`[RoomCloseResolution] Resolved ${resolved}/${scanned} session(s)`);
    return { scanned, resolved };
  } catch (err) {
    logger.error({
      error: "Room-close resolution sweep failed",
      message: (err as Error).message,
    });
    return { scanned, resolved };
  } finally {
    running = false;
  }
}
