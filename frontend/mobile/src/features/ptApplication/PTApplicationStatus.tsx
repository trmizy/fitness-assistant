import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { Check, CheckCircle2, Hourglass, MessageSquareWarning, Pencil, Search, Send, XCircle, type LucideIcon } from "lucide-react-native";

import { Badge, Button, Card } from "../../components/ui";
import type { PTApplication } from "../../services/api";
import { darkColors, designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import { STATUS_META } from "./ptApplication";

const LIFECYCLE: { key: string; icon: LucideIcon; label: string; desc: string }[] = [
  { key: "SUBMITTED", icon: Send, label: "Đã nộp đơn", desc: "Đơn của bạn đã được ghi nhận" },
  { key: "UNDER_REVIEW", icon: Search, label: "Đang xét duyệt", desc: "Admin đang kiểm tra hồ sơ" },
  { key: "APPROVED", icon: Check, label: "Được duyệt", desc: "Tài khoản PT được kích hoạt" },
];

function fmt(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/**
 * CL-22 — the design's ApplicationStatus (UnderReview / NeedsMoreInfo / Rejected / Approved) with
 * the real application: the lifecycle position, the admin's note, the rejection reason. The
 * design's demo status switcher is not drawn — the status comes from the server.
 *
 * "Nộp đơn mới" after a rejection is not offered: user-service refuses to save a draft once an
 * application is REJECTED, so the button could only fail.
 */
export function PTApplicationStatus({ app, onEdit, onEnterPT }: { app: PTApplication; onEdit: () => void; onEnterPT: () => void }) {
  const accent = useWorkspaceAccent();
  const status = app.status ?? "SUBMITTED";
  const meta = STATUS_META[status];

  if (status === "NEEDS_MORE_INFO") {
    return (
      <View className="gap-5">
        <Hero icon={MessageSquareWarning} tint={designTokens.warning} badge={<Badge tone="warning">{meta.label}</Badge>} title="Admin cần thêm thông tin">
          Đơn tạm dừng xét duyệt. Bổ sung theo yêu cầu bên dưới rồi gửi lại — đơn sẽ tiếp tục được xem xét.
        </Hero>
        {app.adminNote ? (
          <Card className="border-warning/40 bg-warning/5 p-4">
            <Text className="mb-2 font-body-semibold text-sm text-foreground">Yêu cầu từ Admin</Text>
            <Text className="font-body text-sm leading-5 text-muted-foreground">{app.adminNote}</Text>
          </Card>
        ) : null}
        <Button full size="lg" icon={Pencil} onPress={onEdit}>
          Chỉnh sửa & nộp lại
        </Button>
      </View>
    );
  }

  if (status === "REJECTED") {
    return (
      <View className="gap-5">
        <Hero icon={XCircle} tint={darkColors.destructive} badge={<Badge tone="danger">{meta.label}</Badge>} title="Đơn chưa được duyệt">
          Rất tiếc, hồ sơ của bạn chưa đáp ứng yêu cầu lần này.
        </Hero>
        <Card className="border-destructive/40 bg-destructive/5 p-4">
          <Text className="mb-2 font-body-semibold text-sm text-foreground">Lý do từ chối</Text>
          <Text className="font-body text-sm leading-5 text-muted-foreground">{app.rejectionReason || "Admin không ghi lý do."}</Text>
          {fmt(app.reviewedAt) ? <Text className="mt-2 font-body text-xs text-muted-foreground">Ngày xét: {fmt(app.reviewedAt)}</Text> : null}
        </Card>
        <Text className="px-1 font-body text-xs text-muted-foreground">Nếu cần trao đổi thêm, hãy liên hệ bộ phận hỗ trợ Gymini.</Text>
      </View>
    );
  }

  if (status === "APPROVED") {
    return (
      <View className="gap-5">
        <Hero icon={CheckCircle2} tint={accent.primary} badge={<Badge tone="success">{meta.label}</Badge>} title="Chúc mừng — bạn đã là HLV!">
          Tài khoản PT đã được kích hoạt. Vào không gian Huấn luyện viên để bắt đầu nhận học viên.
        </Hero>
        <Button full size="lg" onPress={onEnterPT}>
          Vào không gian Huấn luyện viên
        </Button>
      </View>
    );
  }

  // SUBMITTED and UNDER_REVIEW read the same to the applicant: filed, now waiting on review.
  const current = 1;
  return (
    <View className="gap-5">
      <Hero icon={Hourglass} tint={accent.primary} badge={<Badge tone="warning">{meta.label}</Badge>} title="Cảm ơn bạn đã ứng tuyển!">
        Hồ sơ PT của bạn đang chờ Admin xem xét. Bạn sẽ nhận thông báo khi có kết quả.
      </Hero>
      <Card className="p-5">
        <Text className="mb-4 font-display text-base text-foreground">Tiến trình duyệt</Text>
        {LIFECYCLE.map((st, i) => {
          const done = i < current;
          const active = i === current;
          const StIcon = st.icon;
          return (
            <View key={st.key} className="flex-row gap-3">
              <View className="items-center">
                <View className={`h-9 w-9 items-center justify-center rounded-full ${done ? "bg-primary" : active ? "bg-primary/15" : "bg-panel"}`}>
                  {done ? <Check size={16} strokeWidth={3} color={accent.onPrimary} /> : <StIcon size={16} color={active ? accent.primary : designTokens.mutedForeground} />}
                </View>
                {i < LIFECYCLE.length - 1 ? <View className={`my-1 w-0.5 flex-1 ${done ? "bg-primary" : "bg-border"}`} style={{ minHeight: 24 }} /> : null}
              </View>
              <View className="flex-1 pb-4">
                <Text className={`font-body-semibold text-sm ${active ? "text-primary" : "text-foreground"}`}>{st.label}</Text>
                <Text className="font-body text-xs text-muted-foreground">
                  {st.key === "SUBMITTED" && fmt(app.submittedAt) ? `Nộp ngày ${fmt(app.submittedAt)}` : st.desc}
                </Text>
              </View>
            </View>
          );
        })}
      </Card>
      <Button variant="secondary" full size="lg" onPress={() => (router.canGoBack() ? router.back() : router.replace("/client/profile"))}>
        Về trang cá nhân
      </Button>
    </View>
  );
}

function Hero({ icon: Icon, tint, badge, title, children }: { icon: LucideIcon; tint: string; badge: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="items-center p-6">
      <View className="mb-3 h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: `${tint}26` }}>
        <Icon size={28} color={tint} />
      </View>
      {badge}
      <Text className="mt-3 text-center font-display text-xl text-foreground">{title}</Text>
      <Text className="mt-1.5 text-center font-body text-sm leading-5 text-muted-foreground">{children}</Text>
    </Card>
  );
}
