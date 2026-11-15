import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiV2DemoService } from "../../services/aiV2Demo";
import { AGENT_LABEL, mapRun, type DemoScenario, type DemoScenarioList, type StatusTone, type TurnView } from "./aiV2DemoMapping";

/**
 * Internal, local-only page for the GYMINI Multi-Agent V2 OFFLINE demo. Route: /internal/ai-v2-demo (registered only in a DEV build,
 * and this component also renders nothing outside DEV, same convention as the other dev pages).
 *
 * It talks ONLY to the local demo API through the same-origin proxy and sends a fixture scenario id — no free text. It does not touch
 * the V1 chat (/client/ai-coach), pendingAiTasks or any V1 service. Mock models + synthetic data: NOT health advice.
 */
const MAX_RETRIES = 2;
const TONE: Record<StatusTone, string> = {
  ok: "border-primary/40 bg-primary/10 text-primary",
  partial: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500",
  blocked: "border-orange-500/40 bg-orange-500/10 text-orange-500",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
};

function Chip({ children, tone = "ok" }: { children: React.ReactNode; tone?: StatusTone }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}

function TurnCard({ t, index }: { t: TurnView; index: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid={`turn-${index}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{t.label}</span>
        <Chip tone={t.status.tone}>{t.status.label}</Chip>
        <span className="text-xs text-muted-foreground">HTTP {t.httpStatus}</span>
      </div>
      <p className="mb-1 text-xs text-muted-foreground">{t.actingAs} · phiên: {t.sessionLabel}</p>
      <p className="mb-3 rounded-lg bg-background px-3 py-2 text-sm text-foreground">“{t.question}”</p>
      <p className="mb-3 text-xs text-muted-foreground">{t.status.explanation}</p>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Agent đã chạy (theo response thực tế)</div>
          <div className="flex flex-wrap gap-1.5" data-testid="executed-agents">
            {t.executedAgents.length ? t.executedAgents.map((a) => <Chip key={a}>{AGENT_LABEL[a] ?? a}</Chip>) : <span className="text-xs text-muted-foreground">không agent nào</span>}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Quyết định định tuyến (chẩn đoán, KHÔNG phải đã chạy)</div>
          <div className="flex flex-wrap gap-1.5">
            {t.chosenAgents.map((a) => <span key={a} className="rounded-full border border-border px-2 py-0.5 text-xs text-foreground">chọn: {AGENT_LABEL[a] ?? a}</span>)}
            {t.droppedAgents.map((a) => <span key={a} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">bỏ: {a}</span>)}
            {!t.chosenAgents.length && !t.droppedAgents.length ? <span className="text-xs text-muted-foreground">không có quyết định (bị chặn hoặc lỗi trước định tuyến)</span> : null}
          </div>
        </div>
      </div>

      {t.deferredNotice ? (
        <div className="mb-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-500" data-testid="deferred-notice">
          Có ý định bị hoãn: câu trả lời cho biết một số phần “chưa được xử lý trong lượt này”.
        </div>
      ) : null}

      <div className="mb-3 whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" data-testid="answer">{t.answer || "—"}</div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Chi tiết chẩn đoán</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>turnId</dt><dd className="break-all text-foreground">{t.turnId ?? "(response không trả về)"}</dd>
          <dt>traceId</dt><dd className="break-all text-foreground">{t.traceId ?? "(response không trả về)"}</dd>
          <dt>supervisor</dt><dd className="text-foreground">{t.supervisorStatus ?? "—"}</dd>
          <dt>định tuyến</dt><dd className="text-foreground">{t.routing ?? "—"}{t.routingMode ? ` · ${t.routingMode}` : ""}</dd>
          <dt>agent đã bắt đầu</dt>
          <dd className="text-foreground">{t.delegations.length ? t.delegations.map((d) => `${d.agentId}: ${d.completionStatus} (model ${d.modelCalls}, công cụ ${d.tools.join(", ") || "không"})`).join(" · ") : "—"}</dd>
        </dl>
        <p className="mt-2">Nguồn: các trường turnId/traceId/agents là của response route V2; phần định tuyến và agent đã bắt đầu lấy từ trace của supervisor trong launcher demo (không thuộc API).</p>
      </details>
    </div>
  );
}

export function AiV2DemoPage() {
  const [list, setList] = useState<DemoScenarioList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [retries, setRetries] = useState(0);
  const [result, setResult] = useState<{ turns: TurnView[]; tripwireTotal: number; durationMs: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const ac = new AbortController();
    aiV2DemoService.scenarios(ac.signal).then(setList, (e: unknown) => { if ((e as { name?: string })?.name !== "AbortError") setLoadError(e instanceof Error ? e.message : "Không tải được danh sách kịch bản"); });
    return () => { ac.abort(); abortRef.current?.abort(); };
  }, []);

  const scenario: DemoScenario | undefined = useMemo(() => list?.scenarios.find((s) => s.id === selected), [list, selected]);
  const groups = useMemo(() => {
    const m = new Map<string, DemoScenario[]>();
    for (const s of list?.scenarios ?? []) m.set(s.group, [...(m.get(s.group) ?? []), s]);
    return [...m.entries()];
  }, [list]);

  const run = useCallback(async (isRetry: boolean) => {
    if (!selected || running) return;
    if (isRetry && retries >= MAX_RETRIES) return;
    abortRef.current?.abort();
    const ac = new AbortController(); abortRef.current = ac;
    setRunning(true); setRunError(null);
    if (isRetry) setRetries((n) => n + 1); else setRetries(0);
    try {
      const r = await aiV2DemoService.run(selected, ac.signal);
      const mapped = mapRun(r);
      setResult({ ...mapped, durationMs: r.durationMs });
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setResult(null);
      setRunError(e instanceof Error ? e.message : "Chạy kịch bản thất bại");
    } finally {
      setRunning(false);
    }
  }, [selected, running, retries]);

  if (!import.meta.env.DEV) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="sticky top-0 z-20 border-b border-yellow-500/40 bg-yellow-500/15 px-4 py-2 text-center text-xs font-semibold tracking-wide text-yellow-500" data-testid="demo-banner">
        GYMINI MULTI-AGENT V2 — OFFLINE DEMO / MOCK MODEL
      </div>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="mb-1 text-xl font-bold">Multi-Agent V2 — demo offline</h1>
        <p className="mb-4 text-sm text-muted-foreground">{list?.notice ?? "Dữ liệu fixture, mô hình giả lập, không gọi mạng. Không phải lời khuyên sức khoẻ."} Chỉ chạy các kịch bản đã duyệt; không nhập câu hỏi tuỳ ý.</p>
        <div className="mb-4 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs text-orange-500">
          Giới hạn còn mở: lỗi bỏ lọt khi ký tự vô hình là dấu phân cách duy nhất giữa hai từ (P1); kho hạn chế vị thành niên chỉ nằm trong bộ nhớ một tiến trình (không dùng chung nhiều instance); G7/G8 chưa được kiểm chứng; chưa có kiểm chứng của con người. Không dùng như dịch vụ tư vấn sức khoẻ thật.
        </div>

        {loadError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
            Không kết nối được launcher demo: {loadError}. Hãy chạy backend demo (xem README) rồi tải lại trang.
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-4" aria-label="Danh sách kịch bản">
            {!list && !loadError ? <p className="text-sm text-muted-foreground">Đang tải kịch bản…</p> : null}
            {groups.map(([g, items]) => (
              <div key={g}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</div>
                <div className="space-y-1.5">
                  {items.map((s) => (
                    <button key={s.id} type="button" onClick={() => { setSelected(s.id); setResult(null); setRunError(null); setRetries(0); }}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${selected === s.id ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-foreground hover:border-primary/50"}`}
                      data-testid={`scenario-${s.id}`}>
                      {s.title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </aside>

          <main className="space-y-4" aria-live="polite">
            {!scenario ? <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Chọn một kịch bản bên trái.</div> : (
              <>
                <div className="rounded-xl border border-border bg-card p-4">
                  <h2 className="mb-1 text-base font-semibold">{scenario.title}</h2>
                  <p className="mb-2 text-sm text-muted-foreground">{scenario.description}</p>
                  <p className="mb-2 text-xs text-muted-foreground">Kỳ vọng: <span className="text-foreground">{scenario.expect}</span></p>
                  <p className="mb-3 text-xs text-muted-foreground">Phần giả lập: {scenario.mocked.join(" · ")}</p>
                  <ol className="mb-3 list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
                    {scenario.turns.map((t, i) => <li key={i}>{t.label}: “{t.question}”{t.sessionId ? ` (phiên ${t.sessionId})` : ""}</li>)}
                  </ol>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={running} onClick={() => run(false)} data-testid="run-button"
                      className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50">
                      {running ? "Đang chạy…" : "Chạy kịch bản"}
                    </button>
                    {runError && !running ? (
                      <button type="button" disabled={retries >= MAX_RETRIES} onClick={() => run(true)} data-testid="retry-button"
                        className="rounded-xl border border-border px-4 py-2 text-sm text-foreground disabled:opacity-50">
                        Thử lại ({retries}/{MAX_RETRIES})
                      </button>
                    ) : null}
                  </div>
                  {runError ? <p className="mt-3 text-sm text-destructive" role="alert" data-testid="run-error">{runError}</p> : null}
                </div>

                {running ? <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="loading">Supervisor đang xử lý…</div> : null}

                {result ? (
                  <>
                    {result.turns.map((t, i) => <TurnCard key={i} t={t} index={i} />)}
                    <div className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="tripwires">
                      Tripwire gọi ra ngoài (fetch / Bedrock / LLM / HTTP không mock): <span className="font-semibold text-foreground">{result.tripwireTotal}</span> · thời gian chạy {result.durationMs} ms.
                    </div>
                  </>
                ) : null}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
