import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, ScreenHeader, useToast } from "../../../src/components/ui";
import { ptApplicationService, type PTApplication } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { PTApplicationWizard } from "../../../src/features/ptApplication/PTApplicationWizard";
import { PTApplicationStatus } from "../../../src/features/ptApplication/PTApplicationStatus";
import {
  applicationView,
  draftPayload,
  emptyApplication,
  firstInvalidStep,
  formFromServer,
  submitErrorMessage,
  type LocForm,
} from "../../../src/features/ptApplication/ptApplication";

/**
 * CL-22 — "Ứng tuyển Huấn luyện viên". One route, two faces:
 *  - no application / DRAFT (or NEEDS_MORE_INFO after "Chỉnh sửa & nộp lại") → the 8-step wizard;
 *  - SUBMITTED / UNDER_REVIEW / NEEDS_MORE_INFO / REJECTED / APPROVED → the status page.
 * Same endpoints as web: `GET /pt-applications/me`, `POST …/me/draft` on every step, `POST
 * …/me/submit` at the end (the server re-checks everything). Approval flips `isPT` on the profile;
 * the user record is refreshed so "Vào không gian Huấn luyện viên" appears without a re-login.
 *
 * The form is hydrated from the server exactly once (web's hydratedRef rule): a draft-save reply
 * must never overwrite what the user has typed since.
 */
export default function PTApplicationScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, updateUser, setActiveView } = useApp();
  const key = ["pt-application-me", user?.id ?? "guest"];

  const query = useQuery({ queryKey: key, queryFn: () => ptApplicationService.getMe(), enabled: !!user?.id });
  const app = query.data ?? null;

  // Hydrated from the FIRST successful load only (React's "adjust state while rendering" pattern):
  // later draft-save replies update the cache but never overwrite what the user is typing.
  const [draft, setDraft] = useState<{ form: PTApplication; locations: LocForm[] } | null>(null);
  if (draft === null && query.isSuccess) setDraft(formFromServer(app));
  const form = draft?.form ?? emptyApplication();
  const locations = draft?.locations ?? [];
  const setFormState = (u: (f: PTApplication) => PTApplication) => setDraft((d) => (d ? { ...d, form: u(d.form) } : d));
  const setLocationsState = (u: (l: LocForm[]) => LocForm[]) => setDraft((d) => (d ? { ...d, locations: u(d.locations) } : d));
  const [editing, setEditing] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () => ptApplicationService.saveDraft(draftPayload(form, locations)),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  const submitMutation = useMutation({
    mutationFn: () => ptApplicationService.submit(),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setEditing(false);
      toast.show("Đã nộp đơn ứng tuyển!", "success");
    },
    onError: (e) => toast.show(submitErrorMessage(e), "danger"),
  });

  const save = async () => {
    try {
      await saveMutation.mutateAsync();
      return true;
    } catch (e) {
      toast.show(submitErrorMessage(e) || "Lưu thất bại. Vui lòng thử lại.", "danger");
      return false;
    }
  };

  const submit = async () => {
    const bad = firstInvalidStep(form, locations);
    if (bad >= 0) {
      toast.show("Còn mục bắt buộc chưa đủ — kiểm tra phần báo đỏ ở trên.", "danger");
      return;
    }
    if (await save()) submitMutation.mutate();
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace("/client/profile"));
  const view = editing ? "wizard" : applicationView(app?.status);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={view === "wizard" ? "Ứng tuyển Huấn luyện viên" : "Trạng thái đơn ứng tuyển"} onBack={back} />
      {query.isLoading || (query.isSuccess && draft === null) ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : query.isError ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Text className="text-center font-body text-sm text-destructive">Không tải được đơn ứng tuyển.</Text>
          <Button variant="secondary" onPress={() => void query.refetch()}>
            Thử lại
          </Button>
        </View>
      ) : view === "wizard" ? (
        <PTApplicationWizard
          form={form}
          setForm={setFormState}
          locations={locations}
          setLocations={setLocationsState}
          saving={saveMutation.isPending}
          submitting={submitMutation.isPending}
          save={save}
          submit={() => void submit()}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}>
          <PTApplicationStatus
            app={app!}
            onEdit={() => setEditing(true)}
            onEnterPT={() => {
              updateUser({ isPT: true });
              setActiveView("pt");
              router.replace("/pt/dashboard");
            }}
          />
        </ScrollView>
      )}
    </View>
  );
}
