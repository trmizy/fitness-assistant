import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
      // connect_error swallowed the actual reason before — surfacing it is the
      // only way to diagnose transport/CORS/auth failures without a debugger
      // attached, since the socket silently retries in the background otherwise.
      console.error("[socket] connect_error:", err.message, err);
      setStatus("error");
    };
    const handleReconnectAttempt = () => setStatus("connecting");

    current.on("connect", handleConnect);
    current.on("disconnect", handleDisconnect);
    current.on("connect_error", handleConnectError);
    current.io.on("reconnect_attempt", handleReconnectAttempt);

    return () => {
      current.off("connect", handleConnect);
      current.off("disconnect", handleDisconnect);
      current.off("connect_error", handleConnectError);
      current.io.off("reconnect_attempt", handleReconnectAttempt);
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

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
}

export function useSocketContext() {
  const value = useContext(SocketContext);
  if (!value) {
    throw new Error("useSocketContext must be used inside SocketProvider");
  }
  return value;
}
