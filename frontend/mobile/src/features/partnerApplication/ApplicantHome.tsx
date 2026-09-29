import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleSlash, Clock, FileText } from "lucide-react-native";

import { Button, Card, Tappable, useToast } from "../../components/ui";
import { partnerApplicationService, type PartnerAccessState } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { useWorkspaceAccent } from "../../theme/workspace";
import { designTokens } from "../../theme/colors";
import { ApplicationWizard } from "./ApplicationWizard";
import { friendlyError } from "./partnerApplication";

/**
 * Nhà của một ỨNG VIÊN. `ownerLanding` gộp năm trạng thái vào một chỗ ("application"), nhưng năm
 * trạng thái đó cần năm thứ khác nhau, nên việc chia nhỏ nằm ở đây:
 *
 * - `SETUP_INCOMPLETE` — tài khoản có, hồ sơ chưa. `bootstrap` là idempotent, dựng nốt phần saga
 *   đăng ký còn dở; không có bước này thì người dùng kẹt vĩnh viễn ở một màn trống.
 * - `ONBOARDING` / `CHANGES_REQUESTED` — khai hồ sơ, sửa theo góp ý: wizard.
 * - `UNDER_REVIEW` — đã nộp, không sửa được nữa: chỉ còn tiến trình.
 * - `REJECTED` — kết thúc với ứng viên; chỉ quản trị viên mở lại được, nên **không** bày nút "sửa
 *   và nộp lại" ở đây (đúng quyết định D3 của kế hoạch web).
 */
export function ApplicantHome({ state }: { state: PartnerAccessState | null }) {
  if (state === "SETUP_INCOMPLETE") return <BootstrapView />;
  if (state === "UNDER_REVIEW") return <UnderReviewView />;
  if (state === "REJECTED") return <RejectedView />;
  return <ApplicationWizard />;
}

function Shell({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }}>
        {children}
      </ScrollView>
    </View>
  );
}

function SignOut() {
  const { logout } = useApp();
  return (
    <Tappable accessibilityLabel="Đăng xuất" onPress={() => void logout()} className="mt-6 self-center p-2">
      <Text className="font-body text-xs text-muted-foreground">Đăng xuất</Text>
    </Tappable>
  );
}

function BootstrapView() {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const boot = useMutation({
    mutationFn: () => partnerApplicationService.bootstrap(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["partner-access-status", uid] });
      await qc.invalidateQueries({ queryKey: ["partner-application", uid] });
    },
    onError: (e) => toast.show(friendlyError(e, "Không mở được hồ sơ"), "danger"),
  });

  return (
    <Shell>
      <Card className="gap-3 p-5">
        <FileText size={22} color={accent.primary} />
        <Text className="font-display text-base text-foreground">Mở hồ sơ đối tác</Text>
        <Text className="font-body text-sm leading-6 text-muted-foreground">
          Tài khoản của bạn chưa gắn với hồ sơ đối tác nào. Mở hồ sơ để bắt đầu khai.
        </Text>
        <Button disabled={boot.isPending} onPress={() => boot.mutate()}>
          {boot.isPending ? "Đang mở…" : "Mở hồ sơ"}
        </Button>
      </Card>
      <SignOut />
    </Shell>
  );
}

