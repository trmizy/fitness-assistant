import { useState } from "react";
import { useNavigate } from "react-router";
import { ListIcon as Menu, BellIcon as Bell, CaretDownIcon as ChevronDown, UserIcon as User, GearSixIcon as Settings, SignOutIcon as LogOut, LightningIcon as Zap, ShieldIcon as Shield, ArrowsLeftRightIcon as ArrowLeftRight, ChecksIcon as CheckCheck } from "@phosphor-icons/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../context/AppContext";
import { UserAvatar } from "./UserAvatar";
import { notificationService } from "../../services/api";
import type { AppNotification } from "../../types";
import { usePendingAiTasks } from "../../stores/pendingAiTasks";
import { LanguageSwitcher } from "../settings/LanguageSwitcher";
import { ThemeToggle } from "../settings/ThemeToggle";
import { AutoText } from "../i18n/AutoText";
import { useAutoTranslate } from "../../hooks/useAutoTranslate";
import { useRealtimeNotifications } from "../../hooks/useRealtimeNotifications";
import { WorkspaceSearch } from "./WorkspaceSearch";
import { AppLogo } from "../brand/AppLogo";
import { ComplaintEntryButton } from "./ComplaintEntryButton";

// Roadmap P4.1 "Notifications/reminders" (§27) — labels for the 5 new
// event types this pass added; every pre-existing type keeps using the
// generic fallback below (unchanged behavior for it).
const EVENT_TYPE_LABELS_VI: Partial<Record<string, string>> = {
  WORKOUT_UPCOMING: "buổi tập hôm nay",
  WORKOUT_RESCHEDULED: "đã dời lịch",
  WORKOUT_UNFINISHED: "buổi tập dang dở",
  TRAINING_PLAN_UPDATED: "cập nhật kế hoạch",
  PT_FEEDBACK_RECEIVED: "phản hồi từ PT",
  CONTRACT_PAUSED_PT_SUSPENDED: "Hợp đồng tạm dừng",
  CONTRACT_RESUMED_PT_REINSTATED: "Hợp đồng hoạt động trở lại",
  DISPUTE_CASE_UPDATED: "Cập nhật hồ sơ khiếu nại",
  GYM_COMPLAINT_CASE_OPENED: "Báo cáo đã được tiếp nhận",
  GYM_COMPLAINT_CASE_MORE_INFO: "Cần bổ sung thông tin",
  GYM_COMPLAINT_CASE_SLA_WARNING: "Hồ sơ sắp đến hạn xử lý",
  GYM_COMPLAINT_CASE_SLA_OVERDUE: "Hồ sơ đã quá hạn xử lý",
  GYM_COMPLAINT_CASE_APPEAL_FILED: "Kháng nghị đã được tiếp nhận",
  GYM_COMPLAINT_CASE_RESOLVED: "Hồ sơ đã có kết luận",
  WITHDRAWAL_APPROVED: "Yêu cầu rút tiền đã được duyệt",
  WITHDRAWAL_PAID: "Yêu cầu rút tiền đã chuyển khoản",
  WITHDRAWAL_REJECTED: "Yêu cầu rút tiền bị từ chối",
};
import { useSocket } from "../../hooks/useSocket";
import { useBackDismissible } from "../../hooks/useBackDismissible";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { notificationEventLabel } from "../../utils/notificationEventLabels";
import { fullName } from "../../utils/fullName";

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
  // Dropdown panels are overlays too — Back should close the open one rather than
  // navigate the page behind it. Closed newest-first is not needed: only one opens at a time.
  useBackDismissible(notifOpen, () => setNotifOpen(false));
  useBackDismissible(aiTasksOpen, () => setAiTasksOpen(false));
  useBackDismissible(userOpen, () => setUserOpen(false));

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
  // NIGHT GLASS prototype: Client/PT get workspace search in the top bar; the language picker moves into the account
  // menu (all widths) instead of sitting in the bar. Gym Owner keeps the previous bar unchanged.
  const nightGlass = role === "client" || role === "pt";

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
        label: "Quản trị viên",
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
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          aria-label="Mở menu"
          aria-haspopup="dialog"
          className="lg:hidden p-3 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        {/* Phones/tablets have no rail: the official logo sits in the bar, whole (contained, not cropped). */}
        {nightGlass && <AppLogo className="lg:hidden h-10 w-10 flex-shrink-0" imgClassName="gymini-brand-logo h-10 w-10" />}
        {/* Client/PT: workspace search (functions + the existing /client/search library page). Gym Owner: none. */}
        {nightGlass && <WorkspaceSearch />}
      </div>

      {/* Right: workspace switcher + notifications + user */}
      <div className="flex items-center gap-1.5">
        <div className="hidden md:flex items-center gap-1.5 mr-1">
          <span
            className={`inline-flex h-2.5 w-2.5 rounded-full ${
              realtimeConnected ? "bg-emerald-400" : "bg-zinc-600"
            }`}
            title={realtimeConnected ? "Đang kết nối trực tiếp" : "Mất kết nối trực tiếp"}
          />
          {!nightGlass && <LanguageSwitcher />}
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
              <AutoText className="hidden md:block">
                Thành viên
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
              <AutoText className="hidden md:block">
                Huấn luyện viên
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
            <AutoText>
              {workspaceBadge.label}
            </AutoText>
          </span>
        </div>

        {/* Khiếu nại (client + PT, both modes): moved here from the sidebar; right of the green role chip. */}
        <ComplaintEntryButton />

        {pendingCount > 0 && (
          <Popover open={aiTasksOpen && pendingAiTasksOpen.length > 0} onOpenChange={setAiTasksOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="hidden sm:flex items-center gap-1.5 px-2.5 min-h-10 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15 transition-colors"
                title={aiProcessingTitle}
              >
                <span className="text-xs font-semibold">
                  <AutoText>AI đang xử lý</AutoText> {pendingCount}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              collisionPadding={8}
              aria-label="Tác vụ AI đang chạy"
              className="w-72 glass-panel rounded-xl p-0 z-50 overflow-hidden border-zinc-700/50 bg-zinc-950/60 text-zinc-100"
            >
              <div>
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
                        {new Date(task.createdAt).toLocaleTimeString("vi-VN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Notifications */}
        <Popover open={notifOpen} onOpenChange={setNotifOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="notification-bell"
              aria-label={unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : "Thông báo"}
              className="relative p-2.5 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            >
              <Bell className="w-5 h-5" aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute top-2 right-2 w-2 h-2 bg-green-500 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={4}
            collisionPadding={8}
            aria-label="Thông báo"
            className="w-80 max-w-[calc(100vw-1rem)] glass-panel rounded-xl p-0 z-50 overflow-hidden border-zinc-700/50 bg-zinc-950/60 text-zinc-100"
          >
            <div>
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
                        type="button"
                        onClick={() => markAllReadMutation.mutate()}
                        className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                        title={markAllReadTitle}
                        aria-label={markAllReadTitle}
                      >
                        <CheckCheck className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.map((n: AppNotification) => (
                    <button
                      type="button"
                      key={n.id}
                      data-testid={`notification-item-${n.eventType}`}
                      onClick={() => {
                        if (n.unread) markReadMutation.mutate(n.id);
                        // Gym complaint case notices: admin, member (client/PT) and gym owner each have their own case page (ND-07).
                        const caseLink =
                          n.entityType === "DISPUTE_CASE" && n.entityId
                            ? `${isAdmin ? "/admin/disputes" : "/disputes"}/${encodeURIComponent(n.entityId)}`
                            : n.entityType === "GYM_COMPLAINT_CASE" && n.entityId && (isAdmin || role === "client" || role === "pt" || role === "gym_owner")
                              ? `${isAdmin ? "/admin/complaints/cases" : role === "gym_owner" ? "/gym-owner/complaint-cases" : "/complaint-cases"}/${encodeURIComponent(n.entityId)}`
                              : null;
                        if (caseLink || n.link) {
                          navigate(caseLink ?? n.link!);
                          setNotifOpen(false);
                        }
                      }}
                      className={`block w-full text-left px-4 py-3 hover:bg-zinc-800 cursor-pointer border-b border-zinc-800/50 last:border-0 transition-colors ${n.unread ? "bg-green-500/5" : ""}`}
                    >
                      <span className="block text-sm text-zinc-200">{n.text}</span>
                      <span className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-zinc-500">
                          {new Date(n.createdAt).toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="text-xs text-zinc-700">
                          {EVENT_TYPE_LABELS_VI[n.eventType] ?? notificationEventLabel(n.eventType)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                {notifications.length === 0 && (
                  <div className="px-4 py-8 text-center text-xs text-zinc-500">
                    <AutoText>Chưa có thông báo nào.</AutoText>
                  </div>
                )}
            </div>
          </PopoverContent>
        </Popover>

        {/* User menu (Radix DropdownMenu: Esc / Tab / arrows / focus return come with it) */}
        <DropdownMenu open={userOpen} onOpenChange={setUserOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Menu tài khoản"
              className="flex items-center gap-2 p-1.5 min-h-10 min-w-10 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <UserAvatar
                className="w-7 h-7"
                fallbackClassName={`text-xs font-bold text-black ${avatarBg}`}
              />
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500 hidden sm:block" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            sideOffset={4}
            collisionPadding={8}
            className="w-60 max-w-[calc(100vw-1rem)] glass-panel rounded-xl p-0 z-50 overflow-hidden border-zinc-700/50 bg-zinc-950/60 text-zinc-100"
          >
            {/* User info */}
            <div className="px-4 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <UserAvatar
                  className="w-9 h-9 shadow-md"
                  fallbackClassName={`text-xs font-bold text-black ${avatarBg}`}
                />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">
                    {user
                      ? fullName(user) ||
                        user.email.split("@")[0]
                      : "Hồ sơ cá nhân"}
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
                <p className="text-xs text-zinc-600 font-semibold mb-1.5 px-1">
                  <AutoText>Chuyển chế độ</AutoText>
                </p>
                <div className="flex gap-1.5">
                  <DropdownMenuItem
                    onSelect={() => switchToView("client")}
                    className={`flex-1 justify-center gap-1.5 min-h-10 py-2 rounded-lg text-xs font-semibold transition-all border ${
                      activeView === "client"
                        ? "bg-zinc-700 text-zinc-100 border-zinc-600 focus:bg-zinc-600 focus:text-zinc-100"
                        : "text-zinc-500 border-zinc-800 hover:border-zinc-700 hover:text-zinc-300 focus:bg-zinc-800 focus:text-zinc-200"
                    }`}
                  >
                    <User className="w-3 h-3 text-current" /> Thành viên
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => switchToView("pt")}
                    className={`flex-1 justify-center gap-1.5 min-h-10 py-2 rounded-lg text-xs font-semibold transition-all border ${
                      activeView === "pt"
                        ? "bg-green-500 text-black border-green-500 shadow-sm shadow-green-500/30 focus:bg-green-400 focus:text-black"
                        : "text-zinc-500 border-zinc-800 hover:border-zinc-700 hover:text-zinc-300 focus:bg-zinc-800 focus:text-zinc-200"
                    }`}
                  >
                    <Zap className="w-3 h-3 text-current" /> Huấn luyện viên
                  </DropdownMenuItem>
                </div>
              </div>
            )}

            {/* Language / theme. Theme sits in the top bar from md up; for Client/PT the language picker now lives
                only here (every width), for Gym Owner it is still in the bar from md up. */}
            <div className={`${nightGlass ? "flex" : "flex md:hidden"} items-center gap-2 px-3 py-2 border-b border-zinc-800`}>
              <LanguageSwitcher />
              <span className="md:hidden"><ThemeToggle /></span>
            </div>

            {/* Mỗi vai trò có trang hồ sơ của riêng mình. Admin chưa có — trước đây admin và chủ gym
                đều bị đưa sang /client/profile và dính 403 (RequireRole client). */}
            {!isAdmin && (
              <DropdownMenuItem
                onSelect={() => navigate(role === "pt" ? "/pt/profile" : role === "gym_owner" ? "/gym-owner/profile" : "/client/profile")}
                className="gap-2 rounded-none min-h-10 px-4 py-2.5 text-sm text-zinc-300 focus:bg-zinc-800 focus:text-zinc-100 transition-colors"
              >
                <User className="w-4 h-4 text-current" /> <AutoText>Hồ sơ cá nhân</AutoText>
              </DropdownMenuItem>
            )}
            {/* Settings Center is a client-workspace surface for now
                (docs/features/PRODUCT_COMPLETENESS_IMPACT_ANALYSIS.md
                §12) — admin/gym_owner accounts have no client fitness
                data and no Settings surface of their own yet, so this
                entry point is scoped exactly like "Hồ sơ cá nhân" above. */}
            {!isAdmin && role !== "gym_owner" && (
              <DropdownMenuItem
                data-testid="topbar-settings-link"
                onSelect={() => navigate("/client/settings")}
                className="gap-2 rounded-none min-h-10 px-4 py-2.5 text-sm text-zinc-300 focus:bg-zinc-800 focus:text-zinc-100 transition-colors"
              >
                <Settings className="w-4 h-4 text-current" /> <AutoText>Cài đặt</AutoText>
              </DropdownMenuItem>
            )}

            {/* Admin link */}
            {isAdmin && (
              <DropdownMenuItem
                onSelect={() => navigate("/admin/dashboard")}
                className="gap-2 rounded-none min-h-10 px-4 py-2.5 text-sm text-violet-400 focus:bg-violet-500/10 focus:text-violet-400 transition-colors"
              >
                <Shield className="w-4 h-4 text-current" /> <AutoText>Trang Admin</AutoText>
              </DropdownMenuItem>
            )}

            {/* PT quick switch (mobile-friendly) */}
            {isPT && (
              <DropdownMenuItem
                onSelect={() => switchToView(activeView === "pt" ? "client" : "pt")}
                className="gap-2 rounded-none min-h-10 px-4 py-2.5 text-sm text-zinc-400 focus:bg-zinc-800 focus:text-zinc-200 transition-colors"
              >
                <ArrowLeftRight className="w-4 h-4 text-current" />
                <AutoText>
                  {activeView === "pt"
                    ? "Chuyển sang chế độ thành viên"
                    : "Chuyển sang chế độ PT"}
                </AutoText>
              </DropdownMenuItem>
            )}

            <div className="border-t border-zinc-800">
              <DropdownMenuItem
                onSelect={handleLogout}
                className="gap-2 rounded-none min-h-10 px-4 py-2.5 text-sm text-red-400 focus:bg-red-500/10 focus:text-red-400 transition-colors"
              >
                <LogOut className="w-4 h-4 text-current" /> <AutoText>Đăng xuất</AutoText>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
