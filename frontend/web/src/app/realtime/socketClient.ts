import { io, Socket } from "socket.io-client";
import { Preferences } from "@capacitor/preferences";
import { gatewaySocketUrl } from "../config/serverUrl";
import { ensureFreshAccessToken } from "../services/session";

// Empty string tells socket.io-client to connect to the CURRENT page origin
// (its documented default-URL behavior) at the default "/socket.io" path —
// proxied by Vite in dev (see vite.config.ts) to the gateway's own
// Socket.IO server. This must NOT reuse API_URL's "/api" default: passing a
// bare path like "/api" as socket.io-client's server-URL argument is not
// the same thing as a same-origin connection and is not a supported input.
// Set VITE_SOCKET_URL to an absolute URL to bypass the proxy entirely. A stored
// runtime override (in-app "Cấu hình máy chủ") takes precedence over both — see
// config/serverUrl.ts for why the APK needs that.
const SOCKET_URL = gatewaySocketUrl();

let socket: Socket | null = null;

async function readAccessToken(): Promise<string | null> {
  const { value: token } = await Preferences.get({ key: "accessToken" });
  return token && token !== "null" && token !== "undefined" ? token : null;
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      // Refresh BEFORE handing over the token. socket.io calls this on every connect and
      // every reconnect, so without it an app resumed after a long background pause hands
      // the server a dead token, gets rejected, and then retries with the same dead token
      // until it gives up — realtime silently stays down for a session that was fine.
      auth: async (cb) => {
        await ensureFreshAccessToken();
        cb({ token: await readAccessToken() });
      },
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 8000,
      transports: ["websocket", "polling"],
    });

    // An auth rejection mid-session: refresh once, then let socket.io reconnect with the
    // new token. Guarded so a genuinely dead session cannot spin here.
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
  return SOCKET_URL;
}
