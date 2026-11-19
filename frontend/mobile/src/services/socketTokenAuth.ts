import { isAccessTokenExpiringSoon } from "./token";

/**
 * CALL-01 — chat-service keeps the access token it was handed at the socket handshake. That token dies ~15 min later,
 * while the page keeps refreshing its own copy over REST, so a long-lived socket made every call fail with "Phiên đăng
 * nhập đã hết hạn". The server now asks the client for a live token (`auth:request_token`, when a call needs one and
 * when the held one expires) and re-verifies the answer with auth-service.
 *
 * The answer is only ever a token that is good for a while: if the refresh could not produce one (offline, session
 * gone) the answer is empty and the server decides — never a stale token, which the server would treat as a refusal.
 */
export type TokenAck = (answer: { token?: string }) => void;

export interface TokenAnswerDeps {
  ensureFresh: () => Promise<unknown>;
  readToken: () => string | null;
}

export async function answerTokenRequest(ack: unknown, deps: TokenAnswerDeps): Promise<void> {
  if (typeof ack !== "function") return;
  try {
    await deps.ensureFresh();
    const token = deps.readToken();
    (ack as TokenAck)(token && !isAccessTokenExpiringSoon(token) ? { token } : {});
  } catch {
    (ack as TokenAck)({});
  }
}
