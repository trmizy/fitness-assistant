import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import Svg, { Circle, Rect } from "react-native-svg";
import Animated, { FadeIn } from "react-native-reanimated";
import {
  Camera,
  ChevronLeft,
  ImageIcon,
  Pencil,
  ScanLine,
  TrendingDown,
  TrendingUp,
} from "lucide-react-native";

import {
  Badge,
  Button,
  Card,
  CountUp,
  EmptyState,
  Segmented,
  Tappable,
  useToast,
} from "../../../src/components/ui";
import { inbodyService } from "../../../src/services/api";
import { haptics } from "../../../src/lib/haptics";
import { usePullToRefresh } from "../../../src/hooks/usePullToRefresh";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import {
  METRICS,
  SEGMENT_NORMS,
  SEGMENT_SIDES,
  hasSegmental,
  metricDelta,
  normalizeHistory,
  segmentVerdict,
  type InBodyEntry,
  type SegmentField,
} from "../../../src/features/inbody/inbodyMath";

/**
 * CL-14 — body composition.
 *
 * Visual authority: `New Frontend/src/screens/InBody.tsx` (two segments, a hero, a metric grid, a
 * history chart, and a capture flow). Behavioural authority: user-service's `/inbody*`.
 *
 * Two things the design shows are NOT built, because nothing can supply them honestly: the 0-100
 * **"Điểm cơ thể"** (no column, no endpoint, and web shows no such score) and the **"Phân tích AI"**
 * paragraph (no InBody-analysis endpoint exists). The history chart therefore plots real weight and
 * muscle instead of an invented score. Body water is dropped for the same reason — the scan model
 * has no such field.
 *
 * Getting an image in: the backend takes any JPEG/PNG/PDF up to 5 MB on `POST /inbody/upload` and
 * does not care where it came from, so both **Chụp phiếu đo** and **Chọn từ thư viện** are offered —
 * the same two doors web's `<input type="file" accept="image/*">` opens on a phone.
 */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const TABS = ["Tổng quan", "So sánh"] as const;

