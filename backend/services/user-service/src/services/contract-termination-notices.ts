import { logger } from "@gym-coach/shared";
import { authServiceClient } from "../clients/auth-service.client";
import { notificationService } from "./notification.service";
import type { TerminationHooks } from "./contract-payout.service";

/**
 * C2-05 - the in-app notices of a contract ending whose reason is declared by one of the parties
 * (PT_CANCELLED, CLIENT_CANCELLED, PT_REPEATED_NO_SHOW). Before this file those endings settled the money and the
 * sessions but told nobody.
 *
 * Rules:
 *  - sent AFTER the ending committed (TerminationHooks.afterCommit), and only by the call whose guarded UPDATE wrote the
 *    final status - a replay or a retried request never sends them twice;
 *  - best-effort: a failure here (auth-service name lookup, the notification write, the push) is logged and swallowed - it
 *    can neither roll back nor block the ending, which is already written when this runs;
 *  - the client's text quotes the amount the ledger actually credited (`paid` of payment-service's termination answer),
 *    never a figure recomputed here; with no figure it says so without a number.
 */

type EndingInfo = {
  contract: { id: string; ptUserId: string; clientUserId: string; packageName: string };
  result: any;
};

/** "920000.00" -> "920.000 ₫". null when there is no positive amount. */
export function formatVnd(raw: unknown): string | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} ₫`;
}

/** What the ledger credited to the client by this ending (refund + any compensation it paid), or null if unknown / nothing. */
function creditedToClient(result: any): string | null {
  return formatVnd(result?.paid) ?? formatVnd(result?.refund);
}

async function ptDisplayName(ptUserId: string): Promise<string | null> {
  try {
    const { data } = await authServiceClient.internalGet(`/auth/internal/users/${ptUserId}`, { timeoutMs: 2000 });
    const u = data?.user;
    const name = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();
    return name || null;
  } catch {
    return null;
  }
}

export function ptCancelledClientText(ptName: string | null, packageName: string, credited: string | null): string {
  const who = ptName ? `Huấn luyện viên ${ptName}` : "Huấn luyện viên";
  const money = credited
    ? ` Bạn được hoàn ${credited} vào ví, các buổi chưa tập đã được huỷ.`
    : " Phần giá trị chưa sử dụng sẽ được hoàn vào ví, các buổi chưa tập đã được huỷ.";
  return `${who} đã chấm dứt hợp đồng "${packageName}".${money}`;
}

export function ptCancelledPtText(packageName: string): string {
  return `Hợp đồng "${packageName}" đã được chấm dứt theo yêu cầu phía huấn luyện viên. Các buổi chưa tập đã được huỷ và phần giá trị chưa sử dụng được hoàn cho khách.`;
}

export function clientCancelledPtText(packageName: string): string {
  return `Khách đã chấm dứt hợp đồng "${packageName}". Các buổi chưa tập đã được huỷ.`;
}

export function repeatedNoShowPtText(packageName: string): string {
  return `Khách đã chấm dứt hợp đồng "${packageName}" vì bạn vắng mặt nhiều buổi. Các buổi chưa tập đã được huỷ và khách được hoàn phần giá trị chưa sử dụng.`;
}

async function send(userId: string, text: string, contractId: string, link: string): Promise<void> {
  try {
    await notificationService.create({
      userId,
      text,
      eventType: "CONTRACT_CANCELLED",
      entityType: "CONTRACT",
      entityId: contractId,
      link,
    });
  } catch (e) {
    logger.warn({ contractId, message: (e as Error)?.message }, "[ContractTermination] ending notice could not be stored");
  }
}

/** Hooks for an ending recorded with `reason`; the reasons this file does not own get none. */
export function declaredEndingNoticeHooks(reason: "PT_CANCELLED" | "CLIENT_CANCELLED" | "PT_REPEATED_NO_SHOW"): TerminationHooks {
  return {
    afterCommit: async (info?: EndingInfo) => {
      if (!info?.contract) return;
      try {
        const { contract, result } = info;
        if (reason === "PT_CANCELLED") {
          const ptName = await ptDisplayName(contract.ptUserId);
          await Promise.all([
            send(contract.clientUserId, ptCancelledClientText(ptName, contract.packageName, creditedToClient(result)), contract.id, "/client/contracts"),
            send(contract.ptUserId, ptCancelledPtText(contract.packageName), contract.id, "/pt/contracts"),
          ]);
        } else if (reason === "CLIENT_CANCELLED") {
          await send(contract.ptUserId, clientCancelledPtText(contract.packageName), contract.id, "/pt/contracts");
        } else {
          await send(contract.ptUserId, repeatedNoShowPtText(contract.packageName), contract.id, "/pt/contracts");
        }
      } catch (e) {
        logger.warn({ message: (e as Error)?.message }, "[ContractTermination] ending notices failed");
      }
    },
  };
}
