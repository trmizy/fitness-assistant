import { createHmac } from "crypto";

const TTL_MS = 2 * 60 * 1000; // 2 minutes

interface JoinTokenPayload {
  sessionId: string;
  userId: string;
  otherUserId: string;
  purpose: "JOIN_COACHING_SESSION";
  exp: number;
}

// Fail fast at module load — if env is missing, service won't start cleanly
const SECRET_CREATE = process.env.INTERNAL_API_SECRET;
if (!SECRET_CREATE) {
  throw new Error(
    "[joinToken] INTERNAL_API_SECRET is not set — cannot create join tokens",
  );
}

export function createJoinToken(
  sessionId: string,
  userId: string,
  otherUserId: string,
): string {
  const payload: JoinTokenPayload = {
    sessionId,
    userId,
    otherUserId,
    purpose: "JOIN_COACHING_SESSION",
    exp: Date.now() + TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SECRET_CREATE!)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}
