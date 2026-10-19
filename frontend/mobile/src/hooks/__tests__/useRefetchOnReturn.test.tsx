import { AppState, Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

import { useRefetchOnReturn } from "../useRefetchOnReturn";

/**
 * Regression (D25 follow-up): the PT terms banner stayed on its old wording for minutes after the server
 * changed the terms version, because the screen stays mounted and window-focus refetch is off globally.
 */

let focusCallback: (() => void) | undefined;
jest.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void) => {
    focusCallback = cb;
  },
}));

const KEY = ["pt-terms", "user-1"];

function Probe({ enabled = true }: { enabled?: boolean }) {
  const q = useQuery({ queryKey: KEY, queryFn: () => fetcher(), staleTime: 60_000 });
  useRefetchOnReturn(KEY, enabled);
  return <Text>{q.data ?? "loading"}</Text>;
}

let fetcher: jest.Mock;
let client: QueryClient;
const mount = (enabled = true) =>
  render(
    <QueryClientProvider client={client}>
      <Probe enabled={enabled} />
    </QueryClientProvider>,
  );

describe("useRefetchOnReturn", () => {
  beforeEach(() => {
    // jest-expo's AppState mock returns no subscription by default.
    jest.spyOn(AppState, "addEventListener").mockImplementation((() => ({ remove: jest.fn() })) as never);
    let n = 0;
    fetcher = jest.fn(async () => `v${++n}`);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  });
  afterEach(() => {
    client.clear();
    jest.restoreAllMocks();
  });

  it("re-reads a still-fresh query when the screen is focused again", async () => {
    const view = await mount();
    await act(async () => {});
    expect(view.getByText("v1")).toBeTruthy();

    await act(async () => focusCallback?.());
    expect(fetcher).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(view.getByText("v2")).toBeTruthy());
  });

  it("re-reads when the app returns to the foreground, not when it goes to the background", async () => {
    let onChange: ((state: string) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_t: string, h: (s: string) => void) => {
      onChange = h;
      return { remove: jest.fn() };
    }) as never);
    const view = await mount();
    await act(async () => {});
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => onChange?.("background"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => onChange?.("active"));
    expect(fetcher).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(view.getByText("v2")).toBeTruthy());
  });

  it("does nothing while disabled (no signed-in user)", async () => {
    await mount(false);
    await act(async () => {});
    await act(async () => focusCallback?.());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
