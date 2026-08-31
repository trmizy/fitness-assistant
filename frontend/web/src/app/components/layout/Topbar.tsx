import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Menu,
  Bell,
  Search,
  ChevronDown,
  User,
  Settings,
  LogOut,
  Zap,
  Shield,
  ArrowLeftRight,
  CheckCheck,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../context/AppContext";
import { notificationService } from "../../services/api";
import type { AppNotification } from "../../types";
import { usePendingAiTasks } from "../../stores/pendingAiTasks";
import { LanguageSwitcher } from "../settings/LanguageSwitcher";
import { ThemeToggle } from "../settings/ThemeToggle";
import { AutoText } from "../i18n/AutoText";
import { useAutoTranslate } from "../../hooks/useAutoTranslate";
import { useRealtimeNotifications } from "../../hooks/useRealtimeNotifications";

// Roadmap P4.1 "Notifications/reminders" (§27) — labels for the 5 new
// event types this pass added; every pre-existing type keeps using the
// generic fallback below (unchanged behavior for it).
const EVENT_TYPE_LABELS_VI: Partial<Record<string, string>> = {
  WORKOUT_UPCOMING: "buổi tập hôm nay",
  WORKOUT_RESCHEDULED: "đã dời lịch",
  WORKOUT_UNFINISHED: "buổi tập dang dở",
  TRAINING_PLAN_UPDATED: "cập nhật kế hoạch",
  PT_FEEDBACK_RECEIVED: "phản hồi từ PT",
};
import { useSocket } from "../../hooks/useSocket";

