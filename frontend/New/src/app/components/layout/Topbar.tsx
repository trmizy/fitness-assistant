import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Menu, Bell, Search, ChevronDown, User, Settings,
  LogOut, Zap, Shield, ArrowLeftRight
} from "lucide-react";
import { useApp } from "../../context/AppContext";

const notifications = [
  { id: 1, text: "AI Plan ready for review",     time: "2m ago",  unread: true  },
  { id: 2, text: "Session tomorrow at 10:00 AM", time: "1h ago",  unread: true  },
  { id: 3, text: "InBody analysis complete",     time: "3h ago",  unread: false },
];

export function Topbar() {
  const { user, role, isPT, isAdmin, activeView, setActiveView, setSidebarOpen, logout } = useApp();
  const navigate = useNavigate();

  const [notifOpen,  setNotifOpen]  = useState(false);
  const [userOpen,   setUserOpen]   = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const unreadCount = notifications.filter((n) => n.unread).length;

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
    ? { label: "Admin",          bg: "bg-violet-500/10", border: "border-violet-500/20", text: "text-violet-400", dot: "bg-violet-500" }
    : isPT && activeView === "pt"
    ? { label: "Trainer Mode",   bg: "bg-green-500/10",  border: "border-green-500/20",  text: "text-green-400",  dot: "bg-green-500"  }
    : isPT && activeView === "client"
    ? { label: "Client Mode",    bg: "bg-zinc-800",      border: "border-zinc-700/50",   text: "text-zinc-300",   dot: "bg-zinc-400"   }
    : { label: "Personal Profile",  bg: "bg-green-500/10",  border: "border-green-500/20",  text: "text-green-400",  dot: "bg-green-500"  };

  const avatarBg = isAdmin ? "bg-violet-500" : "bg-green-500";

  return (
    <header className="h-14 bg-zinc-900 border-b border-zinc-800/60 flex items-center justify-between px-4 sticky top-0 z-40">

      {/* Left: hamburger + search */}
      <div className="flex items-center gap-3">
        <button
          className="lg:hidden p-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu className="w-5 h-5" />
        </button>
        <button
          className="sm:hidden p-2 rounded-lg text-zinc-400 hover:bg-zinc-800"
          onClick={() => setSearchOpen(!searchOpen)}
        >
          <Search className="w-4 h-4" />
        </button>
        <div className="hidden sm:flex items-center gap-2 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 w-44 md:w-56">
          <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search…"
            className="bg-transparent text-sm outline-none text-zinc-300 placeholder-zinc-600 w-full"
          />
        </div>
      </div>

      {/* Right: workspace switcher + notifications + user */}
      <div className="flex items-center gap-1.5">

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
              <span className="hidden md:block">Client</span>
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
              <span className="hidden md:block">Trainer</span>
            </button>
          </div>
        )}

        {/* Workspace / role badge */}
        <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${workspaceBadge.bg} ${workspaceBadge.border}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${workspaceBadge.dot}`} />
          <span className={`text-xs font-semibold ${workspaceBadge.text}`}>{workspaceBadge.label}</span>
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            className="relative p-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            onClick={() => { setNotifOpen(!notifOpen); setUserOpen(false); }}
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-green-500 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
            )}
          </button>
          {notifOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-80 bg-zinc-900 rounded-xl shadow-2xl shadow-black/50 border border-zinc-700/50 z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-100">Notifications</h3>
                  {unreadCount > 0 && (
                    <span className="text-xs bg-green-500/15 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full font-semibold">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`px-4 py-3 hover:bg-zinc-800 cursor-pointer border-b border-zinc-800/50 last:border-0 transition-colors ${n.unread ? "bg-green-500/5" : ""}`}
                  >
                    <p className="text-sm text-zinc-200">{n.text}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{n.time}</p>
                  </div>
                ))}
                <div className="px-4 py-2 text-center">
                  <button className="text-xs text-green-400 hover:text-green-300 hover:underline transition-colors">View all</button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            onClick={() => { setUserOpen(!userOpen); setNotifOpen(false); }}
          >
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black ${avatarBg}`}>
              {user?.firstName?.[0] || user?.email?.[0]?.toUpperCase() || "U"}
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500 hidden sm:block" />
          </button>

          {userOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-60 bg-zinc-900 rounded-xl shadow-2xl shadow-black/50 border border-zinc-700/50 z-50 overflow-hidden">
                {/* User info */}
                <div className="px-4 py-3 border-b border-zinc-800">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-black ${avatarBg} shadow-md`}>
                      {user?.firstName?.[0] || user?.email?.[0]?.toUpperCase() || "U"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">
                        {user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email.split('@')[0] : "Personal Profile"}
                      </p>
                      <p className="text-xs text-zinc-500">{user?.email}</p>
                    </div>
                  </div>
                  {/* PT account badge */}
                  {isPT && (
                    <div className="mt-2.5 flex items-center gap-1.5 px-2 py-1.5 bg-green-500/8 border border-green-500/15 rounded-lg">
                      <Zap className="w-3 h-3 text-green-400" />
                      <span className="text-xs text-green-400 font-semibold">PT Account</span>
                      <span className="ml-auto text-xs text-zinc-600">
                        {activeView === "pt" ? "Trainer Mode" : "Client Mode"}
                      </span>
                    </div>
                  )}
                </div>

                {/* PT: workspace switcher in dropdown */}
                {isPT && (
                  <div className="px-3 py-2 border-b border-zinc-800">
                    <p className="text-xs text-zinc-600 font-semibold uppercase tracking-wider mb-1.5 px-1">Switch Workspace</p>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => switchToView("client")}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all border ${
                          activeView === "client"
                            ? "bg-zinc-700 text-zinc-100 border-zinc-600"
                            : "text-zinc-500 border-zinc-800 hover:border-zinc-700 hover:text-zinc-300"
                        }`}
                      >
                        <User className="w-3 h-3" /> Client
                      </button>
                      <button
                        onClick={() => switchToView("pt")}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all border ${
                          activeView === "pt"
                            ? "bg-green-500 text-black border-green-500 shadow-sm shadow-green-500/30"
                            : "text-zinc-500 border-zinc-800 hover:border-zinc-700 hover:text-zinc-300"
                        }`}
                      >
                        <Zap className="w-3 h-3" /> Trainer
                      </button>
                    </div>
                  </div>
                )}

                {/* Menu items */}
                <button
                  onClick={() => { setUserOpen(false); navigate(role === "pt" ? "/pt/profile" : "/client/profile"); }}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                >
                  <User className="w-4 h-4" /> Profile
                </button>
                <button className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
                  <Settings className="w-4 h-4" /> Settings
                </button>

                {/* Admin link */}
                {isAdmin && (
                  <button
                    onClick={() => { setUserOpen(false); navigate("/admin/dashboard"); }}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-violet-400 hover:bg-violet-500/10 transition-colors"
                  >
                    <Shield className="w-4 h-4" /> Admin Panel
                  </button>
                )}

                {/* PT quick switch (mobile-friendly) */}
                {isPT && (
                  <button
                    onClick={() => { setUserOpen(false); switchToView(activeView === "pt" ? "client" : "pt"); }}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                    Switch to {activeView === "pt" ? "Personal" : "Trainer"} View
                  </button>
                )}

                <div className="border-t border-zinc-800">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mobile search bar */}
      {searchOpen && (
        <div className="absolute top-14 left-0 right-0 bg-zinc-900 border-b border-zinc-800 px-4 py-2 sm:hidden z-50">
          <div className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2">
            <Search className="w-4 h-4 text-zinc-500" />
            <input autoFocus type="text" placeholder="Search…" className="bg-transparent text-sm outline-none flex-1 text-zinc-200 placeholder-zinc-600" />
          </div>
        </div>
      )}
    </header>
  );
}
