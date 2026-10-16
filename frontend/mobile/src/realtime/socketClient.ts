import { io, Socket } from "socket.io-client";

import { gatewaySocketUrl, onServerUrlChange } from "../config/serverUrl";
import { ensureFreshAccessToken } from "../services/session";
import { tokenStore } from "../services/tokenStore";
import { isAccessTokenExpiringSoon } from "../services/token";

/**
 * The GATEWAY's realtime Socket.IO connection — notifications, contract/session status pushes.
 * Ported from web's `realtime/socketClient.ts`. Not to be confused with `services/socket.ts`,
 * which is chat-service's separate connection (messages, call signaling).
 *
 * Two deliberate differences from web:
 *
 * 1. The server URL is resolved when the socket is created, not once at module load. Web can
 *    freeze it because changing the server there means reloading the page; on mobile the address
 *    is changed in-app ("Cấu hình máy chủ") with the process still running, so a module-load
 *    constant would keep talking to the old server until the app was killed.
 * 2. Changing that address drops the current socket, so the next `connectSocket()` builds one
 *    against the new server.
 */

let socket: Socket | null = null;
// The access token the CURRENT connection was opened with. The gateway keeps that handshake token
// for the socket's whole life and uses it to call chat-service on every join/send — so once it
// expires (15 min), those calls are refused even though the socket itself stays connected.
let handshakeToken: string | null = null;

function readAccessToken(): string | null {
  const token = tokenStore.get();
  return token && token !== "null" && token !== "undefined" ? token : null;
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(gatewaySocketUrl(), {
      // Refresh BEFORE handing over the token. socket.io calls this on every connect and every
      // reconnect, so without it an app resumed after a long background pause hands the server a
      // dead token, gets rejected, and retries with the same dead token until it gives up.
      auth: async (cb) => {
        await ensureFreshAccessToken();
        handshakeToken = readAccessToken();
        cb({ token: handshakeToken });
      },
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 8000,
      transports: ["websocket", "polling"],
    });

    // An auth rejection mid-session: refresh once, then let socket.io reconnect with the new
    // token. Guarded so a genuinely dead session cannot spin here.
    let recovering = false;
    socket.on("connect_error", async (err: Error) => {
      if (recovering) return;
      if (!/auth|token|unauthor/i.test(err?.message ?? "")) return;
      recovering = true;
      try {
        if (await ensureFreshAccessToken()) socket?.connect();
      } finally {
        recovering = false;
      }
    });
  }

  return socket;
}

export function connectSocket(): Socket {
  const current = getSocket();
  if (!current.connected && !current.active) {
    current.connect();
  }
  return current;
}

/**
 * Makes sure the gateway holds a live token for this connection before a chat join/send.
 * If the handshake token is expired or about to be, reconnect: the `auth` callback refreshes the
 * session and hands the gateway a fresh token. Resolves true once connected with a fresh token.
 * Mobile-side workaround for MOBILE_BACKEND_GAPS GAP-14 — the gateway never re-reads the token.
 */
export async function ensureFreshSocket(timeoutMs = 8000): Promise<boolean> {
  const current = getSocket();
  if (current.connected && !isAccessTokenExpiringSoon(handshakeToken, 60)) return true;
  return new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      current.off("connect", onConnect);
      resolve(ok);
    };
    const onConnect = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    current.on("connect", onConnect);
    if (current.connected) current.disconnect();
    current.connect();
  });
}

export function isSocketTokenStale(): boolean {
  return isAccessTokenExpiringSoon(handshakeToken, 60);
}

export function disconnectSocket() {
  socket?.disconnect();
}

export function resetSocket() {
  socket?.disconnect();
  socket = null;
}

export function getSocketUrl(): string {
  return gatewaySocketUrl();
}

onServerUrlChange(() => resetSocket());
