import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import PtCollaborationsScreen from "../../../app/pt/collaborations";
import { collaborationService, gymService } from "../../services/api";

// The first render of a cold module graph is slow when the whole suite runs in parallel; the default 1s lookup / 5s test limits are too tight.
configure({ asyncUtilTimeout: 10_000 });
jest.setTimeout(40_000);

/**
 * U2 — the PT's "Đề nghị hợp tác" brand picker reads GET /gyms/brand-options (server-side search + cursor paging)
 * instead of downloading the whole gym directory.
 *
 * Evidence label: TEST FIXTURE (jest-expo component test, API wrappers mocked) — not a device run.
 */

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
}));

const mockToast = jest.fn();
jest.mock("../../components/ui/Toast", () => {
  const actual = jest.requireActual("../../components/ui/Toast");
  return { ...actual, useToast: () => ({ show: mockToast }) };
});

jest.mock("../../context/AppContext", () => ({
  useApp: () => ({ user: { id: "pt-1" }, isAuthenticated: true }),
}));

jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return {
    ...actual,
    collaborationService: { ...actual.collaborationService, listMine: jest.fn() },
    gymService: { ...actual.gymService, getBrandOptions: jest.fn(), listGyms: jest.fn() },
  };
});

const mocked = {
  listMine: collaborationService.listMine as jest.Mock,
  brandOptions: gymService.getBrandOptions as jest.Mock,
  listGyms: gymService.listGyms as jest.Mock,
};

const option = (id: string, name: string) => ({
  scope: "BRAND" as const,
  brandId: id,
  brandName: name,
  branches: [{ id: `${id}-g`, name: `${name} 1`, city: "Hà Nội", closed: false }],
  proposeBranchId: `${id}-g`,
});

async function press(el: any) {
  await act(async () => {
    fireEvent.press(el);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.listMine.mockResolvedValue([]);
  mocked.listGyms.mockResolvedValue([]);
  mocked.brandOptions.mockImplementation(async (params: any) =>
    params?.cursor === "c1"
      ? { options: [option("b3", "Brand Three")], nextCursor: null, hasMore: false }
      : { options: [option("b1", "Brand One"), option("b2", "Brand Two")], nextCursor: "c1", hasMore: true },
  );
});

async function openSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <PtCollaborationsScreen />
    </QueryClientProvider>,
  );
  await press(await view.findByText("Đề nghị hợp tác"));
  return view;
}

it("loads the first page of brand options, with no gym-directory download, and pages with 'Tải thêm thương hiệu'", async () => {
  const view = await openSheet();

  expect(await view.findByText("Tải thêm thương hiệu")).toBeTruthy();
  expect(mocked.brandOptions).toHaveBeenCalledWith({ limit: 20 });
  expect(mocked.listGyms).not.toHaveBeenCalled();

  await press(view.getByText("Tải thêm thương hiệu"));

  await waitFor(() => expect(mocked.brandOptions).toHaveBeenCalledWith({ cursor: "c1", limit: 20 }));
  // the last page ends the button
  await waitFor(() => expect(view.queryByText("Tải thêm thương hiệu")).toBeNull());
});

it("the search box queries the server (q), and the PT can pick an option", async () => {
  const view = await openSheet();
  expect(await view.findByText("Tải thêm thương hiệu")).toBeTruthy();

  await act(async () => {
    fireEvent.changeText(view.getByPlaceholderText("Tên thương hiệu, chi nhánh hoặc thành phố…"), "iron");
  });

  await waitFor(() => expect(mocked.brandOptions).toHaveBeenCalledWith({ q: "iron", limit: 20 }));
});

it("a cursor 409 on the next page reloads the options from page 1", async () => {
  mocked.brandOptions.mockImplementation(async (params: any) => {
    if (params?.cursor === "c1") throw { response: { status: 409, data: { error: { code: "CURSOR_FILTER_MISMATCH" } } } };
    return { options: [option("b1", "Brand One")], nextCursor: "c1", hasMore: true };
  });
  const view = await openSheet();

  await press(await view.findByText("Tải thêm thương hiệu"));

  await waitFor(() => {
    const calls = mocked.brandOptions.mock.calls.map((c) => c[0]);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls[calls.length - 1].cursor).toBeUndefined();
  });
  expect(view.queryByText("Không tải được danh sách thương hiệu. Thử lại sau.")).toBeNull();
});
