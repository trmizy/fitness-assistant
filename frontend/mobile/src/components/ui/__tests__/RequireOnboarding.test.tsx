import { Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { RequireOnboarding } from "../../guards/RequireOnboarding";
import { profileService } from "../../../services/api";

/**
 * The onboarding gate fails OPEN when the profile cannot be fetched — and that has to hold through
 * every later refetch. Regression (real phone, 6/10): with the saved server unreachable the gate
 * unmounted the whole workspace on each retry cycle, so the app was a blank screen forever with no
 * way to reach Settings or log out.
 */

jest.mock("../../../context/AppContext", () => ({
  useApp: () => ({ role: "client", isAuthenticated: true, user: { id: "u1" } }),
}));

jest.mock("../../../theme/workspace", () => ({ useWorkspaceAccent: () => ({ primary: "#22C55E" }) }));

jest.mock("expo-router", () => ({
  usePathname: () => "/client/dashboard",
  Redirect: ({ href }: { href: any }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text: RNText } = require("react-native");
    return <RNText>{`REDIRECT:${typeof href === "string" ? href : href?.pathname}`}</RNText>;
  },
}));

jest.mock("../../../services/api", () => ({ profileService: { getProfile: jest.fn() } }));

const getProfile = profileService.getProfile as jest.Mock;

// No garbage-collection timers: they would keep jest alive after the run.
const newClient = () => new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });

async function renderGate(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <RequireOnboarding>
        <Text>nội dung workspace</Text>
      </RequireOnboarding>
    </QueryClientProvider>,
  );
}

describe("RequireOnboarding", () => {
  afterEach(() => getProfile.mockReset());

  it("keeps the workspace up while a failed profile fetch is retried", async () => {
    getProfile.mockRejectedValue(new Error("Network Error"));
    const client = newClient();
    const view = await renderGate(client);
    await waitFor(() => expect(view.getByText("nội dung workspace")).toBeTruthy());

    // A refetch puts the data-less query back to "pending" — the gate must not blank the app.
    let release!: (value: unknown) => void;
    getProfile.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    await act(async () => {
      void client.refetchQueries({ queryKey: ["profile", "u1"] });
    });
    expect(client.getQueryState(["profile", "u1"])?.status).toBe("pending");
    expect(view.getByText("nội dung workspace")).toBeTruthy();

    // Once a real profile arrives, the normal check runs again.
    await act(async () => {
      release({ profile: { hasCompletedOnboarding: false } });
    });
    await waitFor(() => expect(view.getByText("REDIRECT:/client/onboarding")).toBeTruthy());
  });

  it("lets a client with a finished profile in, and sends an unfinished one to onboarding", async () => {
    getProfile.mockResolvedValue({ profile: { hasCompletedOnboarding: true } });
    const done = await renderGate(newClient());
    await waitFor(() => expect(done.getByText("nội dung workspace")).toBeTruthy());

    getProfile.mockResolvedValue({ profile: null });
    const fresh = await renderGate(newClient());
    await waitFor(() => expect(fresh.getByText("REDIRECT:/client/onboarding")).toBeTruthy());
  });
});
