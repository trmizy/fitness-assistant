/**
 * JSON client for the LOCAL V2 demo API only (same-origin via the Vite dev proxy). It sends a fixture scenario id and nothing else:
 * no free text, no token, no secret. It is not the V1 chat client and shares no state with it.
 */
import type { DemoRunResponse, DemoScenarioList } from "../pages/internal/aiV2DemoMapping";

const BASE = "/internal-demo-api";

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error;
    throw new Error(msg ? `${msg} (HTTP ${res.status})` : `Demo API HTTP ${res.status}`);
  }
  return body as T;
}

export const aiV2DemoService = {
  async scenarios(signal?: AbortSignal): Promise<DemoScenarioList> {
    return readJson<DemoScenarioList>(await fetch(`${BASE}/demo/scenarios`, { signal, headers: { Accept: "application/json" } }));
  },
  async run(scenarioId: string, signal?: AbortSignal): Promise<DemoRunResponse> {
    return readJson<DemoRunResponse>(await fetch(`${BASE}/demo/run`, {
      method: "POST", signal, headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ scenarioId }),
    }));
  },
};
