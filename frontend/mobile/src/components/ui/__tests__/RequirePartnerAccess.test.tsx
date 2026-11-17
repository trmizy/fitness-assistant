import { Text } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

import { RequirePartnerAccess } from "../../guards/RequirePartnerAccess";

/**
 * NE-12 — a revoked staff member used to be stuck on "Không đọc được trạng thái hồ sơ" with only
 * "Kiểm tra lại" and no way to sign out. The status call answers 403 PARTNER_ACCESS_REVOKED; the
 * guard must say so in plain Vietnamese and offer "Đăng xuất" (the app's own logout).
 */

const mockLogout = jest.fn();
const mockStatus = jest.fn();
const mockOwned = jest.fn();

jest.mock("../../../context/AppContext", () => ({
  useApp: () => ({ isAuthenticated: true, role: "gym_owner", user: { id: "u1" }, logout: mockLogout }),
}));
jest.mock("../../../services/api", () => ({
  partnerApplicationService: { status: () => mockStatus() },
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../../../features/gymOwner/PartnerOnboardingWizard", () => ({ PartnerOnboardingWizard: () => null }));
jest.mock("../../../features/partnerApplication/ApplicantHome", () => ({ ApplicantHome: () => null }));

function renderGuard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RequirePartnerAccess>
        <Text>nội dung workspace</Text>
      </RequirePartnerAccess>
    </QueryClientProvider>,
  );
}

describe("RequirePartnerAccess (NE-12)", () => {
  afterEach(() => {
    mockLogout.mockReset();
    mockStatus.mockReset();
  });

  it("revoked access: clear message, a sign-out button, and no misleading retry", async () => {
    mockStatus.mockRejectedValue({
      response: { status: 403, data: { success: false, error: { code: "PARTNER_ACCESS_REVOKED", message: "đã bị thu hồi" } } },
    });
    const view = await renderGuard();

    await waitFor(() => expect(view.getByText("Quyền truy cập đã bị thu hồi")).toBeTruthy());
    expect(view.queryByText("Không đọc được trạng thái hồ sơ")).toBeNull();
    expect(view.queryByText("Kiểm tra lại")).toBeNull();
    expect(view.queryByText("nội dung workspace")).toBeNull();

    fireEvent.press(view.getByText("Đăng xuất"));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("an unreadable status (network) keeps the retry but now also offers sign-out", async () => {
    mockStatus.mockRejectedValue(new Error("Network Error"));
    const view = await renderGuard();

    await waitFor(() => expect(view.getByText("Không đọc được trạng thái hồ sơ")).toBeTruthy());
    expect(view.getByText("Kiểm tra lại")).toBeTruthy();
    fireEvent.press(view.getByText("Đăng xuất"));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});

/**
 * N15M-06 — the revoke lands while the app is open: the status was read fine on mount (ACTIVE), then a
 * screen's own /owner/* read answers 403 PARTNER_ACCESS_REVOKED. The guard must swap to the same screen a
 * restart shows, instead of leaving the red per-screen error.
 */
describe("RequirePartnerAccess — revoked while the app is open (N15M-06)", () => {
  function Child() {
    const q = useQuery({ queryKey: ["owned-gyms", "u1"], queryFn: () => mockOwned(), retry: false });
    return <Text>{q.isError ? "Không tải được danh sách chi nhánh" : "đang tải"}</Text>;
  }
  function renderWith(child: React.ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <RequirePartnerAccess>{child}</RequirePartnerAccess>
      </QueryClientProvider>,
    );
  }
  afterEach(() => {
    mockStatus.mockReset();
    mockOwned.mockReset();
  });

  it("a later 403 PARTNER_ACCESS_REVOKED shows 'Quyền truy cập đã bị thu hồi' with sign-out", async () => {
    mockStatus.mockResolvedValue({ accessState: "ACTIVE" });
    mockOwned.mockRejectedValue({ response: { status: 403, data: { success: false, error: { code: "PARTNER_ACCESS_REVOKED" } } } });
    const view = await renderWith(<Child />);
    await waitFor(() => expect(view.getByText("Quyền truy cập đã bị thu hồi")).toBeTruthy());
    expect(view.queryByText("Không tải được danh sách chi nhánh")).toBeNull();
    expect(view.queryByText("Kiểm tra lại")).toBeNull();
    fireEvent.press(view.getByText("Đăng xuất"));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("another 403 (this endpoint is not for this role) or a network error does NOT lock the workspace", async () => {
    mockStatus.mockResolvedValue({ accessState: "ACTIVE" });
    mockOwned.mockRejectedValue({ response: { status: 403, data: { success: false, error: { code: "OWNER_ROLE_REQUIRED" } } } });
    const view = await renderWith(<Child />);
    await waitFor(() => expect(view.getByText("Không tải được danh sách chi nhánh")).toBeTruthy());
    expect(view.queryByText("Quyền truy cập đã bị thu hồi")).toBeNull();
  });
});
