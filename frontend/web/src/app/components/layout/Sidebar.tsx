import { NavLink, useNavigate } from "react-router";
import { useApp } from "../../context/AppContext";
import {
  LayoutDashboard, Activity, Brain, FileText, MessageSquare,
  Calendar, Dumbbell, Utensils, Users, Search, Bot, User,
  Shield, UserCheck, Monitor, X, LogOut, ClipboardList,
  Zap, ChevronRight, ArrowLeftRight, Workflow
} from "lucide-react";

// ─── Navigation definitions ────────────────────────────────────────────────

/** Full client nav — shown to pure Client accounts */
const clientNavFull = [
  { label: "Dashboard",      icon: LayoutDashboard, to: "/client/dashboard" },
  { label: "InBody",         icon: Activity,        to: "/client/inbody"    },
  { label: "AI Plans",       icon: Brain,           to: "/client/plans"     },
  { label: "Workout Log",    icon: Dumbbell,        to: "/client/workout"   },
  { label: "Nutrition",      icon: Utensils,        to: "/client/nutrition" },
  { label: "Find a Coach",   icon: Search,          to: "/client/coaches"   }, // hidden for PT
  { label: "Contracts",      icon: FileText,        to: "/client/contracts" },
  { label: "Booking",        icon: Calendar,        to: "/client/booking"   },
  { label: "Chat",           icon: MessageSquare,   to: "/client/chat"      },
  { label: "AI Coach",       icon: Bot,             to: "/client/ai-coach"  },
  { label: "Profile",        icon: User,            to: "/client/profile"   },
];

/** Client nav for PT users — no Find a Coach, no Chat (PT chats from Trainer workspace) */
const ptClientNav = clientNavFull.filter((n) => n.to !== "/client/coaches" && n.to !== "/client/chat");

/** PT professional workspace nav */
const ptWorkspaceNav = [
  { label: "PT Dashboard",   icon: LayoutDashboard, to: "/pt/dashboard"  },
  { label: "My Clients",     icon: Users,           to: "/pt/clients"    },
  { label: "Contracts",      icon: FileText,        to: "/pt/contracts"  },
  { label: "Plan Review",    icon: ClipboardList,   to: "/pt/plans"      },
  { label: "Schedule",       icon: Calendar,        to: "/pt/schedule"   },
  { label: "Chat",           icon: MessageSquare,   to: "/pt/chat"       },
  { label: "PT Profile",     icon: User,            to: "/pt/profile"    },
];

