import { BellIcon as Bell } from "@phosphor-icons/react";
import { SectionCard } from "./components/SectionCard";
import { LinkRow } from "./components/LinkRow";

/**
 * Reuses NotificationPreferencesPage as-is (impact analysis §4) — it
 * already correctly renders exactly the 5 notification types the backend
 * can actually persist/deliver. No second implementation here.
 */
export function NotificationsSection() {
  return (
    <SectionCard
      id="notifications"
      icon={Bell}
      iconColor="text-sky-400"
      iconBg="bg-sky-500/10 border-sky-500/20"
      title="Thông báo"
      description="Bật/tắt từng loại thông báo về buổi tập của bạn"
    >
      <LinkRow
        icon={Bell}
        label="Cài đặt thông báo"
        description="Buổi tập hôm nay, dời lịch, dang dở, cập nhật kế hoạch, phản hồi từ PT"
        to="/client/notification-preferences"
        testId="settings-link-notifications"
      />
      <p className="text-xs text-zinc-600">
        Mọi thông báo hiện chỉ gửi trong ứng dụng — chưa hỗ trợ email/SMS/đẩy
        thông báo trên thiết bị.
      </p>
    </SectionCard>
  );
}
