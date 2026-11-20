import axios from "axios";
import { logger } from "@gym-coach/shared";
import { resolveChatServiceUrl } from "../utils/chat-service-url";

/**
 * Contract activation -> chat: after a contract becomes ACTIVE (the client's payment succeeded), ask chat-service to
 * make sure the PT and the client have a 1-1 conversation and to post ONE "connected via contract" system line.
 *
 * Reached the same way user-service already reaches chat-service (notification.service.ts / open-room-call.service.ts):
 * CHAT_SERVICE_URL (compose service name locally, the ALB URL on AWS) + the shared internal secret. On AWS chat-service
 * runs on ECS on-demand and is often OFF while this runs on Lambda, so this is strictly BEST-EFFORT:
 *   - it never throws and never changes the activation's outcome (a refusal, a timeout, a 5xx, a missing URL are all just
 *     logged); the PT's "Nhắn tin" (get-or-create) opens the conversation later if this did not;
 *   - it is awaited (a Lambda freezes un-awaited work once the response is sent) but capped by a short timeout;
 *   - it is idempotent on the chat-service side (conversation get-or-create + a system line keyed by contract id), so
 *     calling it again on a payment-webhook replay posts nothing twice.
 */
const CONNECT_TIMEOUT_MS = 2500;

const chatUrl = () => resolveChatServiceUrl();
const chatSecret = () => process.env.INTERNAL_API_SECRET || process.env.INTERNAL_SERVICE_SECRET || "";

export async function connectContractPartiesInChat(contract: {
  id: string;
  ptUserId: string;
  clientUserId: string;
  packageName?: string | null;
}): Promise<boolean> {
  const baseUrl = chatUrl();
  if (!baseUrl) {
    // On Lambda with no CHAT_SERVICE_URL there is no chat-service to ask: do not even open a connection.
    logger.info({ contractId: contract.id }, "[chat-connect] CHAT_SERVICE_URL unset on Lambda - skipped");
    return false;
  }
  const secret = chatSecret();
  if (!secret) {
    logger.warn({ contractId: contract.id }, "[chat-connect] no internal secret configured - skipped (the PT's Nhắn tin will create the conversation)");
    return false;
  }
  try {
    await axios.post(
      `${baseUrl}/internal/contracts/connect`,
      {
        ptUserId: contract.ptUserId,
        clientUserId: contract.clientUserId,
        contractId: contract.id,
        packageName: contract.packageName ?? null,
      },
      { timeout: CONNECT_TIMEOUT_MS, headers: { "x-internal-secret": secret } },
    );
    return true;
  } catch (err: any) {
    logger.warn(
      { contractId: contract.id, status: err?.response?.status, code: err?.code, message: err?.message },
      "[chat-connect] chat-service unreachable or refused - contract stays ACTIVE, the conversation is created lazily on the PT's Nhắn tin",
    );
    return false;
  }
}
