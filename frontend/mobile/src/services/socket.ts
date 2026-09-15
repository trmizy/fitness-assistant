import { AppState, type AppStateStatus } from "react-native";
import { io, Socket } from "socket.io-client";

import { chatSocketTarget } from "../config/serverUrl";
import { ensureFreshAccessToken } from "./session";
import { tokenStore } from "./tokenStore";

/**
 * Chat-service's Socket.IO connection. Ported from web's services/socket.ts.
 *
 * Chat-service runs a SEPARATE Socket.IO server from the gateway's and both default to the
 * "/socket.io" path, so reaching chat *through* the gateway uses the distinct "/chat-socket.io"
 * prefix that the gateway rewrites back; only a direct connection to chat-service keeps
 * "/socket.io" (see config/serverUrl.ts's chatSocketTarget).
 *
 * What is new here versus web: the AppState resume handling below. A browser tab rarely has its
 * WebSocket torn down when backgrounded, but Android will close one on an app that has been in the
 * background a while — and socket.io's own reconnect timers are unreliable while the process is
 * frozen. MOBILE_PLATFORM_ADAPTERS.md §8 calls this out as a classic RN bug: on the way back to
 * the foreground the connection must be re-established deliberately rather than assumed alive.
 * Screens that own data the socket keeps in step (messages, call state) must still refetch on
 * resume — reconnecting the transport does not replay what was missed while it was down.
 */

let socket: Socket | null = null;

function resolveTarget() {
  // Read per call, not once at module load: the server address can be changed in-app, and web's
  // answer to that (reload the page) does not exist here.
  return chatSocketTarget();
}

export function getSocket(): Socket {
  if (!socket) {
    const { url, path } = resolveTarget();
    socket = io(url, {
      path,
      // Refresh first, so a reconnect after a long pause does not hand chat-service an expired
      // token and then keep retrying with it.
      auth: async (cb) => {
        await ensureFreshAccessToken();
        cb({ token: tokenStore.get() });
      },
      autoConnect: false,
      // Voice/video call signaling still runs on chat-service until the call service is moved
      // behind the gateway socket.
      transports: ["websocket"],
      reconnectionAttempts: 5,
      timeout: 5000,
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const current = getSocket();
  if (!current.connected) {
    current.connect();
  }
  return current;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
}

let appStateSubscription: { remove: () => void } | null = null;

/**
 * Starts watching for foreground returns and reconnects the socket when one happens. Call once a
 * session exists (AppContext does it); returns a teardown function.
 *
 * Only reconnects a socket that was already created — this must never be what *starts* a
 * connection, or backgrounding the login screen would open one for a user who is not logged in.
 */
export function watchAppStateForSocketRecovery(): () => void {
  appStateSubscription?.remove();

  const handleChange = (state: AppStateStatus) => {
    if (state !== "active") return;
    if (!socket || socket.connected) return;
    socket.connect();
  };

  const subscription = AppState.addEventListener("change", handleChange);
  appStateSubscription = subscription;

  return () => {
    subscription.remove();
    if (appStateSubscription === subscription) appStateSubscription = null;
  };
}
