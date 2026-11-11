import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { SparkleIcon as Sparkles, CircleNotchIcon as Loader2, WarningIcon as AlertTriangle, InfoIcon as Info } from "@phosphor-icons/react";
import { inbodyService, type InBodyInterpretationResult, type InBodyMetricStatus } from "../services/api";

/**
 * "Giải thích thể trạng" for an InBody entry (docs/ai-product/inbody-interpretation-design.md).
 * The badges come from the server's deterministic interpretation; the paragraph text is AI-written, or absent with an honest
 * message when the AI could not answer — the UI never shows a canned explanation.
 */
const STATUS_CLASS: Record<InBodyMetricStatus, string> = {
  good: "border-green-500/30 bg-green-500/10 text-green-400",
  slightly_high: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  high: "border-red-500/30 bg-red-500/10 text-red-400",
  low: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  info: "border-zinc-700 bg-zinc-800/50 text-zinc-300",
};

/** Renders **bold** segments of the AI text without a markdown dependency. */
function RichLine({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="text-zinc-100 font-semibold">{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function InBodyExplanationCard({ entryId }: { entryId?: string }) {
  const [result, setResult] = useState<InBodyInterpretationResult | null>(null);
  const mutation = useMutation({
    mutationFn: () => inbodyService.interpret(entryId),
    onSuccess: (r) => setResult(r),
  });
  const facts = result?.facts;
  const errorMessage = mutation.isError
    ? (mutation.error as any)?.response?.data?.error?.message ?? "Không lấy được phần giải thích lúc này. Bạn thử lại sau nhé."
    : null;

  return (
    <div className="glass-panel rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-zinc-200">Giải thích thể trạng</h4>
          <p className="text-xs text-zinc-500 mt-0.5">Các chỉ số trong lần đo gần nhất nghĩa là gì và nên tập trung vào đâu.</p>
        </div>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-semibold rounded-lg hover:bg-green-500/15 disabled:opacity-60"
        >
          {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {mutation.isPending ? "AI đang phân tích…" : result ? "Giải thích lại" : "AI giải thích"}
        </button>
      </div>

      {errorMessage && <p className="text-xs text-red-400">{errorMessage}</p>}

      {facts && (
        <div className="space-y-3">
          {facts.bodyType && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
              <div className="text-xs text-zinc-500">Kiểu thể trạng (ước tính từ cơ và mỡ)</div>
              <div className="text-sm font-bold text-zinc-100 mt-0.5">{facts.bodyType.labelVi}</div>
              <div className="text-xs text-zinc-400 mt-1">{facts.bodyType.explanationVi}</div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {facts.metrics.map((m) => (
              <div key={m.key} className={`rounded-lg border px-3 py-2 ${STATUS_CLASS[m.status]}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs opacity-80">{m.labelVi}</span>
                  <span className="text-[10px] uppercase tracking-wide opacity-70">{m.source === "MEASURED" ? "Máy đo" : "Tính toán"}</span>
                </div>
                <div className="text-sm font-bold">
                  {m.value}{m.unit ? ` ${m.unit}` : ""}{m.statusVi ? <span className="font-normal text-xs"> · {m.statusVi}</span> : null}
                </div>
                {m.noteVi && <div className="text-[11px] opacity-70 mt-0.5">{m.noteVi}</div>}
              </div>
            ))}
          </div>

          {facts.balance.length > 0 && (
            <div className="text-xs text-zinc-400 space-y-0.5">
              {facts.balance.map((b) => (
                <div key={b.partVi}>
                  Cân bằng {b.partVi.toLowerCase()}: trái {b.leftKg} kg, phải {b.rightKg} kg (lệch {b.diffPct}%) —{" "}
                  {b.status === "normal" ? "bình thường" : b.status === "mild" ? "lệch nhẹ" : "lệch rõ"}
                </div>
              ))}
            </div>
          )}

          {facts.changes.length > 0 && (
            <div className="text-xs text-zinc-400">
              <div className="font-semibold text-zinc-300 mb-1">
                So với lần đo trước{facts.daysSincePrevious != null ? ` (${facts.daysSincePrevious} ngày)` : ""}
              </div>
              {facts.changes.map((c) => (
                <div key={c.key}>
                  {c.labelVi}: {c.from} → {c.to} ({c.delta > 0 ? "+" : ""}{c.delta} {c.unit})
                  {!c.meaningful && <span className="text-zinc-500"> · trong mức dao động của máy</span>}
                </div>
              ))}
            </div>
          )}

          {facts.flags.map((f) => (
            <div key={f.code} className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-300">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{f.messageVi}</span>
            </div>
          ))}

          {result?.explanation ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">AI giải thích</p>
              {result.explanation.split(/\n+/).filter((l) => l.trim()).map((line, i) => (
                <p key={i} className="text-xs text-zinc-300 leading-relaxed"><RichLine text={line} /></p>
              ))}
            </div>
          ) : (
            result?.explanationError && <p className="text-xs text-zinc-400">{result.explanationError}</p>
          )}

          {facts.dataQuality.length > 0 && (
            <div className="flex gap-2 text-[11px] text-zinc-500">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <div className="space-y-0.5">{facts.dataQuality.map((q, i) => <div key={i}>{q}</div>)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
