import { useState, useEffect } from "react";
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
import { connectSocket } from "../../services/socket";
import type { AppNotification } from "../../types";
import { usePendingAiTasks } from "../../stores/pendingAiTasks";
import { LanguageSwitcher } from "../settings/LanguageSwitcher";
import { ThemeToggle } from "../settings/ThemeToggle";
import { AutoText } from "../i18n/AutoText";

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
  const { tasks: pendingAiTasks, pendingCount } = usePendingAiTasks(user?.id);

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

  useEffect(() => {
    const socket = connectSocket();

    const handleNewNotification = (notification: AppNotification) => {
      // Dedup: read cache first, early-return if already exists — prevents badge overcounting
      const current = queryClient.getQueryData<any>(["notifications"]);
      const list: AppNotification[] = current?.notifications || [];
      if (list.some((n) => n.id === notification.id)) return;

      const isUnread = notification.unread !== false;

      queryClient.setQueryData(["notifications"], (old: any) => {
        const oldList: AppNotification[] = old?.notifications || [];
        return {
          ...(old ?? {}),
          notifications: [notification, ...oldList].slice(0, 10),
          unreadCount: (old?.unreadCount || 0) + (isUnread ? 1 : 0),
        };
      });

      queryClient.setQueryData(["notifications-unread"], (old: any) => {
        if (!isUnread) return old ?? { count: 0 };
        return { ...(old ?? {}), count: (old?.count || 0) + 1 };
      });
    };

    socket.on("notification:new", handleNewNotification);
    return () => {
      socket.off("notification:new", handleNewNotification);
    };
    // No disconnectSocket() — chat module reuses this same socket instance
  }, [queryClient]);

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

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const switchToView = (view: "client" | "pt") => {
    setActiveView(view);
    setUserOpen(false);
    navigate(view === "client" ? "/client/dashboard" : "/pt/dashboard");
  };

  // ── Workspace badge config ──────────────────────────────────────────────
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
          <LanguageSwitcher />
          <ThemeToggle />
        </div>

        {/* ── PT workspace switcher (topbar) ── */}
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
              title="AI đang xử lý"
            >
              <span className="text-xs font-semibold">
                AI đang xử lý {pendingCount}
              </span>
            </button>
            {aiTasksOpen && pendingAiTasksOpen.length > 0 && (
              <div className="absolute right-0 top-full mt-2 w-72 glass-panel rounded-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Tác vụ AI
                  </h3>
                  <span className="text-xs bg-amber-500/15 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded-full font-semibold">
                    {pendingCount} đang chạy
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
                          ? "Đang chờ xử lý"
                          : "Đang xử lý"}{" "}
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
                    Thông báo
                  </h3>
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <span className="text-xs bg-green-500/15 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full font-semibold">
                        {unreadCount} mới
                      </span>
                    )}
                    {unreadCount > 0 && (
                      <button
                        onClick={() => markAllReadMutation.mutate()}
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                        title="Mark all read"
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
                          {n.eventType.replace(/_/g, " ").toLowerCase()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {notifications.length === 0 && (
                  <div className="px-4 py-8 text-center text-xs text-zinc-500">
                    Chưa có thông báo nào.
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
                        Tài khoản PT
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
                      Chuyển chế độ
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
