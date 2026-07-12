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

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      setSocket(null);
      setStatus("idle");
      return;
    }

    const current = connectSocket();
    setSocket(current);
    setStatus(current.connected ? "connected" : "connecting");

    const handleConnect = () => setStatus("connected");
    const handleDisconnect = () => setStatus("disconnected");
    const handleConnectError = () => setStatus("error");
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
  }, [isAuthenticated]);

  const value = useMemo<SocketContextValue>(
    () => ({
      socket,
      status,
      connected: status === "connected",
      reconnect: () => {
        setSocket(connectSocket());
        setStatus(getSocket().connected ? "connected" : "connecting");
      },
    }),
    [socket, status],
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
