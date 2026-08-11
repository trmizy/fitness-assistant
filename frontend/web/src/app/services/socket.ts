import { io, Socket } from "socket.io-client";
import { chatSocketTarget } from "../config/serverUrl";
import { Preferences } from "@capacitor/preferences";

// Empty string = same-origin (current page), proxied by Vite in dev under
// "/chat-socket.io" (see vite.config.ts) to chat-service's real
// "/socket.io" path — a distinct proxy path is needed because chat-service
// runs a SEPARATE Socket.IO server from the gateway's, and both default to
// the same "/socket.io" path, which would otherwise collide on one origin.
// Set VITE_CHAT_WS_URL to an absolute URL to bypass the proxy and connect
// directly to chat-service, which still expects its own real "/socket.io"
// path in that case.
// A stored runtime override (in-app "Cấu hình máy chủ") routes chat through the
// gateway's "/chat-socket.io" proxy so the APK only needs ONE public URL — see
// config/serverUrl.ts.
const { url: CHAT_WS_URL, path: CHAT_WS_PATH } = chatSocketTarget();

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(CHAT_WS_URL, {
      path: CHAT_WS_PATH,
      auth: async (cb) => {
        const { value: token } = await Preferences.get({ key: "accessToken" });
        cb({ token });
      },
      autoConnect: false,
      // Voice/video call signaling still runs on chat-service until the call
      // service is moved behind the gateway socket.
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
}
