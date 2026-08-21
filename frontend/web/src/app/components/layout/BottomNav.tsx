import { NavLink, useLocation } from "react-router";
import { motion } from "motion/react";
import { LayoutDashboard, Dumbbell, Utensils, MessageSquare, User, Users, Calendar, ClipboardList } from "lucide-react";
import { useApp } from "../../context/AppContext";

export function BottomNav() {
  const { role, isPT, isAdmin, activeView } = useApp();
  const location = useLocation();

  if (isAdmin || role === "gym_owner" || role === "gym_staff") {
    return null; // Don't show bottom nav for admin or gym owner yet
  }

  // Determine which nav items to show based on the active view
  const navItems =
    isPT && activeView === "pt"
      ? [
          { label: "Dash", icon: LayoutDashboard, to: "/pt/dashboard" },
          { label: "Khách", icon: Users, to: "/pt/clients" },
          { label: "Duyệt", icon: ClipboardList, to: "/pt/plans" },
          { label: "Chat", icon: MessageSquare, to: "/pt/chat" },
          { label: "Hồ sơ", icon: User, to: "/pt/profile" },
        ]
      : [
          { label: "Dash", icon: LayoutDashboard, to: "/client/dashboard" },
          { label: "Tập", icon: Dumbbell, to: "/client/workout" },
          { label: "Ăn", icon: Utensils, to: "/client/nutrition" },
          { label: "Chat", icon: MessageSquare, to: "/client/chat" },
          { label: "Hồ sơ", icon: User, to: "/client/profile" },
        ];

  return (
    <>


      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-zinc-950/90 backdrop-blur-md border-t border-zinc-800/60 pb-safe">
        <div className="flex justify-around items-center h-16 px-2 relative">
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className="relative flex flex-col items-center justify-center w-16 h-full z-10"
              >
                {isActive && (
                  <motion.div
                    layoutId="liquid-bubble"
                    className="absolute w-12 h-12 bg-green-500/20 rounded-full"
                    transition={{
                      type: "spring",
                      stiffness: 500,
                      damping: 30,
                      mass: 0.5,
                    }}
                  />
                )}
                <item.icon
                  className={`w-6 h-6 mb-1 transition-colors duration-300 z-10 ${
                    isActive ? "text-green-400" : "text-zinc-400"
                  }`}
                />
                <span
                  className={`text-[10px] font-medium transition-colors duration-300 z-10 ${
                    isActive ? "text-green-400" : "text-zinc-400"
                  }`}
                >
                  {item.label}
                </span>
              </NavLink>
            );
          })}
        </div>
      </div>
    </>
  );
}
