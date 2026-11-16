import type { CoachV2View } from "../../services/coachV2Response";

const TONE: Record<CoachV2View["tone"], string> = {
  ok: "border-emerald-500/40 text-emerald-300",
  partial: "border-amber-500/50 text-amber-300",
  blocked: "border-sky-500/50 text-sky-300",
  error: "border-red-500/50 text-red-300",
};

/**
 * Status strip under an AI Coach reply that was served by Multi-Agent V2. It shows ONLY what the backend returned: the state
 * (a blocked / partial / failed turn is labelled as such, never as an ordinary answer), the executed agents and trace id when
 * the backend sent them, and whether the turn was saved to history. A V1 reply has no `v2` field, so nothing is rendered.
 */
export function CoachV2Badge({ v2 }: { v2: CoachV2View }) {
  return (
    <div
      data-testid="coach-v2-badge" data-v2-status={v2.status} data-v2-kind={v2.kind}
      className={`mt-2 space-y-0.5 rounded-lg border px-2.5 py-1.5 text-xs ${TONE[v2.tone]}`}
    >
      <p className="font-medium">{v2.engineLabel} · {v2.statusLabel}</p>
      {v2.agents.length > 0 && <p className="text-zinc-400">Agent đã chạy: {v2.agents.join(", ")}</p>}
      {v2.replayed && <p className="text-zinc-400">Kết quả được trả lại từ lượt đã xử lý trước đó (không chạy lại).</p>}
      {v2.historyNote && <p className="text-zinc-500">{v2.historyNote}</p>}
      {v2.traceId && <p className="text-zinc-500">trace {v2.traceId.slice(0, 8)}</p>}
    </div>
  );
}
