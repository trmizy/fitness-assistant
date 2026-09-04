import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon as ArrowLeft, BellIcon as Bell, CircleNotchIcon as Loader2 } from "@phosphor-icons/react";
import { toast } from "sonner";
import { notificationService, type NotificationPreferences } from "../../services/api";

/**
 * Roadmap P4.1 "Notifications/reminders" (§27) — "Need preference
 * controls." Per-type toggles, all default `true` (matches the backend's
 * own "no row yet = everything on" convention — never silently opts
 * anyone out).
 */

const TOGGLES: Array<{ key: keyof NotificationPreferences; label: string; description: string }> = [
  {
    key: "workoutUpcomingEnabled",
    label: "Buổi tập hôm nay",
    description: "Nhắc bạn khi có buổi tập được lên lịch hôm nay mà chưa bắt đầu",
  },
  {
    key: "workoutRescheduledEnabled",
    label: "Đã dời lịch",
    description: "Xác nhận mỗi khi bạn dời lịch một buổi tập",
  },
  {
    key: "workoutUnfinishedEnabled",
    label: "Buổi tập dang dở",
    description: "Nhắc bạn khi có buổi tập đã bắt đầu nhưng chưa hoàn thành",
  },
  {
    key: "planUpdatedEnabled",
    label: "Cập nhật kế hoạch",
    description: "Báo khi PT của bạn gán hoặc cập nhật chương trình tập luyện",
  },
  {
    key: "ptFeedbackEnabled",
    label: "Phản hồi từ PT",
    description: "Báo khi PT của bạn gửi phản hồi về buổi tập",
  },
];

export function NotificationPreferencesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => notificationService.getPreferences(),
  });

  const [local, setLocal] = useState<NotificationPreferences | null>(null);
  useEffect(() => {
    if (query.data) setLocal(query.data);
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) => notificationService.updatePreferences(patch),
    onSuccess: (data) => {
      setLocal(data);
      queryClient.setQueryData(["notification-preferences"], data);
    },
    onError: () => {
      toast.error("Không thể cập nhật cài đặt thông báo");
      // Revert the optimistic flip.
      if (query.data) setLocal(query.data);
    },
  });

  const toggle = (key: keyof NotificationPreferences) => {
    if (!local) return;
    const next = { ...local, [key]: !local[key] };
    setLocal(next);
    mutation.mutate({ [key]: next[key] });
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300">
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại
      </button>

      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Bell className="w-5 h-5 text-sky-400" /> Cài đặt thông báo
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">Bật/tắt từng loại thông báo về buổi tập của bạn.</p>
      </div>

      {query.isLoading || !local ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải...
        </div>
      ) : (
        <div className="space-y-2" data-testid="notification-preferences-list">
          {TOGGLES.map((t) => (
            <div
              key={t.key}
              data-testid={`notification-preference-${t.key}`}
              className="flex items-center justify-between gap-4 rounded-xl border border-zinc-700/40 bg-zinc-900/50 p-4"
            >
              <div>
                <p className="text-sm text-zinc-200 font-semibold">{t.label}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{t.description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={local[t.key]}
                data-testid={`notification-preference-toggle-${t.key}`}
                onClick={() => toggle(t.key)}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  local[t.key] ? "bg-emerald-500" : "bg-zinc-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    local[t.key] ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