function UnderReviewView() {
  const accent = useWorkspaceAccent();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const timeline = useQuery({
    queryKey: ["partner-application-timeline", uid],
    queryFn: () => partnerApplicationService.timeline(),
  });
  const events: any[] = Array.isArray((timeline.data as any)?.events) ? (timeline.data as any).events : [];

  return (
    <Shell>
      <Card className="gap-3 p-5">
        <Clock size={22} color={designTokens.warning} />
        <Text className="font-display text-base text-foreground">Hồ sơ đang được xét duyệt</Text>
        <Text className="font-body text-sm leading-6 text-muted-foreground">
          Gymini đang xem hồ sơ của bạn. Trong lúc chờ, hồ sơ khoá lại để hai bên nhìn cùng một bản. Bạn sẽ nhận
          thông báo khi có kết quả.
        </Text>
      </Card>

      <Text className="mb-2 mt-5 px-1 font-body-semibold text-sm text-foreground">Tiến trình</Text>
      <Card className="overflow-hidden">
        {timeline.isLoading ? (
          <ActivityIndicator className="m-5 self-start" color={accent.primary} />
        ) : events.length === 0 ? (
          <Text className="p-5 font-body text-xs text-muted-foreground">Chưa có mốc nào được ghi lại.</Text>
        ) : (
          events.map((e, i) => (
            <View key={e.id ?? i} className={`gap-0.5 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
              <Text className="font-body-semibold text-xs text-foreground">{eventLabel(e)}</Text>
              {e.at ? (
                <Text className="font-body text-[11px] text-muted-foreground">
                  {new Date(e.at).toLocaleString("vi-VN")}
                  {e.byYou ? " · bạn" : " · Gymini"}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </Card>
      <SignOut />
    </Shell>
  );
}

/** Nhãn tiếng Việt cho các mốc `PartnerAuditLog`; mốc lạ thì hiện nguyên mã, không bịa nghĩa. */
const EVENT_LABEL: Record<string, string> = {
  APPLICATION_SUBMITTED: "Bạn đã gửi hồ sơ",
  APPLICATION_RESUBMITTED: "Bạn đã gửi lại hồ sơ",
  CHANGES_REQUESTED: "Gymini yêu cầu chỉnh sửa",
  ISSUE_MARKED_UPDATED: "Bạn đánh dấu đã cập nhật một mục",
  ISSUE_RESOLVED: "Gymini đã đóng một mục góp ý",
  DOCUMENT_UPLOADED: "Bạn đã tải giấy tờ lên",
  DOCUMENT_REPLACED: "Bạn đã thay giấy tờ",
  DOCUMENT_ACCEPTED: "Gymini đã chấp nhận một giấy tờ",
  DOCUMENT_UPDATE_REQUESTED: "Gymini yêu cầu cập nhật một giấy tờ",
  APPLICATION_APPROVED: "Hồ sơ được duyệt",
  APPLICATION_REJECTED: "Hồ sơ bị từ chối",
  APPLICATION_REOPENED: "Gymini mở lại hồ sơ",
};

function eventLabel(e: any): string {
  return EVENT_LABEL[String(e?.action ?? "")] ?? String(e?.action ?? "Một thay đổi");
}

function RejectedView() {
  const { user } = useApp();
  const uid = user?.id ?? "guest";
  const query = useQuery({ queryKey: ["partner-application", uid], queryFn: () => partnerApplicationService.get() });
  const p: any = (query.data as any)?.partner ?? {};

  return (
    <Shell>
      <Card className="gap-3 p-5">
        <CircleSlash size={22} color={designTokens.mutedForeground} />
        <Text className="font-display text-base text-foreground">Hồ sơ chưa được chấp nhận</Text>
        {p.rejectionReason ? (
          <Text className="font-body text-sm leading-6 text-muted-foreground">Lý do: {p.rejectionReason}</Text>
        ) : null}
        {p.adminNote ? (
          <Text className="font-body text-xs leading-5 text-muted-foreground">Ghi chú: {p.adminNote}</Text>
        ) : null}
        {p.rejectedAt ? (
          <Text className="font-body text-[11px] text-muted-foreground">
            Ngày: {new Date(p.rejectedAt).toLocaleDateString("vi-VN")}
          </Text>
        ) : null}
        {/* Không có nút "sửa và nộp lại": chỉ Gymini mở lại được hồ sơ, và máy chủ cũng khoá mọi
            thao tác sửa ở trạng thái này. Bày một nút chắc chắn bị từ chối là hứa hão. */}
        <Text className="font-body text-xs leading-5 text-muted-foreground">
          Nếu bạn muốn trao đổi thêm, hãy liên hệ Gymini — chỉ Gymini mở lại được hồ sơ này.
        </Text>
      </Card>
      <SignOut />
    </Shell>
  );
}
