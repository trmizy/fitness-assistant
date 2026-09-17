/**
 * Test environment setup.
 *
 * Everything mocked here is a NATIVE capability with no JS implementation to run under Jest —
 * mocking them is the only option, not a shortcut around real behaviour. The component logic under
 * test (timers, gesture thresholds, state) runs for real.
 */

// Reanimated ships its own Jest mock, which runs animations synchronously so a test can assert the
// end state without waiting on frames.
require("react-native-reanimated").setUpTests();

// gesture-handler's own setup, required before its jest-utils can drive a real gesture stream
// through a handler (fireGestureHandler / getByGestureTestId).
require("react-native-gesture-handler/jestSetup");

// Haptics: a vibration motor cannot exist here, and every call site is fire-and-forget.
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

// expo-image is a native view with no JS implementation. It is reached from almost every test
// through the design-system barrel (Avatar imports it), so without this every suite fails at
// import time with "requireNativeViewManager is not available".
jest.mock("expo-image", () => {
  const { Image } = require("react-native");
  return { Image, ImageBackground: Image };
});

// Safe-area insets come from the device; fixed values keep layout assertions deterministic.
jest.mock("react-native-safe-area-context", () => {
  const inset = { top: 44, right: 0, bottom: 34, left: 0 };
  const { View } = require("react-native");
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: View,
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
  };
});

// AsyncStorage is a native module; the package ships its own in-memory Jest mock, which is what
// the service tests need — Preferences (services/storage.ts) is the first thing services/api.ts
// touches at import time, and a thrown "NativeModule is null" there takes the whole suite down.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

// expo-secure-store has no JS implementation off-device. The refresh token lives here; an
// in-memory map keeps the same semantics (write, read back, delete) the session code relies on.
jest.mock("expo-secure-store", () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key) => void store.delete(key)),
    isAvailableAsync: jest.fn(async () => true),
    WHEN_UNLOCKED: "whenUnlocked",
  };
});

// Download/share (services/files.ts) reach native file and share sheets. The service tests never
// exercise them — they are mocked so that importing services/api.ts, which pulls files.ts in for
// the export flows, does not fail on a missing native module.
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => false),
  shareAsync: jest.fn(async () => undefined),
}));

jest.mock("expo-file-system", () => {
  class File {
    constructor(...parts) { this.uri = parts.join("/"); }
    create() {}
    write() {}
    delete() {}
    get exists() { return false; }
  }
  class Directory {
    constructor(...parts) { this.uri = parts.join("/"); }
    create() {}
    get exists() { return true; }
  }
  return { File, Directory, Paths: { cache: "file:///cache", document: "file:///document" } };
});