export function Topbar() {
  const {
    user,
    role,
    isPT,
    isAdmin,
    activeView,
    setActiveView,
    setSidebarOpen,
    logout,
  } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useRealtimeNotifications();
  const { status: realtimeStatus } = useSocket();
  const { tasks: pendingAiTasks, pendingCount } = usePendingAiTasks(user?.id);
  const { text: aiProcessingTitle } = useAutoTranslate("AI đang xử lý", "vi");
  const { text: markAllReadTitle } = useAutoTranslate(
    "Đánh dấu tất cả đã đọc",
    "vi",
  );

  const [notifOpen, setNotifOpen] = useState(false);
  const [aiTasksOpen, setAiTasksOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const { data: notifData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationService.list(1, 10),
    refetchInterval: 60000,
  });

  const { data: unreadData } = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: () => notificationService.getUnreadCount(),
    refetchInterval: 60000,
  });


  const markAllReadMutation = useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationService.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  const notifications: AppNotification[] = notifData?.notifications || [];
  const unreadCount: number = unreadData?.count || 0;
  const realtimeConnected = realtimeStatus === "connected";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const switchToView = (view: "client" | "pt") => {
    setActiveView(view);
    setUserOpen(false);
    navigate(view === "client" ? "/client/dashboard" : "/pt/dashboard");
  };

  // Workspace badge config
  const workspaceBadge = isAdmin
    ? {
        label: "Admin",
        bg: "bg-violet-500/10",
        border: "border-violet-500/20",
        text: "text-violet-400",
        dot: "bg-violet-500",
      }
    : isPT && activeView === "pt"
      ? {
          label: "Chế độ PT",
          bg: "bg-green-500/10",
          border: "border-green-500/20",
          text: "text-green-400",
          dot: "bg-green-500",
        }
      : isPT && activeView === "client"
        ? {
            label: "Chế độ thành viên",
            bg: "bg-zinc-800",
            border: "border-zinc-700/50",
            text: "text-zinc-300",
            dot: "bg-zinc-400",
          }
        : {
            label: "Trang cá nhân",
            bg: "bg-green-500/10",
            border: "border-green-500/20",
            text: "text-green-400",
            dot: "bg-green-500",
          };

  const avatarBg = isAdmin ? "bg-violet-500" : "bg-green-500";
  const pendingAiTasksOpen = pendingAiTasks.filter(
    (task) => task.status === "QUEUED" || task.status === "PROCESSING",
  );

  return (
    <header className="h-14 bg-zinc-950/40 backdrop-blur-md border-b border-zinc-800/60 flex items-center justify-between px-4 sticky top-0 z-40">
      {/* Left: hamburger + search */}
      <div className="flex items-center gap-3">
        <button
          className="lg:hidden p-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Right: workspace switcher + notifications + user */}
      <div className="flex items-center gap-1.5">
        <div className="hidden md:flex items-center gap-1.5 mr-1">
          <span
            className={`inline-flex h-2.5 w-2.5 rounded-full ${
              realtimeConnected ? "bg-emerald-400" : "bg-zinc-600"
            }`}
            title={realtimeConnected ? "Realtime connected" : "Realtime offline"}
          />
          <LanguageSwitcher />
          <ThemeToggle />
        </div>

        {/* PT workspace switcher */}
        {isPT && (
          <div className="hidden sm:flex items-center bg-zinc-800/70 border border-zinc-700/50 rounded-xl p-1 gap-0.5 mr-1">
            <button
              onClick={() => switchToView("client")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === "client"
                  ? "bg-zinc-700 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <User className="w-3 h-3" />
              <AutoText className="hidden md:block" sourceLang="en">
                Client
              </AutoText>
            </button>
            <button
              onClick={() => switchToView("pt")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === "pt"
                  ? "bg-green-500 text-black shadow-sm shadow-green-500/30"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Zap className="w-3 h-3" />
              <AutoText className="hidden md:block" sourceLang="en">
                Trainer
              </AutoText>
            </button>
          </div>
        )}

        {/* Workspace / role badge */}
        <div
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${workspaceBadge.bg} ${workspaceBadge.border}`}
        >
          <div className={`w-1.5 h-1.5 rounded-full ${workspaceBadge.dot}`} />
          <span className={`text-xs font-semibold ${workspaceBadge.text}`}>
            <AutoText sourceLang={workspaceBadge.label === "Admin" ? "en" : "vi"}>
              {workspaceBadge.label}
            </AutoText>
          </span>
        </div>

        {pendingCount > 0 && (
          <div className="relative">
            <button
              onClick={() => setAiTasksOpen((open) => !open)}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15 transition-colors"
              title={aiProcessingTitle}
            >
              <span className="text-xs font-semibold">
                <AutoText>AI đang xử lý</AutoText> {pendingCount}
              </span>
            </button>
            {aiTasksOpen && pendingAiTasksOpen.length > 0 && (
              <div className="absolute right-0 top-full mt-2 w-72 glass-panel rounded-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-100">
                    <AutoText>Tác vụ AI</AutoText>
                  </h3>
                  <span className="text-xs bg-amber-500/15 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded-full font-semibold">
                    {pendingCount} <AutoText>đang chạy</AutoText>
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {pendingAiTasksOpen.map((task) => (
                    <button
                      key={task.id}
                      onClick={() => {
                        setAiTasksOpen(false);
                        navigate(task.link);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-zinc-800 border-b border-zinc-800/50 last:border-0 transition-colors"
                    >
                      <div className="text-sm text-zinc-200 font-medium">
                        {task.title}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {task.status === "QUEUED"
                          ? <AutoText>Đang chờ xử lý</AutoText>
                          : <AutoText>Đang xử lý</AutoText>}{" "}
                        ·{" "}
                        {new Date(task.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Notifications */}
        <div className="relative">
          <button
            data-testid="notification-bell"
            className="relative p-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            onClick={() => {
              setNotifOpen(!notifOpen);
              setUserOpen(false);
            }}
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-green-500 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
            )}
          </button>
          {notifOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setNotifOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 w-80 glass-panel rounded-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-100">
                    <AutoText>Thông báo</AutoText>
                  </h3>
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <span className="text-xs bg-green-500/15 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full font-semibold">
                        {unreadCount} <AutoText>mới</AutoText>
                      </span>
                    )}
                    {unreadCount > 0 && (
                      <button
                        onClick={() => markAllReadMutation.mutate()}
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                        title={markAllReadTitle}
                      >
                        <CheckCheck className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.map((n: AppNotification) => (
                    <div
                      key={n.id}
                      data-testid={`notification-item-${n.eventType}`}
                      onClick={() => {
                        if (n.unread) markReadMutation.mutate(n.id);
                        if (n.link) {
                          navigate(n.link);
                          setNotifOpen(false);
                        }
                      }}
                      className={`px-4 py-3 hover:bg-zinc-800 cursor-pointer border-b border-zinc-800/50 last:border-0 transition-colors ${n.unread ? "bg-green-500/5" : ""}`}
                    >
                      <p className="text-sm text-zinc-200">{n.text}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-zinc-500">
                          {new Date(n.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="text-xs text-zinc-700">
                          {EVENT_TYPE_LABELS_VI[n.eventType] ?? n.eventType.replace(/_/g, " ").toLowerCase()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {notifications.length === 0 && (
                  <div className="px-4 py-8 text-center text-xs text-zinc-500">
                    <AutoText>Chưa có thông báo nào.</AutoText>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            onClick={() => {
              setUserOpen(!userOpen);
              setNotifOpen(false);
            }}
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black ${avatarBg}`}
            >
              {user?.firstName?.[0] || user?.email?.[0]?.toUpperCase() || "U"}
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500 hidden sm:block" />
          </button>

          {userOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setUserOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 w-60 glass-panel rounded-xl z-50 overflow-hidden">
                {/* User info */}
                <div className="px-4 py-3 border-b border-zinc-800">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-black ${avatarBg} shadow-md`}
                    >
                      {user?.firstName?.[0] ||
                        user?.email?.[0]?.toUpperCase() ||
                        "U"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">
                        {user
                          ? `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
                            user.email.split("@")[0]
                          : "Personal Profile"}
                      </p>
                      <p className="text-xs text-zinc-500">{user?.email}</p>
                    </div>
                  </div>
                  {/* PT account badge */}
                  {isPT && (
                    <div className="mt-2.5 flex items-center gap-1.5 px-2 py-1.5 bg-green-500/8 border border-green-500/15 rounded-lg">
                      <Zap className="w-3 h-3 text-green-400" />
                      <span className="text-xs text-green-400 font-semibold">
                        <AutoText>Tài khoản PT</AutoText>
                      </span>
                      <span className="ml-auto text-xs text-zinc-600">
                        {activeView === "pt"
                          ? "Chế độ PT"
                          : "Chế độ thành viên"}
                      </span>
                    </div>
                  )}
                </div>

                {/* PT: workspace switcher in dropdown */}
                {isPT && (
                  <div className="px-3 py-2 border-b border-zinc-800">
                    <p className="text-xs text-zinc-600 font-semibold uppercase tracking-wider mb-1.5 px-1">
                      <AutoText>Chuyển chế độ</AutoText>
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => switchToView("client")}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all border ${
                          activeView === "client"
                            ? "bg-zinc-700 text-zinc-100 border-zinc-600"
                            : "text-zinc-500 border-zinc-800 hover:border-zinc-700 hover:text-zinc-300"
                        }`}
                      >
                        <User className="w-3 h-3" /> Thành viên
                      </button>
                      <button
                        onClick={() => switchToView("pt")}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all border ${
                          activeView === "pt"
                            ? "bg-green-500 text-black border-green-500 shadow-sm shadow-green-500/30"
                            : "text-zinc-500 border-zinc-800 hover:border-zinc-700 hover:text-zinc-300"
                        }`}
                      >
                        <Zap className="w-3 h-3" /> Huấn luyện viên
                      </button>
                    </div>
                  </div>
                )}

                {/* Menu items */}
                <div className="flex md:hidden items-center gap-2 px-3 py-2 border-b border-zinc-800">
                  <LanguageSwitcher />
                  <ThemeToggle />
                </div>

                <button
                  onClick={() => {
                    setUserOpen(false);
                    navigate(role === "pt" ? "/pt/profile" : "/client/profile");
                  }}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                >
                  <User className="w-4 h-4" /> <AutoText>Hồ sơ cá nhân</AutoText>
                </button>
                <button className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
                  <Settings className="w-4 h-4" /> <AutoText>Cài đặt</AutoText>
                </button>

                {/* Admin link */}
                {isAdmin && (
                  <button
                    onClick={() => {
                      setUserOpen(false);
                      navigate("/admin/dashboard");
                    }}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-violet-400 hover:bg-violet-500/10 transition-colors"
                  >
                    <Shield className="w-4 h-4" /> <AutoText>Trang Admin</AutoText>
                  </button>
                )}

                {/* PT quick switch (mobile-friendly) */}
                {isPT && (
                  <button
                    onClick={() => {
                      setUserOpen(false);
                      switchToView(activeView === "pt" ? "client" : "pt");
                    }}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                    <AutoText>
                      {activeView === "pt"
                        ? "Chuyển sang chế độ thành viên"
                        : "Chuyển sang chế độ PT"}
                    </AutoText>
                  </button>
                )}

                <div className="border-t border-zinc-800">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" /> <AutoText>Đăng xuất</AutoText>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
