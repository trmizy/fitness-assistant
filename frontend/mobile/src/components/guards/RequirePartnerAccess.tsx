import type { ReactNode } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Building2, ShieldAlert } from "lucide-react-native";

import { Button, Card } from "../ui";
import { useApp } from "../../context/AppContext";
import { partnerApplicationService } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { darkColors } from "../../theme/colors";
import { accessStateText, ownerLanding } from "../../features/gymOwner/gymOwner";
import { PartnerOnboardingWizard } from "../../features/gymOwner/PartnerOnboardingWizard";
import { ApplicantHome } from "../../features/partnerApplication/ApplicantHome";

/**
 * The gym-owner workspace's door. Web does this with `RootRedirect` + `RequireApprovedPartner`
 * driven by `GET /owner/application/status`; this is the same gate on the same value.
 *
 * Why a gate at all, when the server already refuses an applicant's operational calls: an
 * unguarded shell would render the dashboard, fire five requests, and paint five error cards —
 * telling a partner "something went wrong" when nothing did. The honest answer is "your
 * application is still being reviewed", and only the server's `accessState` knows that.
 *
 * Failing CLOSED is deliberate here, unlike `RequireOnboarding` which fails open: onboarding is a
 * UX nicety, this is an authorization boundary. If the status cannot be read, the workspace stays
 * shut and says so.
 *
 * The application and payout destinations are Phase 12's later clusters; until those screens
 * exist, this explains the state in plain Vietnamese rather than pretending to route somewhere.
 */
export function RequirePartnerAccess({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const { isAuthenticated, role, user } = useApp();

  const statusQuery = useQuery({
    queryKey: ["partner-access-status", user?.id ?? "guest"],
    queryFn: () => partnerApplicationService.status(),
    enabled: isAuthenticated && role === "gym_owner",
    // Always re-read on mount: an approval that lands while the app is open must not leave the
    // owner staring at "đang xét duyệt" until they reinstall.
    staleTime: 0,
    refetchOnMount: "always",
  });

  if (!isAuthenticated || role !== "gym_owner") return <>{children}</>;

  if (statusQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={accent.primary} />
      </View>
    );
  }

  const state = statusQuery.data?.accessState ?? null;
  /**
   * Fail-closed đúng cho lần hỏi ĐẦU TIÊN: chưa bao giờ biết trạng thái thì không mở cửa.
   *
   * Nhưng một lần làm mới hỏng SAU KHI đã biết thì khác hẳn — cứ `isError` là chặn sẽ hất người
   * dùng ra khỏi màn họ đang làm dở. Đã gặp thật: lưu xong một bước của hồ sơ, lần làm mới trạng
   * thái chớp một cái, cả wizard biến mất dù dữ liệu đã lưu. React Query vẫn giữ `data` cũ qua một
   * lần refetch hỏng, nên chỉ chặn khi lỗi mà CHƯA TỪNG có câu trả lời nào.
   */
  const landing = statusQuery.isError && !statusQuery.data ? "blocked" : ownerLanding(state);
  if (landing === "operational") return <>{children}</>;

  /**
   * `APPROVED_PAYOUT_PENDING` = hồ sơ đã duyệt, chỉ còn bước thiết lập. Đó là việc làm được ngay
   * trong ứng dụng (GY-08), nên dẫn thẳng vào trình thiết lập thay vì giải thích rồi bảo sang web.
   *
   * Cố ý KHÔNG phải một route dưới `app/gym-owner/`: route đó sẽ nằm trong đúng vùng mà cổng này
   * đang chặn, và nó cũng phải là màn chặn toàn màn hình không có thanh tab — rời khỏi thiết lập
   * không phải là hoàn tất nó.
   */
  if (landing === "payout") return <PartnerOnboardingWizard />;

  /**
   * Ứng viên: khai hồ sơ, theo dõi xét duyệt, xem kết quả — tất cả làm được ngay trong ứng dụng từ
   * Phase 12 cụm D, nên không còn màn giải thích "hãy sang web" nữa. `ApplicantHome` chia tiếp năm
   * trạng thái ứng viên, vì chúng cần năm thứ khác nhau.
   */
  if (landing === "application" && state) return <ApplicantHome state={state} />;

  const text = statusQuery.isError
    ? {
        title: "Không đọc được trạng thái hồ sơ",
        body: "Chưa xác nhận được quyền truy cập của bạn. Kéo xuống để thử lại.",
      }
    : accessStateText(state);

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 }}>
        <View className="items-center gap-4">
          <View className="h-16 w-16 items-center justify-center rounded-2xl bg-panel">
            {landing === "blocked" ? (
              <ShieldAlert size={28} color={darkColors.destructive} />
            ) : (
              <Building2 size={28} color={accent.primary} />
            )}
          </View>
          <Text className="text-center font-display text-xl text-foreground">{text.title}</Text>
          <Text className="text-center font-body text-sm leading-6 text-muted-foreground">{text.body}</Text>

          <Card className="mt-2 w-full gap-2 p-4">
            <Text className="font-body text-xs text-muted-foreground">
              {"Nếu bạn cho rằng đây là nhầm lẫn, hãy liên hệ Gymini."}
            </Text>
          </Card>

          <Button variant="secondary" onPress={() => void statusQuery.refetch()}>
            {statusQuery.isRefetching ? "Đang kiểm tra…" : "Kiểm tra lại"}
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}
