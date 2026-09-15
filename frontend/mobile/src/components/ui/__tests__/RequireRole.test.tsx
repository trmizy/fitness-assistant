import { Text } from "react-native";
import { render } from "@testing-library/react-native";

import { RequireRole } from "../../guards/RequireRole";
import type { UserRole } from "../../../context/AppContext";

/**
 * The role guard decides three different things and gets each wrong in a different way: letting
 * the wrong actor into a workspace, blocking the right one, or sending a signed-out visitor
 * somewhere other than login. All three are checked here.
 *
 * `useApp` is mocked because the guard's whole job is reacting to auth state — building a real
 * session per case would test the login flow instead of the guard. Everything else runs for real,
 * including the redirect element expo-router produces.
 */

const mockUseApp = jest.fn();

jest.mock("../../../context/AppContext", () => ({
  useApp: () => mockUseApp(),
}));

jest.mock("expo-router", () => ({
  usePathname: () => "/pt/dashboard",
  router: { replace: jest.fn() },
  // Renders as a marker so a redirect is observable without a navigator in the tree.
  Redirect: ({ href }: { href: any }) => {
    const { Text: RNText } = require("react-native");
    const target = typeof href === "string" ? href : href?.pathname;
    return <RNText>{`REDIRECT:${target}`}</RNText>;
  },
}));

function setSession(role: UserRole, isAuthenticated = true) {
  mockUseApp.mockReturnValue({ role, isAuthenticated });
}

function renderGuard(allow: UserRole[]) {
  return render(
    <RequireRole allow={allow}>
      <Text>nội dung workspace</Text>
    </RequireRole>,
  );
}

describe("RequireRole", () => {
  afterEach(() => {
    mockUseApp.mockReset();
  });

  it("renders the workspace for a role on the allow list", async () => {
    setSession("pt");
    const view = await renderGuard(["pt"]);
    expect(view.getByText("nội dung workspace")).toBeTruthy();
  });

  it("blocks a role that is not on the list, and never renders the workspace", async () => {
    setSession("client");
    const view = await renderGuard(["pt"]);

    expect(view.queryByText("nội dung workspace")).toBeNull();
    expect(view.getByText(/403/)).toBeTruthy();
  });

  it("gives the blocked user a way out", async () => {
    // On web a wrong turn is recoverable through the address bar; here the hardware back key can
    // quit the app instead, so the escape has to be on screen.
    setSession("client");
    const view = await renderGuard(["admin"]);
    expect(view.getByText("Về trang chủ của bạn")).toBeTruthy();
  });

  it("sends a signed-out visitor to login rather than showing 403", async () => {
    // The distinction matters: 403 tells someone they lack permission, when what they actually
    // need is to sign in.
    setSession("client", false);
    const view = await renderGuard(["client"]);

    expect(view.queryByText(/403/)).toBeNull();
    expect(view.getByText("REDIRECT:/login")).toBeTruthy();
  });

  it("admits a PT to the client workspace, which allows both roles", async () => {
    // A trainer is also a trainee — the client workspace lists both roles for this reason.
    setSession("pt");
    const view = await renderGuard(["client", "pt"]);
    expect(view.getByText("nội dung workspace")).toBeTruthy();
  });

  it("keeps a client out of the admin console", async () => {
    setSession("client");
    const view = await renderGuard(["admin"]);
    expect(view.queryByText("nội dung workspace")).toBeNull();
  });

  it("keeps a gym owner out of the PT workspace", async () => {
    setSession("gym_owner");
    const view = await renderGuard(["pt"]);
    expect(view.queryByText("nội dung workspace")).toBeNull();
  });
});
