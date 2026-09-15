import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import type { Socket } from "socket.io-client";

import { connectSocket, disconnectSocket, getSocket } from "../realtime/socketClient";
import { isRealtimeEnabled } from "../config/serverUrl";
import type { RealtimeConnectionStatus } from "../realtime/events";
import { useApp } from "./AppContext";

type SocketContextValue = {
  socket: Socket | null;
  status: RealtimeConnectionStatus;
  connected: boolean;
  reconnect: () => void;
};

const SocketContext = createContext<SocketContextValue | undefined>(undefined);

/**
 * Keeps the gateway realtime socket open for as long as a session exists. Ported from web's
 * `context/SocketContext.tsx`: connect when authenticated (and realtime is enabled), disconnect
 * on logout.
 *
 * Found missing during Phase 5's "socket xác nhận sống" check: Phase 2 ported the chat socket
 * (`services/socket.ts`) but never this provider, so the mobile app never opened a realtime
 * connection at all. This is a parity port, not new behaviour.
 *
 * Mobile addition (MOBILE_PLATFORM_ADAPTERS.md §8): Android tears down sockets of an app left in
 * the background, and socket.io's own reconnect timers do not run while the process is frozen, so
 * returning to the foreground reconnects deliberately instead of assuming the transport survived.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useApp();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<RealtimeConnectionStatus>("idle");
  const realtimeEnabled = isRealtimeEnabled();

  useEffect(() => {
    if (!isAuthenticated || !realtimeEnabled) {
      disconnectSocket();
      setSocket(null);
      setStatus("idle");
      return;
    }

    const current = connectSocket();
    setSocket(current);
    setStatus(current.connected ? "connected" : "connecting");

    const handleConnect = () => {
      console.info("[socket] connected", current.id);
      setStatus("connected");
    };
    const handleDisconnect = (reason: string) => {
      console.warn("[socket] disconnected:", reason);
      setStatus("disconnected");
    };
    const handleConnectError = (err: Error) => {
      // Surfacing the reason is the only way to diagnose transport/auth failures without a
      // debugger attached — otherwise the socket just retries silently in the background.
      console.error("[socket] connect_error:", err.message);
      setStatus("error");
    };
    const handleReconnectAttempt = () => setStatus("connecting");

    current.on("connect", handleConnect);
    current.on("disconnect", handleDisconnect);
    current.on("connect_error", handleConnectError);
    current.io.on("reconnect_attempt", handleReconnectAttempt);

    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active" && !current.connected) {
        connectSocket();
      }
    });

    return () => {
      current.off("connect", handleConnect);
      current.off("disconnect", handleDisconnect);
      current.off("connect_error", handleConnectError);
      current.io.off("reconnect_attempt", handleReconnectAttempt);
      appStateSub.remove();
    };
  }, [isAuthenticated, realtimeEnabled]);

  const value = useMemo<SocketContextValue>(
    () => ({
      socket,
      status,
      connected: status === "connected",
      reconnect: () => {
        if (!realtimeEnabled) {
          setSocket(null);
          setStatus("idle");
          return;
        }
        setSocket(connectSocket());
        setStatus(getSocket().connected ? "connected" : "connecting");
      },
    }),
    [socket, status, realtimeEnabled],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocketContext() {
  const value = useContext(SocketContext);
  if (!value) {
    throw new Error("useSocketContext must be used inside SocketProvider");
  }
  return value;
}