/** Admin nav */
const adminNav = [
  { label: "Dashboard",        icon: LayoutDashboard, to: "/admin/dashboard"       },
  { label: "Users",            icon: Users,           to: "/admin/users"           },
  { label: "PT Management",    icon: UserCheck,       to: "/admin/pts"             },
  { label: "System Monitor",   icon: Monitor,         to: "/admin/system"          },
  { label: "Workflows",        icon: Workflow,        to: "/admin/workflows"       },
  { label: "AI Observability", icon: Brain,           to: "/admin/ai-observability" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

interface NavItem { label: string; icon: React.ElementType; to: string }

function NavGroup({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  return (
    <>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onClose}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm transition-all ${
              isActive
                ? "bg-green-500/15 text-green-400 border border-green-500/20"
                : "text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-green-400" : ""}`} />
              <span className="flex-1">{item.label}</span>
              {isActive && <div className="w-1.5 h-1.5 bg-green-400 rounded-full" />}
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}

// ─── Main Sidebar ───────────────────────────────────────────────────────────

export function Sidebar() {
  const { role, isPT, isAdmin, activeView, setActiveView, user, setSidebarOpen, logout } = useApp();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    setSidebarOpen(false);
    navigate("/login");
  };

  const switchToClientView = () => {
    setActiveView("client");
    setSidebarOpen(false);
    navigate("/client/dashboard");
  };

  const switchToPTView = () => {
    setActiveView("pt");
    setSidebarOpen(false);
    navigate("/pt/dashboard");
  };

  // Determine which nav items to show
  let navItems: NavItem[];
  if (isAdmin) {
    navItems = adminNav;
  } else if (isPT) {
    navItems = activeView === "pt" ? ptWorkspaceNav : ptClientNav;
  } else {
    navItems = clientNavFull;
  }

  // ── Workspace label + color for the header pill ──
  const workspaceConfig = isAdmin
    ? { label: "Admin Portal",   color: "bg-violet-600",  textColor: "text-violet-400",  pillBg: "bg-violet-500/10",  pillBorder: "border-violet-500/20",  icon: Shield }
    : isPT
      ? activeView === "pt"
        ? { label: "Trainer Workspace", color: "bg-green-500",   textColor: "text-green-400",   pillBg: "bg-green-500/10",   pillBorder: "border-green-500/20",   icon: Zap   }
        : { label: "Client Workspace",  color: "bg-zinc-700",    textColor: "text-zinc-300",    pillBg: "bg-zinc-800",       pillBorder: "border-zinc-700/50",    icon: User  }
      : { label: "Client Portal",    color: "bg-green-500",   textColor: "text-green-400",   pillBg: "bg-green-500/10",   pillBorder: "border-green-500/20",   icon: User  };

  const WorkspaceIcon = workspaceConfig.icon;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white border-r border-zinc-800/60">

      {/* ── Brand header ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-green-500/30">
            <Dumbbell className="w-4 h-4 text-black" />
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-tight tracking-tight">FITNESS AI</div>
            <div className="text-zinc-500 text-xs">AI Gym Coach</div>
          </div>
        </div>
        <button
          className="lg:hidden text-zinc-500 hover:text-white p-1 rounded transition-colors"
          onClick={() => setSidebarOpen(false)}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* ── PT Workspace switcher (sidebar version) ── */}
      {isPT && (
        <div className="px-3 py-3 border-b border-zinc-800/60">
          {/* Account badge */}
          <div className="flex items-center gap-1.5 mb-2.5 px-1">
            <div className="w-4 h-4 bg-green-500/20 rounded flex items-center justify-center">
              <Zap className="w-2.5 h-2.5 text-green-400" />
            </div>
            <span className="text-xs text-zinc-500 font-semibold tracking-wide uppercase">PT Account</span>
          </div>

          {/* Segmented toggle */}
          <div className="flex bg-zinc-900 border border-zinc-800 rounded-xl p-1 gap-1">
            <button
              onClick={switchToClientView}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === "client"
                  ? "bg-zinc-700 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <User className="w-3 h-3" />
              Client
            </button>
            <button
              onClick={switchToPTView}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === "pt"
                  ? "bg-green-500 text-black shadow-sm shadow-green-500/30"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Zap className="w-3 h-3" />
              Trainer
            </button>
          </div>
        </div>
      )}

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {/* Section label */}
        {isPT && (
          <div className="px-3 mb-2">
            <span className="text-xs font-bold text-zinc-600 uppercase tracking-widest">
              {activeView === "pt" ? "Coaching Tools" : "My Fitness"}
            </span>
          </div>
        )}
        <NavGroup items={navItems} onClose={() => setSidebarOpen(false)} />
      </nav>

      {/* ── Bottom: user info + logout ── */}
      <div className="p-3 border-t border-zinc-800/60">
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-zinc-900 rounded-xl border border-zinc-800/60 mb-2">
          <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-xs font-bold text-black flex-shrink-0 shadow-md shadow-green-500/20">
            {user?.firstName?.[0] || user?.email?.[0]?.toUpperCase() || "U"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-zinc-100 font-semibold truncate">
              {user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email.split('@')[0] : "Client"}
            </div>
            <div className="text-xs text-zinc-500 truncate">
              {role === "client" ? "Member" : role === "pt" ? "Personal Trainer" : "Administrator"}
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-3 py-2 text-zinc-500 hover:text-red-400 hover:bg-zinc-800/60 rounded-lg text-sm transition-all"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </div>
  );
}
