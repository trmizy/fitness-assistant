import { Text } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppProvider, useApp } from "../AppContext";

/**
 * Regression (real phone, 6/10): registration's OTP step stores the new account's tokens and hands
 * the user to `setUser` — which was the bare state setter, so `isAuthenticated` stayed false and
 * the role guard sent a freshly verified account from onboarding back to the login screen.
 */

jest.mock("expo-router", () => ({ usePathname: () => "/register" }));
jest.mock("expo-notifications", () => ({}));
jest.mock("../../services/storage", () => ({ Preferences: { set: jest.fn(), get: jest.fn(), remove: jest.fn() } }));
jest.mock("../../services/api", () => ({ authService: { login: jest.fn(), logout: jest.fn() } }));
jest.mock("../../services/session", () => ({
  bootstrapSession: jest.fn().mockResolvedValue({ status: "unauthenticated" }),
  ensureFreshAccessToken: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../services/sessionEvents", () => ({ onSessionExpired: () => () => undefined }));
jest.mock("../../features/push/pushDevice", () => ({ unregisterPushToken: jest.fn() }));

function Probe() {
  const app = useApp();
  return (
    <>
      <Text>{`auth:${app.isAuthenticated} role:${app.role} user:${app.user?.email ?? "-"}`}</Text>
      <Text onPress={() => app.setUser({ id: "u1", email: "moi@example.com", role: "CUSTOMER" } as never)}>adopt</Text>
      <Text onPress={() => app.setUser(null)}>clear</Text>
    </>
  );
}

describe("AppProvider.setUser", () => {
  it("adopting a user signs them in; clearing it signs them out", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const view = await render(
      <QueryClientProvider client={client}>
        <AppProvider>
          <Probe />
        </AppProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(view.getByText("auth:false role:client user:-")).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByText("adopt"));
    });
    expect(view.getByText("auth:true role:client user:moi@example.com")).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByText("clear"));
    });
    expect(view.getByText("auth:false role:client user:-")).toBeTruthy();
  });
});
