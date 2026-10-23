import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react-native";

import { BottomSheet, Button, Card, useToast } from "../../components/ui";
import { ptApplicationService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { designTokens } from "../../theme/colors";
import { useRefetchOnReturn } from "../../hooks/useRefetchOnReturn";
import { isPtTermsVersionStale, ptTermsBannerState } from "./ptTermsModel";

const ptTermsKey = (userId: string | undefined) => ["pt-terms", userId ?? "guest"] as const;

/** The current PT terms + this user's standing, from the single server source. Identity-scoped key (also cleared on account switch). */
export function usePtTerms(enabled = true) {
  const { user } = useApp();
  return useQuery({
    queryKey: ptTermsKey(user?.id),
    queryFn: () => ptApplicationService.getTerms(),
    enabled: enabled && !!user?.id,
    staleTime: 60_000,
  });
}

/** Confirm the version the user just read; refreshes the terms query so every banner/gate updates. */
export function useConfirmPtTerms(onDone?: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (version: string) => ptApplicationService.acceptTerms(version),
    onSuccess: () => {
      toast.show("Đã xác nhận điều khoản. Bạn có thể chấp nhận hợp đồng mới.", "success");
      void queryClient.invalidateQueries({ queryKey: ["pt-terms"] });
      onDone?.();
    },
    onError: (e: any) => {
      if (isPtTermsVersionStale(e)) {
        toast.show("Điều khoản vừa được cập nhật. Vui lòng đọc lại phiên bản mới nhất.", "danger");
        void queryClient.invalidateQueries({ queryKey: ["pt-terms"] });
      } else {
        toast.show(e?.response?.data?.error || "Không thể xác nhận lúc này. Vui lòng thử lại.", "danger");
      }
    },
  });
}

/**
 * The terms in a bottom sheet - the text comes from the server, never from the app bundle.
 * `onConfirm` (optional) adds the "agree" button: the application's last step uses it to tick the box, the
 * re-confirmation banner uses it to record the confirmation.
 */
export function PtTermsSheet({
  open,
  onClose,
  onConfirm,
  confirming = false,
  confirmLabel = "Tôi đồng ý",
  notice,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm?: (version: string) => void;
  confirming?: boolean;
  confirmLabel?: string;
  /** Plain-words reason the sheet was opened (e.g. an accept was refused). Shown INSIDE the sheet: a toast sits under the sheet's native window and cannot be seen. */
  notice?: string | null;
}) {
  const { height } = useWindowDimensions();
  const { data: terms, isLoading, isError, refetch } = usePtTerms(open);
  return (
    <BottomSheet open={open} onClose={onClose} title="Điều khoản dành cho Huấn luyện viên">
      <View className="gap-3 pb-2" testID="pt-terms-sheet">
        {notice ? (
          <View className="rounded-xl border border-warning/30 bg-warning/10 p-3" testID="pt-terms-notice">
            <Text className="font-body-semibold text-sm text-foreground">{notice}</Text>
          </View>
        ) : null}
        {terms?.isDraft ? (
          <View className="self-start rounded-full bg-warning/15 px-2.5 py-1" testID="pt-terms-draft-tag">
            <Text className="font-body-semibold text-[11px] text-warning">Bản nháp, đang chờ duyệt chính thức</Text>
          </View>
        ) : null}
        <ScrollView style={{ maxHeight: Math.round(height * 0.55) }} nestedScrollEnabled showsVerticalScrollIndicator>
          {isLoading ? <ActivityIndicator className="my-8" /> : null}
          {isError ? (
            <View className="items-center gap-3 py-6">
              <Text className="text-center font-body text-sm text-muted-foreground">Không tải được điều khoản. Vui lòng thử lại.</Text>
              <Button variant="secondary" onPress={() => void refetch()}>
                Tải lại
              </Button>
            </View>
          ) : null}
          {terms ? (
            <View className="gap-4">
              <Text className="font-body text-sm leading-5 text-muted-foreground">{terms.intro}</Text>
              {terms.sections.map((s) => (
                <View key={s.id} className="gap-1.5" testID={`pt-terms-section-${s.id}`}>
                  <Text className="font-body-semibold text-sm text-foreground">{s.title}</Text>
                  {s.body.map((p, i) => (
                    <Text key={i} className="font-body text-sm leading-5 text-muted-foreground">
                      {p}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
        <View className="flex-row gap-2">
          <Button variant="secondary" full className="flex-1" onPress={onClose}>
            Đóng
          </Button>
          {onConfirm ? (
            <Button full className="flex-1" disabled={!terms || confirming} onPress={() => terms && onConfirm(terms.version)}>
              {confirming ? "Đang lưu…" : confirmLabel}
            </Button>
          ) : null}
        </View>
      </View>
    </BottomSheet>
  );
}

/**
 * Banner for an approved PT who has not confirmed the CURRENT terms (server: `mustReconfirm`). No banner for a
 * new applicant, for a PT who confirmed, or while loading. A screen that just had a contract accept refused for
 * the terms can open the sheet itself via `open` / `onOpenChange`.
 */
export function PtTermsBanner({
  open: controlledOpen,
  onOpenChange,
  className = "",
  notice,
}: { open?: boolean; onOpenChange?: (open: boolean) => void; className?: string; notice?: string | null } = {}) {
  const { user } = useApp();
  const { data: terms } = usePtTerms();
  // The terms version can change on the server while this screen stays mounted: re-read on focus / app foreground
  // so the banner switches to the "updated" wording without waiting for a refused accept or a re-login.
  useRefetchOnReturn(ptTermsKey(user?.id), !!user?.id);
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setLocalOpen(v));
  const confirm = useConfirmPtTerms(() => setOpen(false));
  const state = ptTermsBannerState(terms);
  return (
    <>
      {state.show ? (
        <Card className={`border-warning/30 bg-warning/10 p-4 ${className}`}>
          <View testID="pt-terms-banner" className="gap-3">
            <View className="flex-row items-start gap-3">
              <AlertTriangle size={20} color={designTokens.warning} />
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground">{state.title}</Text>
                <Text className="mt-0.5 font-body text-sm leading-5 text-muted-foreground">{state.message}</Text>
              </View>
            </View>
            <Button full onPress={() => setOpen(true)}>
              {state.action}
            </Button>
          </View>
        </Card>
      ) : null}
      <PtTermsSheet open={open} onClose={() => setOpen(false)} onConfirm={(version) => confirm.mutate(version)} confirming={confirm.isPending} notice={notice} />
    </>
  );
}
