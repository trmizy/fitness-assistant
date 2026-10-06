import type { IncomingMessage } from "http";
import zlib from "zlib";
import { logger } from "@gym-coach/shared";
import type { ChatMessagePayload } from "./events";
import { getSocketServer } from "./index";
import { broadcastChatMessage } from "./handlers/chat.handlers";

/**
 * A chat message sent over REST (`POST /chat/conversations/:id/messages`) used to land silently:
 * chat-service only announced it on its OWN Socket.IO server, while web and mobile listen for chat
 * on the gateway's. The mobile app falls back to REST whenever its socket is down, so the
 * recipient only saw those messages after a refresh (found on a real phone, 6/10). The gateway
 * proxies that request anyway, so it relays the saved message to the conversation room itself.
 */
const SEND_PATH = /^\/chat\/conversations\/([^/?#]+)\/messages\/?(?:[?#].*)?$/;

/** The message to broadcast for a proxied response, or null when this response is not a sent message. */
export function chatMessageFromRestResponse(
  method: string | undefined,
  originalUrl: string | undefined,
  statusCode: number | undefined,
  body: unknown,
): ChatMessagePayload | null {
  if (method !== "POST" || !originalUrl) return null;
  if (!statusCode || statusCode < 200 || statusCode >= 300) return null;
  const match = SEND_PATH.exec(originalUrl);
  if (!match) return null;

  const data = body as Record<string, unknown> | null;
  if (!data || typeof data.id !== "string" || typeof data.content !== "string") return null;
  const conversationId = decodeURIComponent(match[1]);
  // A response for another conversation than the one in the URL is not ours to announce.
  if (typeof data.conversationId === "string" && data.conversationId !== conversationId) return null;

  return {
    id: data.id,
    conversationId,
    authorId: typeof data.authorId === "string" ? data.authorId : undefined,
    senderId: typeof data.senderId === "string" ? data.senderId : undefined,
    content: data.content,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
  };
}

function decode(buffer: Buffer, encoding: string | undefined): string {
  switch ((encoding || "").toLowerCase()) {
    case "gzip":
      return zlib.gunzipSync(buffer).toString("utf8");
    case "deflate":
      return zlib.inflateSync(buffer).toString("utf8");
    case "br":
      return zlib.brotliDecompressSync(buffer).toString("utf8");
    default:
      return buffer.toString("utf8");
  }
}

/**
 * onProxyRes hook for the /chat REST proxy. Only listens to the response stream — the proxy still
 * pipes it to the client untouched.
 */
export function relayRestChatMessage(proxyRes: IncomingMessage, req: IncomingMessage & { originalUrl?: string }) {
  const originalUrl = req.originalUrl ?? req.url;
  if (req.method !== "POST" || !originalUrl || !SEND_PATH.test(originalUrl)) return;
  if (!proxyRes.statusCode || proxyRes.statusCode < 200 || proxyRes.statusCode >= 300) return;

  const chunks: Buffer[] = [];
  proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
  proxyRes.on("end", () => {
    try {
      const raw = decode(Buffer.concat(chunks), proxyRes.headers["content-encoding"] as string | undefined);
      const message = chatMessageFromRestResponse(req.method, originalUrl, proxyRes.statusCode, JSON.parse(raw));
      const io = getSocketServer();
      if (message && io) broadcastChatMessage(io, message);
    } catch (err) {
      logger.warn({ message: err instanceof Error ? err.message : String(err) }, "Chat REST relay skipped");
    }
  });
}
