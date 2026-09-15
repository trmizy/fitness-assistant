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
