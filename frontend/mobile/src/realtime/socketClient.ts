import { io, Socket } from "socket.io-client";

import { gatewaySocketUrl, onServerUrlChange } from "../config/serverUrl";
import { ensureFreshAccessToken } from "../services/session";
import { tokenStore } from "../services/tokenStore";

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
        cb({ token: readAccessToken() });
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