export default function InBodyScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<(typeof TABS)[number]>("Tổng quan");
  const [uploading, setUploading] = useState(false);

  const historyQuery = useQuery({
    queryKey: ["inbody-history"],
    queryFn: () => inbodyService.getHistory(),
    staleTime: 0,
  });

  const { refreshing, onRefresh } = usePullToRefresh([["inbody-history"]]);

  // Saving an entry happens on another screen, so this one must re-read when it comes back.
  useFocusEffect(
    useCallback(() => {
      void queryClient.refetchQueries(
        { queryKey: ["inbody-history"], type: "active" },
        { cancelRefetch: false },
      );
    }, [queryClient]),
  );

  const history = useMemo(() => normalizeHistory(historyQuery.data), [historyQuery.data]);
  const latest = history[0] ?? null;
  const previous = history[1] ?? null;

  const upload = async (source: "camera" | "library") => {
    haptics.tap();
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.show(
        source === "camera"
          ? "Cần quyền camera để chụp phiếu đo."
          : "Cần quyền truy cập ảnh để chọn phiếu đo.",
        "danger",
      );
      return;
    }

    // quality 0.6 both keeps the printout readable and re-encodes to JPEG, which matters twice:
    // the endpoint accepts only jpeg/png/pdf, and a raw camera frame is regularly over the 5 MB cap.
    const options = { quality: 0.6, allowsEditing: true } as const;
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({ ...options, mediaTypes: ["images"] });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_UPLOAD_BYTES) {
      toast.show("Ảnh lớn hơn 5 MB — hãy chụp lại hoặc chọn ảnh nhỏ hơn.", "danger");
      return;
    }

    const mime = asset.mimeType === "image/png" ? "image/png" : "image/jpeg";
    const name = asset.fileName?.match(/\.(jpe?g|png)$/i)
      ? asset.fileName
      : `inbody-${Date.now()}.${mime === "image/png" ? "png" : "jpg"}`;

    setUploading(true);
    try {
      const data: any = await inbodyService.upload({ uri: asset.uri, name, type: mime });
      const extracted = data?.entryData ?? data?.result ?? {};
      haptics.success();
      // Straight to the review form: nothing is stored until the numbers are confirmed there.
      router.push({
        pathname: "/client/inbody/entry",
        params: { prefill: JSON.stringify(extracted), source: "ocr" },
      });
    } catch (e: any) {
      toast.show(
        e?.response
          ? e.response.data?.error ?? "Không đọc được phiếu từ ảnh này."
          : "Mất mạng — chưa gửi được ảnh.",
        "danger",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-2 px-5" style={{ paddingTop: insets.top + 12 }}>
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.back()}
        >
          <ChevronLeft size={20} color="#8b9299" />
        </Tappable>
        <Text className="flex-1 font-display text-2xl text-foreground">Kết quả InBody</Text>
      </View>

      <View className="px-5 pt-4">
        <Segmented options={[...TABS]} value={tab} onChange={(next) => setTab(next as typeof tab)} />
      </View>

      {historyQuery.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={accent.primary}
              colors={[accent.primary]}
            />
          }
        >
          {tab === "Tổng quan" ? (
            <Overview
              latest={latest}
              previous={previous}
              history={history}
              uploading={uploading}
              onCapture={() => void upload("camera")}
              onPickImage={() => void upload("library")}
              onManual={() => router.push("/client/inbody/entry")}
            />
          ) : (
            <Compare history={history} />
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Overview({
  latest,
  previous,
  history,
  uploading,
  onCapture,
  onPickImage,
  onManual,
}: {
  latest: InBodyEntry | null;
  previous: InBodyEntry | null;
  history: InBodyEntry[];
  uploading: boolean;
  onCapture: () => void;
  onPickImage: () => void;
  onManual: () => void;
}) {
  const accent = useWorkspaceAccent();
  const weightDelta = metricDelta(latest, previous, "weight");

  return (
    <View className="gap-5">
      {latest ? (
        <Card className="p-5">
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <Badge tone={latest.status === "extracted" ? "info" : "neutral"}>
                {latest.status === "extracted" ? "Đọc từ ảnh phiếu" : "Nhập tay"}
              </Badge>
              <Text className="font-display mt-2 text-5xl text-foreground">
                <CountUp to={latest.weight} decimals={1} />
                <Text className="font-display text-2xl text-muted-foreground"> kg</Text>
              </Text>
              {weightDelta.delta != null ? (
                <View className="mt-1 flex-row items-center gap-1">
                  {weightDelta.delta < 0 ? (
                    <TrendingDown size={15} color={weightDelta.good ? accent.primary : "#ef4444"} />
                  ) : (
                    <TrendingUp size={15} color={weightDelta.good ? accent.primary : "#ef4444"} />
                  )}
                  <Text
                    className="font-body-semibold text-sm"
                    style={{ color: weightDelta.good ? accent.primary : "#ef4444" }}
                  >
                    {weightDelta.delta > 0 ? "+" : ""}
                    {weightDelta.delta} kg so với lần trước
                  </Text>
                </View>
              ) : (
                <Text className="mt-1 font-body text-sm text-muted-foreground">
                  Lần đo đầu tiên — chưa có gì để so sánh.
                </Text>
              )}
            </View>
            <View className="items-end">
              <Text className="font-body text-xs text-muted-foreground">Đo ngày</Text>
              <Text className="font-display text-base text-foreground">
                {latest.dateOnly.split("-").reverse().join("/")}
              </Text>
            </View>
          </View>
        </Card>
      ) : (
        <EmptyState
          icon={ScanLine}
          title="Chưa có phiếu đo nào"
          description="Chụp phiếu InBody, chọn ảnh có sẵn, hoặc nhập tay các chỉ số."
        />
      )}

      {latest ? (
        <View className="flex-row flex-wrap gap-3">
          {METRICS.filter((metric) => latest[metric.key] != null).map((metric) => {
            const d = metricDelta(latest, previous, metric.key);
            return (
              <Card key={metric.key} className="min-w-[45%] flex-1 p-4">
                <Text className="font-body text-xs text-muted-foreground">{metric.label}</Text>
                <Text className="font-display mt-0.5 text-2xl text-foreground">
                  {d.value}
                  <Text className="font-display text-base text-muted-foreground">
                    {metric.unit ? ` ${metric.unit}` : ""}
                  </Text>
                </Text>
                {d.delta != null && d.delta !== 0 ? (
                  <Text
                    className="mt-0.5 font-body-semibold text-xs"
                    style={{ color: d.good ? accent.primary : "#ef4444" }}
                  >
                    {d.delta > 0 ? "+" : ""}
                    {d.delta} {metric.unit}
                  </Text>
                ) : (
                  <Text className="mt-0.5 font-body text-xs text-muted-foreground">
                    {d.delta === 0 ? "không đổi" : "—"}
                  </Text>
                )}
              </Card>
            );
          })}
        </View>
      ) : null}

      {/* Segmental lean/fat — web shows this and mobile did not, which was a parity hole, not a
          decision. Only drawn when the sheet actually carried the numbers: a manual entry or a
          bathroom scale has none, and empty limbs would read as zeros. */}
      {hasSegmental(latest, "muscle") ? (
        <SegmentalCard title="Cơ theo vùng (kg)" entry={latest!} kind="muscle" />
      ) : null}
      {hasSegmental(latest, "fat") ? (
        <SegmentalCard title="Mỡ theo vùng (kg)" entry={latest!} kind="fat" />
      ) : null}

      {history.length > 1 ? (
        <Card className="p-4">
          <Text className="font-display mb-3 text-base text-foreground">Cân nặng qua các lần đo</Text>
          <TrendBars entries={history} />
        </Card>
      ) : null}

      <View className="gap-2">
        <Button full size="lg" icon={Camera} disabled={uploading} onPress={onCapture}>
          {uploading ? "Đang đọc phiếu…" : "Chụp phiếu đo"}
        </Button>
        <Button full size="lg" variant="secondary" icon={ImageIcon} disabled={uploading} onPress={onPickImage}>
          Chọn ảnh từ thư viện
        </Button>
        <Button full size="lg" variant="ghost" icon={Pencil} onPress={onManual}>
          Nhập tay
        </Button>
      </View>
    </View>
  );
}

/**
 * One half of a printout's "Segmental Lean/Fat Analysis", drawn the way the printout itself draws
 * it: a body, not a table. Web keeps the silhouette grey and puts the numbers beside it; here each
 * part is *filled* by how it compares to its reference, so the shape itself carries the reading —
 * a pale left arm next to a solid right one is visible before a single number is read.
 *
 * Geometry is web's (viewBox 100×220: head, trunk, two arms, two legs), so both clients draw the
 * same body. Labels stay as real text beside the drawing rather than SVG text, which keeps them in
 * the app's own font and lets them wrap on a narrow screen.
 */
const SEGMENT_OPACITY: Record<string, number> = {
  "Thấp": 0.32,
  "Bình thường": 0.66,
  "Cao": 1,
  "—": 0.12,
};

function SegmentalCard({
  title,
  entry,
  kind,
}: {
  title: string;
  entry: InBodyEntry;
  kind: "muscle" | "fat";
}) {
  const accent = useWorkspaceAccent();
  const tint = kind === "muscle" ? accent.primary : "#f59e0b";

  const read = (sideKey: string) => {
    const field = `${sideKey}${kind === "muscle" ? "Muscle" : "Fat"}` as SegmentField;
    const side = SEGMENT_SIDES.find((s) => s.key === sideKey)!;
    const value = entry.segmental[field];
    const verdict = segmentVerdict(value, SEGMENT_NORMS[kind][side.norm]);
    return { label: side.label, value, verdict, fill: SEGMENT_OPACITY[verdict.label] ?? 0.12 };
  };

  const leftArm = read("leftArm");
  const rightArm = read("rightArm");
  const leftLeg = read("leftLeg");
  const rightLeg = read("rightLeg");
  const trunk = read("trunk");

  return (
    <Card className="p-4">
      <Text className="font-display mb-3 text-base text-foreground">{title}</Text>

      {/* gap-3 on purpose: at gap-1 the numbers touched the limbs and the card read as one blob. */}
      <View className="flex-row items-center justify-center gap-3">
        <View className="flex-1 items-end gap-12 pt-2">
          <SegmentLabel data={leftArm} tint={tint} align="right" />
          <SegmentLabel data={leftLeg} tint={tint} align="right" />
        </View>

        <Svg width={96} height={210} viewBox="0 0 100 220">
          <Circle cx={50} cy={18} r={14} fill="#1b1f1d" stroke="#2a2f2c" strokeWidth={1.5} />
          {/* Left of the drawing is the left of the page, exactly as an InBody sheet is read. */}
          <Rect x={10} y={38} width={16} height={68} rx={8} fill={tint} fillOpacity={leftArm.fill} stroke="#2a2f2c" strokeWidth={1.5} />
          <Rect x={74} y={38} width={16} height={68} rx={8} fill={tint} fillOpacity={rightArm.fill} stroke="#2a2f2c" strokeWidth={1.5} />
          <Rect x={30} y={34} width={40} height={70} rx={14} fill={tint} fillOpacity={trunk.fill} stroke="#2a2f2c" strokeWidth={1.5} />
          <Rect x={32} y={106} width={16} height={98} rx={8} fill={tint} fillOpacity={leftLeg.fill} stroke="#2a2f2c" strokeWidth={1.5} />
          <Rect x={52} y={106} width={16} height={98} rx={8} fill={tint} fillOpacity={rightLeg.fill} stroke="#2a2f2c" strokeWidth={1.5} />
        </Svg>

        <View className="flex-1 items-start gap-12 pt-2">
          <SegmentLabel data={rightArm} tint={tint} align="left" />
          <SegmentLabel data={rightLeg} tint={tint} align="left" />
        </View>
      </View>

      <View className="mt-1 items-center">
        <SegmentLabel data={trunk} tint={tint} align="center" />
      </View>

      <View className="mt-3 flex-row flex-wrap items-center justify-center gap-3">
        {(["Thấp", "Bình thường", "Cao"] as const).map((level) => (
          <View key={level} className="flex-row items-center gap-1.5">
            {/* Explicit size, not classes: the swatches came out invisible on the emulator. */}
            <View
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                backgroundColor: tint,
                opacity: SEGMENT_OPACITY[level],
              }}
            />
            <Text className="font-body text-[11px] text-muted-foreground">{level}</Text>
          </View>
        ))}
      </View>

      <Text className="mt-2 text-center font-body text-[11px] leading-4 text-muted-foreground">
        Mức tham chiếu: tay {SEGMENT_NORMS[kind].arm} kg · thân {SEGMENT_NORMS[kind].trunk} kg · chân{" "}
        {SEGMENT_NORMS[kind].leg} kg.
      </Text>
    </Card>
  );
}

function SegmentLabel({
  data,
  tint,
  align,
}: {
  data: { label: string; value: number | null; verdict: { pct: number | null; label: string } };
  tint: string;
  align: "left" | "right" | "center";
}) {
  const alignClass = align === "right" ? "items-end" : align === "left" ? "items-start" : "items-center";
  return (
    <View className={alignClass}>
      <Text className="font-body text-[11px] text-muted-foreground">{data.label}</Text>
      <Text className="font-body-semibold text-sm text-foreground">
        {data.value != null ? `${data.value} kg` : "—"}
      </Text>
      {data.verdict.pct != null ? (
        <Text
          className="font-body text-[11px]"
          style={{ color: data.verdict.label === "Bình thường" ? "#8b9299" : tint }}
        >
          {data.verdict.pct}% · {data.verdict.label}
        </Text>
      ) : null}
    </View>
  );
}

/** Oldest → newest, so the bars read left-to-right like a timeline. */
function TrendBars({ entries }: { entries: InBodyEntry[] }) {
  const accent = useWorkspaceAccent();
  const points = [...entries].slice(0, 8).reverse();
  const values = points.map((p) => p.weight);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  return (
    <View className="flex-row items-end justify-between gap-2">
      {points.map((point, index) => {
        // A floor of 18% keeps the smallest bar readable instead of collapsing it to a line.
        const height = 18 + ((point.weight - min) / span) * 82;
        return (
          <View key={point.id} className="flex-1 items-center gap-1.5">
            <Text className="font-body text-[10px] text-muted-foreground">{point.weight}</Text>
            {/* A fixed height, not flex-1: the row aligns to its baseline (items-end), so a flexed
                column takes its height from its content — and a percentage height inside it resolves
                to zero. The bars were invisible until this was a real number. */}
            <View className="h-24 w-full justify-end">
              <Animated.View
                entering={FadeIn.delay(index * 60).duration(260)}
                className="w-full rounded-md"
                style={{ height: `${height}%`, backgroundColor: `${accent.primary}b3` }}
              />
            </View>
            <Text className="font-body text-[10px] text-muted-foreground">
              {point.dateOnly.slice(8, 10)}/{point.dateOnly.slice(5, 7)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Compare({ history }: { history: InBodyEntry[] }) {
  const accent = useWorkspaceAccent();
  const [aId, setAId] = useState(history[0]?.id ?? "");
  const [bId, setBId] = useState(history[1]?.id ?? "");

  if (history.length < 2) {
    return (
      <EmptyState
        icon={ScanLine}
        title="Cần ít nhất hai lần đo"
        description="Khi có phiếu đo thứ hai, phần này sẽ so từng chỉ số giữa hai lần bất kỳ."
      />
    );
  }

  const a = history.find((e) => e.id === aId) ?? history[0];
  const b = history.find((e) => e.id === bId) ?? history[1];
  const label = (entry: InBodyEntry) => entry.dateOnly.split("-").reverse().join("/");

  return (
    <View className="gap-4">
      <DatePicker title="Lần đo A" entries={history} selected={a.id} onSelect={setAId} />
      <DatePicker title="Lần đo B (so với)" entries={history} selected={b.id} onSelect={setBId} />

      <Card className="p-4">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="font-body-semibold text-sm text-foreground">{label(b)}</Text>
          <Text className="font-body text-xs text-muted-foreground">so với</Text>
          <Text className="font-body-semibold text-sm text-foreground">{label(a)}</Text>
        </View>

        <View className="gap-3">
          {METRICS.filter((metric) => a[metric.key] != null || b[metric.key] != null).map((metric) => {
            const d = metricDelta(a, b, metric.key);
            const before = b[metric.key] as number | null;
            return (
              <View key={metric.key} className="flex-row items-center gap-3 border-t border-border pt-3">
                <Text className="flex-1 font-body text-sm text-muted-foreground">{metric.label}</Text>
                <Text className="font-body text-sm text-muted-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                  {before ?? "—"}
                </Text>
                <Text className="font-display text-sm text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                  {d.value ?? "—"}
                </Text>
                <Text
                  className="w-16 text-right font-body-semibold text-xs"
                  style={{
                    color: d.delta == null || d.delta === 0 ? "#8b9299" : d.good ? accent.primary : "#ef4444",
                  }}
                >
                  {d.delta == null ? "—" : d.delta === 0 ? "0" : `${d.delta > 0 ? "+" : ""}${d.delta}`}
                </Text>
              </View>
            );
          })}
        </View>
      </Card>
    </View>
  );
}

function DatePicker({
  title,
  entries,
  selected,
  onSelect,
}: {
  title: string;
  entries: InBodyEntry[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View>
      <Text className="mb-2 px-1 font-body text-[11px] uppercase tracking-wide text-muted-foreground">
        {title}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="items-start gap-2 pr-5">
        {entries.map((entry) => {
          const on = entry.id === selected;
          return (
            <Tappable
              key={entry.id}
              className={`rounded-full border px-3.5 py-2 ${on ? "border-primary bg-primary/15" : "border-border bg-card"}`}
              onPress={() => onSelect(entry.id)}
            >
              <Text className={`font-body-medium text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>
                {entry.dateOnly.split("-").reverse().join("/")}
              </Text>
            </Tappable>
          );
        })}
      </ScrollView>
    </View>
  );
}
