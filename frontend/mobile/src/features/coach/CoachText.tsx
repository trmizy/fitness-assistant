import { useMemo } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { BookOpen, ExternalLink } from "lucide-react-native";

import { Tappable } from "../../components/ui";
import { designTokens } from "../../theme/colors";
import type { CoachEvidenceItem } from "../../services/api";
import { parseCoachText, type InlinePart } from "./coach";

function Inline({ parts }: { parts: InlinePart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.bold ? (
          <Text key={i} className="font-body-semibold text-foreground">
            {p.text}
          </Text>
        ) : (
          <Text key={i}>{p.text}</Text>
        ),
      )}
    </>
  );
}

/** An AI answer rendered the way web's AICoachPage renders it (headings, lists, notes, bold, tables). */
export function CoachText({ text }: { text: string }) {
  const lines = useMemo(() => parseCoachText(text), [text]);
  return (
    <View className="gap-0.5">
      {lines.map((l, i) => {
        switch (l.kind) {
          case "h2":
            return (
              <Text key={i} className="mb-0.5 mt-3 font-display text-base text-foreground">
                <Inline parts={l.parts} />
              </Text>
            );
          case "h3":
            return (
              <Text key={i} className="mt-2 font-body-semibold text-sm text-foreground">
                <Inline parts={l.parts} />
              </Text>
            );
          case "quote":
            return (
              <Text key={i} className="my-0.5 border-l-2 border-border pl-2 font-body text-xs italic text-muted-foreground">
                <Inline parts={l.parts} />
              </Text>
            );
          case "bullet":
            return (
              <View key={i} className="ml-2 flex-row gap-1.5">
                <Text className="font-body text-sm text-primary">•</Text>
                <Text className="flex-1 font-body text-sm leading-5 text-foreground">
                  <Inline parts={l.parts} />
                </Text>
              </View>
            );
          case "numbered":
            return (
              <View key={i} className="ml-2 flex-row gap-1.5">
                <Text className="min-w-4 font-body-semibold text-sm text-primary">{l.n}.</Text>
                <Text className="flex-1 font-body text-sm leading-5 text-foreground">
                  <Inline parts={l.parts} />
                </Text>
              </View>
            );
          case "blank":
            return <View key={i} className="h-1" />;
          case "table":
            return (
              <ScrollView key={i} horizontal showsHorizontalScrollIndicator={false} className="my-2 rounded-lg border border-border">
                <View>
                  <View className="flex-row bg-panel">
                    {l.headers.map((h, j) => (
                      <Text key={j} className="min-w-20 border-b border-border px-2 py-1.5 font-body-semibold text-xs text-foreground">
                        <Inline parts={h} />
                      </Text>
                    ))}
                  </View>
                  {l.rows.map((row, ri) => (
                    <View key={ri} className="flex-row">
                      {row.map((cell, ci) => (
                        <Text key={ci} className="min-w-20 border-b border-border/40 px-2 py-1.5 font-body text-xs text-muted-foreground">
                          <Inline parts={cell} />
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          default:
            return (
              <Text key={i} className="font-body text-sm leading-5 text-foreground">
                <Inline parts={l.parts} />
              </Text>
            );
        }
      })}
    </View>
  );
}

/** "Nguồn" under an answer — the retrieval evidence the answer used, opened in the browser. */
export function EvidenceSources({ items }: { items: CoachEvidenceItem[] }) {
  if (items.length === 0) return null;
  return (
    <View className="mt-3 gap-1.5 border-t border-border pt-2">
      <View className="flex-row items-center gap-1.5">
        <BookOpen size={12} color={designTokens.mutedForeground} />
        <Text className="font-body-semibold text-[10px] uppercase tracking-wide text-muted-foreground">Nguồn tham khảo</Text>
      </View>
      {items.map((item, index) => {
        const url = /^https?:\/\//i.test(item.source_url ?? "") ? item.source_url : null;
        return (
          <Tappable
            key={`${item.source_url || item.title}-${index}`}
            disabled={!url}
            onPress={() => url && void Linking.openURL(url)}
            className="flex-row items-start gap-2 rounded-lg border border-border bg-background px-2.5 py-2"
          >
            <Text className="font-body text-[10px] text-primary">E{index + 1}</Text>
            <View className="min-w-0 flex-1">
              <Text className="font-body-semibold text-xs text-foreground" numberOfLines={2}>
                {item.title || item.source_url}
              </Text>
              <Text className="mt-0.5 font-body text-[10px] text-muted-foreground">{[item.source_type, item.category].filter(Boolean).join(" · ")}</Text>
            </View>
            {url ? <ExternalLink size={12} color={designTokens.mutedForeground} /> : null}
          </Tappable>
        );
      })}
    </View>
  );
}
