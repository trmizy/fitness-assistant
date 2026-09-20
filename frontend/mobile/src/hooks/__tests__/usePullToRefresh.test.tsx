import { Text } from "react-native";
import { act, render } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { usePullToRefresh } from "../usePullToRefresh";

/**
 * Pull-to-refresh was verified on the emulator by counting server-side requests. What these tests
 * protect is the part that silently breaks: every key is REFETCHED (not merely invalidated, which
 * would drop the spinner before any data arrived), the spinner stays up until the network work is
 * done, and a failed refetch still ends it.
 */

type Harness = { onRefresh: () => Promise<void> };

function renderHarness(client: QueryClient, keys: unknown[][]) {
  const harness = {} as Harness;

  function Probe() {
    const { refreshing, onRefresh } = usePullToRefresh(keys);
    harness.onRefresh = onRefresh;
    return <Text testID="state">{refreshing ? "refreshing" : "idle"}</Text>;
  }

  return render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  ).then((view) => ({ view, harness }));
}

describe("usePullToRefresh", () => {
  it("refetches every key and keeps the spinner up until all of them finish", async () => {
    const client = new QueryClient();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const refetch = jest.spyOn(client, "refetchQueries").mockImplementation(() => pending);

    const keys = [
      ["profile", "u1"],
      ["inbody-history"],
    ];
    const { view, harness } = await renderHarness(client, keys);
    expect(view.getByTestId("state").props.children).toBe("idle");

    let done!: Promise<void>;
    await act(async () => {
      done = harness.onRefresh();
    });

    expect(refetch).toHaveBeenCalledTimes(2);
    expect(refetch).toHaveBeenCalledWith({ queryKey: ["profile", "u1"] });
    expect(refetch).toHaveBeenCalledWith({ queryKey: ["inbody-history"] });
    expect(view.getByTestId("state").props.children).toBe("refreshing");

    await act(async () => {
      finish();
      await done;
    });
    expect(view.getByTestId("state").props.children).toBe("idle");
  });

  it("a failed refetch still ends the spinner", async () => {
    const client = new QueryClient();
    jest.spyOn(client, "refetchQueries").mockRejectedValue(new Error("network down"));

    const { view, harness } = await renderHarness(client, [["workout-schedules", "week"]]);

    await act(async () => {
      await harness.onRefresh();
    });

    expect(view.getByTestId("state").props.children).toBe("idle");
  });
});
