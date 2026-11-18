import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react-native";
import { Badge, Button, Card } from "../../components/ui";
import type { BadgeTone } from "../../components/ui/Badge";
import { inbodyService } from "../../services/api";

/**
 * "Giải thích thể trạng" (mobile parity with web components/InBodyExplanationCard.tsx). Badges come from the server's
 * deterministic interpretation; the paragraphs are AI-written, or absent with an honest message — never canned text.
 */
type Result = Awaited<ReturnType<typeof inbodyService.interpret>>;
const TONE: Record<string, BadgeTone> = { good: "success", slightly_high: "warning", high: "danger", low: "info", info: "neutral" };

/** **bold** segments of the AI text, without a markdown dependency. */
function RichLine({ text }: { text: string }) {
  return (
    <Text className="font-body text-xs leading-5 text-foreground/90">
      {text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <Text key={i} className="font-body-semibold text-foreground">{p.slice(2, -2)}</Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

export function InBodyExplanationCard({ entryId }: { entryId?: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const mutation = useMutation({ mutationFn: () => inbodyService.interpret(entryId), onSuccess: (r) => setResult(r) });
  const facts = result?.facts;
  const error = mutation.isError
    ? (mutation.error as any)?.response?.data?.error?.message ?? "Không lấy được phần giải thích lúc này. Bạn thử lại sau nhé."
    : null;

  return (
    <Card className="gap-3 p-4">
      <View>
        <Text className="font-display text-base text-foreground">Giải thích thể trạng</Text>
        <Text className="font-body text-xs text-muted-foreground">Các chỉ số trong lần đo này nghĩa là gì và nên tập trung vào đâu.</Text>
      </View>
      <Button variant="secondary" size="sm" icon={Sparkles} disabled={mutation.isPending} onPress={() => mutation.mutate()}>
        {mutation.isPending ? "AI đang phân tích…" : result ? "Giải thích lại" : "AI giải thích"}
      </Button>
      {error ? <Text className="font-body text-xs text-destructive">{error}</Text> : null}

      {facts ? (
        <View className="gap-3">
          {facts.bodyType ? (
            <View className="gap-0.5 rounded-xl border border-border p-3">
              <Text className="font-body text-[11px] text-muted-foreground">Kiểu thể trạng (ước tính từ cơ và mỡ)</Text>
              <Text className="font-body-semibold text-sm text-foreground">{facts.bodyType.labelVi}</Text>
              <Text className="font-body text-xs text-muted-foreground">{facts.bodyType.explanationVi}</Text>
            </View>
          ) : null}

          {facts.metrics.map((m) => (
            <View key={m.key} className="gap-1 rounded-xl border border-border p-3">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 font-body text-xs text-muted-foreground">{m.labelVi}</Text>
                <Text className="font-body text-[10px] uppercase text-muted-foreground">{m.source === "MEASURED" ? "Máy đo" : "Tính toán"}</Text>
              </View>
              <Text className="font-body-semibold text-sm text-foreground">{`${m.value}${m.unit ? ` ${m.unit}` : ""}`}</Text>
              {m.statusVi ? <Badge tone={TONE[m.status] ?? "neutral"}>{m.statusVi}</Badge> : null}
              {m.noteVi ? <Text className="font-body text-[11px] leading-4 text-muted-foreground">{m.noteVi}</Text> : null}
            </View>
          ))}

          {facts.changes.length ? (
            <View className="gap-0.5">
              <Text className="font-body-semibold text-xs text-foreground">
                {`So với lần đo trước${facts.daysSincePrevious != null ? ` (${facts.daysSincePrevious} ngày)` : ""}`}
              </Text>
              {facts.changes.map((c) => (
                <Text key={c.key} className="font-body text-xs text-muted-foreground">
                  {`${c.labelVi}: ${c.from} → ${c.to} (${c.delta > 0 ? "+" : ""}${c.delta} ${c.unit})${c.meaningful ? "" : " · trong mức dao động của máy"}`}
                </Text>
              ))}
            </View>
          ) : null}

          {facts.flags.map((f) => (
            <View key={f.code} className="rounded-xl border border-warning/40 bg-warning/10 p-2.5">
              <Text className="font-body text-xs text-foreground">{f.messageVi}</Text>
            </View>
          ))}

          {result?.explanation ? (
            <View className="gap-2 rounded-xl border border-border p-3">
              <Text className="font-body text-[10px] uppercase text-muted-foreground">AI giải thích</Text>
              {result.explanation.split(/\n+/).filter((l) => l.trim()).map((line, i) => <RichLine key={i} text={line} />)}
            </View>
          ) : result?.explanationError ? (
            <Text className="font-body text-xs text-muted-foreground">{result.explanationError}</Text>
          ) : null}

          {facts.dataQuality.map((q, i) => (
            <Text key={i} className="font-body text-[11px] leading-4 text-muted-foreground">{q}</Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
