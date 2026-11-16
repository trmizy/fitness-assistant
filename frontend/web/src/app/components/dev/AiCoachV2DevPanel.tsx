/**
 * DEV-ONLY panel inside the EXISTING AI Coach page (M9.3-T1) for trying Multi-Agent V2 against a LOCAL launcher with mock
 * model / data / auth. Rendered only when the page's own build-time condition (import.meta.env.DEV && VITE_AI_COACH_V2_DEV === "1")
 * holds, so it is absent from every production bundle. Not a new page, not a new chat.
 *
 * What it does: asks the launcher (server-side, per signed-in user) to opt this account in to V2, lists the launcher's APPROVED
 * read-only synthetic scenarios, and sends the chosen scenario question through the normal AI Coach send path. It cannot grant V2:
 * the server decides. While V2 mode is on the free-text composer is disabled (and the launcher refuses non-approved text anyway).
 */
import { useEffect, useState } from "react";
import { api } from "../../services/api";
import { setCoachV2DevMode, useCoachV2DevMode } from "../../dev/coachV2Dev";

interface Scenario { id: string; title: string; question: string; expect: string }
const PATH = "/__dev/coach-v2";

export function AiCoachV2DevPanel({ onSend, busy }: { onSend: (question: string) => void; busy: boolean }) {
  const on = useCoachV2DevMode();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const loadScenarios = async () => {
    const { data } = await api.get(`${PATH}/scenarios`);
    setScenarios(Array.isArray(data?.scenarios) ? data.scenarios : []);
  };

  // the SERVER is the source of truth for the opt-in: mirror it on mount (a reload must not leave UI OFF while the launcher is ON)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`${PATH}/optin`);
        if (cancelled) return;
        if (data?.enabled === true) { setCoachV2DevMode(true); await loadScenarios(); }
        else setCoachV2DevMode(false);
      } catch {
        if (!cancelled) { setCoachV2DevMode(false); setError("Không kết nối được launcher DEV — V2 vẫn TẮT."); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = async () => {
    setPending(true); setError(null);
    try {
      const next = !on;
      const { data } = await api.post(`${PATH}/optin`, { enabled: next });
      const confirmed = data?.enabled === true;
      if (confirmed) await loadScenarios();
      setCoachV2DevMode(confirmed);
    } catch {
      setCoachV2DevMode(false);
      setError("Không bật được V2: launcher DEV không phản hồi. V2 vẫn TẮT.");
    } finally { setPending(false); }
  };

  return (
    <div data-testid="coach-v2-dev-panel" className="mb-2 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-zinc-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold text-amber-400">DEV · Multi-Agent V2</span>
          <span className="ml-2 text-zinc-400">mô hình, dữ liệu và xác thực giả lập · không phải tư vấn sức khỏe · {on ? "V2 đang BẬT (launcher cho phép) — gửi bằng JSON, không có SSE" : "mặc định TẮT (đang dùng V1)"}</span>
        </div>
        <button
          type="button" onClick={() => void toggle()} disabled={pending || busy} aria-pressed={on} data-testid="coach-v2-dev-toggle"
          className={`rounded-full border px-3 py-1 font-medium disabled:opacity-50 ${on ? "border-amber-400 bg-amber-400 text-black" : "border-zinc-600 text-zinc-200"}`}
        >
          {on ? "V2 BẬT — bấm để tắt" : "Bật thử V2"}
        </button>
      </div>
      {error && <p role="alert" data-testid="coach-v2-dev-error" className="mt-2 text-red-400">{error}</p>}
      {on && (
        <div className="mt-2 space-y-1.5" data-testid="coach-v2-dev-scenarios">
          <p className="text-zinc-400">Chỉ các kịch bản read-only đã duyệt (không nhập tự do khi V2 bật):</p>
          <div className="flex flex-wrap gap-1.5">
            {scenarios.map((s) => (
              <button
                key={s.id} type="button" disabled={busy} onClick={() => onSend(s.question)} title={s.expect}
                data-testid={`coach-v2-scenario-${s.id}`}
                className="rounded-full border border-zinc-600 px-3 py-1 text-zinc-200 hover:border-amber-400 disabled:opacity-40"
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
