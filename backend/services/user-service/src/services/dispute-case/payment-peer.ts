/**
 * E2E-isolated and dev-shared modes only: user-service must not run the CaseDecision executor, late-open reconciliation or D65-B unless payment-service - the other side of every
 * money step - evaluates the SAME runtime gate to the SAME verdict. payment-service answers GET /internal/dispute-runtime-verdict (service secret); this module asks at
 * startup and then every PEER_REFRESH_MS. "Unknown", "unreachable", "stale" (older than PEER_MAX_AGE_MS) and "different" all mean OFF. In test mode (NODE_ENV=test)
 * nothing is asked and nothing changes (the outbound guard of the tests would refuse the call anyway).
 */
import axios from "axios";
import { evaluateRuntimeGate, verdictSignature, type GateVerdict } from "./runtime-gate";

export const PEER_REFRESH_MS = 30_000;
export const PEER_MAX_AGE_MS = 3 * PEER_REFRESH_MS;

export type PeerState =
  | { status: "unknown" }
  | { status: "unreachable"; checkedAt: number; error: string }
  | { status: "checked"; checkedAt: number; payment: { mode: string; open: boolean; refusedBecause?: string } };

let state: PeerState = { status: "unknown" };
let timer: NodeJS.Timeout | undefined;

export const peerState = (): PeerState => state;

/** For tests only. */
export const __setPeerState = (s: PeerState) => {
  state = s;
};

/** Does payment-service's last answer equal OUR verdict (mode + open), and is it fresh? */
export function peerAgrees(ours: Pick<GateVerdict, "mode" | "open">, now = Date.now(), s: PeerState = state): { agrees: boolean; why?: "PEER_UNCONFIRMED" | "PEER_UNREACHABLE" | "PEER_STALE" | "PEER_MISMATCH" } {
  if (s.status === "unknown") return { agrees: false, why: "PEER_UNCONFIRMED" };
  if (s.status === "unreachable") return { agrees: false, why: "PEER_UNREACHABLE" };
  if (now - s.checkedAt > PEER_MAX_AGE_MS) return { agrees: false, why: "PEER_STALE" };
  return verdictSignature(s.payment as any) === verdictSignature(ours) ? { agrees: true } : { agrees: false, why: "PEER_MISMATCH" };
}

export async function refreshPeerVerdict(env: NodeJS.ProcessEnv = process.env): Promise<PeerState> {
  const base = env.PAYMENT_SERVICE_URL || "http://localhost:3007";
  const secret = env.INTERNAL_SERVICE_SECRET || "";
  try {
    const { data } = await axios.get(`${base}/internal/dispute-runtime-verdict`, { headers: { "x-service-secret": secret }, timeout: 5_000 });
    const v = data?.data ?? data;
    if (typeof v?.mode !== "string" || typeof v?.open !== "boolean") throw new Error("malformed verdict");
    state = { status: "checked", checkedAt: Date.now(), payment: { mode: v.mode, open: v.open, refusedBecause: v.refusedBecause } };
  } catch (e: any) {
    state = { status: "unreachable", checkedAt: Date.now(), error: String(e?.message ?? e).slice(0, 200) };
  }
  logPeer();
  return state;
}

function logPeer() {
  const ours = evaluateRuntimeGate(process.env, process.env.DB_ISOLATION === "accepted");
  const a = peerAgrees(ours);
  // eslint-disable-next-line no-console
  console.log(`[dispute-runtime-gate] user-service peer(payment)=${state.status === "checked" ? verdictSignature(state.payment as any) : state.status} ours=${verdictSignature(ours)} agrees=${a.agrees}${a.why ? ` (${a.why})` : ""}`);
}

/** Starts the monitor ONLY in e2e-isolated or dev-shared mode with an open gate; returns the stop function. */
export function startPeerVerdictMonitor(env: NodeJS.ProcessEnv = process.env): () => void {
  const ours = evaluateRuntimeGate(env, env.DB_ISOLATION === "accepted");
  if ((ours.mode !== "e2e-isolated" && ours.mode !== "dev-shared") || !ours.open) return () => undefined;
  void refreshPeerVerdict(env);
  timer = setInterval(() => void refreshPeerVerdict(env), PEER_REFRESH_MS);
  timer.unref();
  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
}
