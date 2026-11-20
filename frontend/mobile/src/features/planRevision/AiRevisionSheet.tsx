import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Wand2 } from "lucide-react-native";

import { BottomSheet, Button, Input, Tappable } from "../../components/ui";
import { planService } from "../../services/api";
import {
  buildIdempotencyKey,
  keepKeyAfterError,
  mapRevisionError,
  newSheetId,
  REVISION_EXAMPLES,
  REVISION_MAX_LENGTH,
  REVISION_MESSAGES,
  validateInstruction,
} from "./planRevision";

type Phase = "idle" | "working" | "done" | "failed" | "conflict";

const POLL_MS = 2500;
const MAX_POLLS = 72; // ~3 minutes, then the user is told to check back — the plan itself stays untouched.

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * "Nhờ AI chỉnh kế hoạch": a text box + example chips, then progress while the AI revises the plan in place.
 *
 * - `POST /plans/adjust` with `expectedVersion` = the version on screen and one Idempotency-Key per open sheet + text + version, so a
 *   double tap or a retry after a lost response is one operation server-side; then poll `GET /plans/job/:jobId`.
 * - The plan keeps its id and its version goes up only when the revision succeeds; a failed one leaves the old plan untouched.
 * - A revision is NOT applied to the schedule: the caller's sync card then offers "Áp dụng bản mới".
 */
export function AiRevisionSheet({
  open,
  onClose,
  planId,
  currentVersion,
  initialText,
  onRevised,
  onReload,
}: {
  open: boolean;
  onClose: () => void;
  planId: string;
  currentVersion: number;
  initialText?: string;
  /** Once, after the job COMPLETED (the caller refetches the plan and its program). */
  onRevised: () => void;
  /** The plan moved elsewhere (409) — the caller refetches it. */
  onReload: () => void;
}) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const sheetId = useRef(newSheetId());
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard: two taps before the first re-render must send once
  const keyRef = useRef<{ sig: string; key: string } | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A fresh sheet = a fresh key and a clean form.
  useEffect(() => {
    if (!open) return;
    sheetId.current = newSheetId();
    keyRef.current = null;
    setText(initialText ?? "");
    setPhase("idle");
    setError(null);
  }, [open, initialText]);

  const working = phase === "working";

  const submit = async () => {
    if (inFlight.current) return;
    const invalid = validateInstruction(text);
    if (invalid) {
      setError(invalid);
      return;
    }
    inFlight.current = true;
    setError(null);
    setPhase("working");
    const instruction = text.trim();
    const sig = `${instruction}|${currentVersion}`;
    if (keyRef.current?.sig !== sig) {
      keyRef.current = { sig, key: buildIdempotencyKey(sheetId.current, instruction, currentVersion) };
    }
    try {
      const job = await planService.adjustPlan(planId, instruction, undefined, undefined, {
        idempotencyKey: keyRef.current.key,
        expectedVersion: currentVersion,
      });
      let status = job.status;
      let failReason: string | null = null;
      for (let i = 0; i < MAX_POLLS && status !== "COMPLETED" && status !== "FAILED"; i++) {
        await wait(POLL_MS);
        if (!alive.current) return;
        const s = await planService.getJobStatus(job.jobId);
        status = s.status;
        failReason = s.failReason ?? null;
      }
      if (!alive.current) return;
      if (status === "COMPLETED") {
        setPhase("done");
        onRevised();
      } else if (status === "FAILED") {
        keyRef.current = null; // the server finished with a refusal: the next try is a new action
        setPhase("failed");
        setError(failReason && failReason.trim() ? failReason : REVISION_MESSAGES.failed);
      } else {
        setPhase("failed");
        setError(REVISION_MESSAGES.timeout);
        onReload();
      }
    } catch (e) {
      if (!alive.current) return;
      const mapped = mapRevisionError(e);
      if (!keepKeyAfterError(e)) keyRef.current = null;
      if (mapped.reload) {
        setPhase("conflict");
        onReload();
      } else {
        setPhase("failed");
      }
      setError(mapped.message);
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <BottomSheet open={open} onClose={working ? () => undefined : onClose} title="Nhờ AI chỉnh kế hoạch">
      {phase === "done" ? (
        <View className="gap-3 pb-2">
          <Text className="font-body text-sm text-foreground">
            Xong! AI đã chỉnh kế hoạch. Bản mới chưa tự áp dụng vào lịch tập — hãy bấm “Áp dụng bản mới” khi bạn đồng ý.
          </Text>
          <Button full onPress={onClose}>
            Xong
          </Button>
        </View>
      ) : (
        <View className="gap-3 pb-2">
          <Text className="font-body text-sm text-muted-foreground">
            Mô tả bằng lời bạn muốn đổi gì. Kế hoạch giữ nguyên tên; nếu AI không chỉnh được, kế hoạch cũ vẫn còn và bạn có thể quay lại bản trước.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {REVISION_EXAMPLES.map((ex) => (
              <Tappable
                key={ex}
                className="rounded-full border border-border bg-panel px-3 py-1.5"
                disabled={working}
                onPress={() => {
                  setText(ex);
                  setError(null);
                }}
              >
                <Text className="font-body text-xs text-foreground">{ex}</Text>
              </Tappable>
            ))}
          </View>
          <Input
            label="Bạn muốn chỉnh gì?"
            value={text}
            onChangeText={(t) => setText(t.slice(0, REVISION_MAX_LENGTH))}
            placeholder="Ví dụ: tăng từ 4 lên 8 bài mỗi buổi"
            multiline
            editable={!working}
          />
          {working ? (
            <View className="flex-row items-center gap-3 rounded-xl bg-panel p-3">
              <ActivityIndicator />
              <Text className="flex-1 font-body text-sm text-foreground">AI đang chỉnh kế hoạch theo yêu cầu của bạn…</Text>
            </View>
          ) : null}
          {error ? <Text className={`font-body text-xs ${phase === "conflict" ? "text-warning" : "text-destructive"}`}>{error}</Text> : null}
          {phase === "conflict" ? (
            <Button full variant="secondary" onPress={onClose}>
              Đóng và xem bản mới
            </Button>
          ) : (
            <Button full icon={Wand2} disabled={working} onPress={() => void submit()}>
              {working ? "Đang chỉnh…" : phase === "failed" ? "Thử lại" : "Chỉnh kế hoạch"}
            </Button>
          )}
        </View>
      )}
    </BottomSheet>
  );
}
