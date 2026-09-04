import { createHmac, timingSafeEqual } from "crypto";

interface JoinTokenPayload {
  sessionId: string;
  userId: string;
  otherUserId: string;
  purpose: string;
  exp: number;
}

// Fail fast at module load
const SECRET_VERIFY = process.env.INTERNAL_API_SECRET;
if (!SECRET_VERIFY) {
  throw new Error(
    "[joinToken] INTERNAL_API_SECRET is not set — cannot verify join tokens",
  );
}

function getSecret(): string {
  const s = process.env.INTERNAL_API_SECRET;
  if (!s) throw new Error("INTERNAL_API_SECRET is required for join token");
  return s;
}

export function verifyJoinToken(
  token: string,
  expectedUserId: string,
  expectedSessionId: string,
  expectedCalleeId: string,
): { valid: boolean; reason?: string } {
  try {
    const secret = getSecret();
    const parts = token.split(".");
    if (parts.length !== 2) return { valid: false, reason: "Malformed token" };
    const [encoded, sig] = parts;

    const expected = createHmac("sha256", secret)
      .update(encoded)
      .digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (
      sigBuf.length !== expectedBuf.length ||
      !timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return { valid: false, reason: "Invalid signature" };
    }

    const payload: JoinTokenPayload = JSON.parse(
      Buffer.from(encoded, "base64url").toString(),
    );

    if (payload.purpose !== "JOIN_COACHING_SESSION")
      return { valid: false, reason: "Wrong purpose" };
    if (payload.exp < Date.now())
      return { valid: false, reason: "Token expired" };
    if (payload.userId !== expectedUserId)
      return { valid: false, reason: "User mismatch" };
    if (payload.sessionId !== expectedSessionId)
      return { valid: false, reason: "Session mismatch" };
    if (payload.otherUserId !== expectedCalleeId)
      return { valid: false, reason: "Callee mismatch" };

    return { valid: true };
  } catch {
    return { valid: false, reason: "Parse error" };
  }
}
