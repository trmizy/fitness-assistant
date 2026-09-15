import { AppState, Text } from "react-native";
import { act, render } from "@testing-library/react-native";

/**
 * The realtime SocketProvider. It was missing from mobile until Phase 5's "socket xác nhận sống"
 * check found the app never opened a gateway socket at all; its liveness and resume behaviour were
 * then verified on the emulator against the gateway. These tests pin the provider's own contract so
 * it cannot silently regress: connect when a session exists, disconnect on logout, track status from
 * socket events, and reconnect deliberately when the app returns to the foreground.
 */

type Handler = (...args: any[]) => void;

function createFakeSocket() {
  const handlers = new Map<string, Handler>();
  const ioHandlers = new Map<string, Handler>();
  return {
    connected: false,
    id: "fake-socket",
    on: jest.fn((event: string, handler: Handler) => handlers.set(event, handler)),
    off: jest.fn((event: string) => handlers.delete(event)),
    io: {
      on: jest.fn((event: string, handler: Handler) => ioHandlers.set(event, handler)),
      off: jest.fn((event: string) => ioHandlers.delete(event)),
    },
    emit(event: string, ...args: any[]) {
      handlers.get(event)?.(...args);
    },
    emitManager(event: string, ...args: any[]) {
      ioHandlers.get(event)?.(...args);
    },
  };
}

const mockSocket = createFakeSocket();
const mockConnectSocket = jest.fn(() => mockSocket);
const mockDisconnectSocket = jest.fn();
let mockAuthenticated = true;
let mockRealtimeEnabled = true;

jest.mock("../../realtime/socketClient", () => ({
  connectSocket: () => mockConnectSocket(),
  disconnectSocket: () => mockDisconnectSocket(),
  getSocket: () => mockSocket,
}));

jest.mock("../../config/serverUrl", () => ({
  isRealtimeEnabled: () => mockRealtimeEnabled,
}));

jest.mock("../AppContext", () => ({
  useApp: () => ({ isAuthenticated: mockAuthenticated }),
}));

// Kept below the mocks for the reader: babel-jest hoists jest.mock regardless, but seeing the mocks
// first makes it obvious the provider is imported against them.
// eslint-disable-next-line import/first
import { SocketProvider, useSocketContext } from "../SocketContext";

function Status() {
  const { status } = useSocketContext();
  return <Text testID="status">{status}</Text>;
}

function renderProvider() {
  return render(
    <SocketProvider>
      <Status />
    </SocketProvider>,
  );
}

let appStateListener: ((state: string) => void) | undefined;

beforeEach(() => {
  mockConnectSocket.mockClear();
  mockDisconnectSocket.mockClear();
  mockSocket.connected = false;
  mockAuthenticated = true;
  mockRealtimeEnabled = true;
  appStateListener = undefined;
  // The provider logs connect/disconnect/error on purpose (it is the only diagnostic without a
  // debugger attached); keep that out of the test output.
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type: any, listener: any) => {
    appStateListener = listener;
    return { remove: jest.fn() } as any;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SocketProvider", () => {
  it("connects when a session exists and reports 'connecting' until the socket says otherwise", async () => {
    const view = await renderProvider();
    expect(mockConnectSocket).toHaveBeenCalledTimes(1);
    expect(view.getByTestId("status").props.children).toBe("connecting");

    await act(async () => {
      mockSocket.emit("connect");
    });
    expect(view.getByTestId("status").props.children).toBe("connected");
  });

  it("tracks disconnects, errors and reconnect attempts", async () => {
    const view = await renderProvider();
    // Keep the test output clean: the provider logs these on purpose.
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      mockSocket.emit("disconnect", "transport error");
    });
    expect(view.getByTestId("status").props.children).toBe("disconnected");

    await act(async () => {
      mockSocket.emitManager("reconnect_attempt");
    });
    expect(view.getByTestId("status").props.children).toBe("connecting");

    await act(async () => {
      mockSocket.emit("connect_error", new Error("xhr poll error"));
    });
    expect(view.getByTestId("status").props.children).toBe("error");
  });

  it("does not connect without a session, and disconnects when the session ends", async () => {
    mockAuthenticated = false;
    const view = await renderProvider();
    expect(mockConnectSocket).not.toHaveBeenCalled();
    expect(view.getByTestId("status").props.children).toBe("idle");

    mockAuthenticated = true;
    await act(async () => {
      view.rerender(
        <SocketProvider>
          <Status />
        </SocketProvider>,
      );
    });
    expect(mockConnectSocket).toHaveBeenCalledTimes(1);

    mockAuthenticated = false;
    mockDisconnectSocket.mockClear();
    await act(async () => {
      view.rerender(
        <SocketProvider>
          <Status />
        </SocketProvider>,
      );
    });
    expect(mockDisconnectSocket).toHaveBeenCalled();
    expect(view.getByTestId("status").props.children).toBe("idle");
  });

  it("stays idle when realtime is disabled for the build", async () => {
    mockRealtimeEnabled = false;
    const view = await renderProvider();
    expect(mockConnectSocket).not.toHaveBeenCalled();
    expect(view.getByTestId("status").props.children).toBe("idle");
  });

  it("reconnects when the app comes back to the foreground with a dropped socket", async () => {
    await renderProvider();
    expect(appStateListener).toBeDefined();
    mockConnectSocket.mockClear();

    mockSocket.connected = false;
    await act(async () => {
      appStateListener!("active");
    });
    expect(mockConnectSocket).toHaveBeenCalledTimes(1);
  });

  it("does not reconnect on resume when the socket is still connected, or when going to background", async () => {
    await renderProvider();
    mockConnectSocket.mockClear();

    mockSocket.connected = true;
    await act(async () => {
      appStateListener!("active");
    });
    mockSocket.connected = false;
    await act(async () => {
      appStateListener!("background");
    });
    expect(mockConnectSocket).not.toHaveBeenCalled();
  });
});
