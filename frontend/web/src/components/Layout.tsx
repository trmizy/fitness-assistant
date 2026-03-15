import React, { useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, User, Scale, Dumbbell, CalendarDays,
  Bot, LogOut, Menu, X, Activity,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { path: '/',         label: 'Dashboard', icon: LayoutDashboard },
  { path: '/profile',  label: 'Profile',   icon: User },
  { path: '/inbody',   label: 'InBody',    icon: Scale },
  { path: '/workouts', label: 'Workouts',  icon: Dumbbell },
  { path: '/plans',    label: 'Plans',     icon: CalendarDays },
  { path: '/coach',    label: 'AI Coach',  icon: Bot },
];

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  '/':         { title: 'Dashboard',  subtitle: 'Your fitness overview' },
  '/profile':  { title: 'Profile',    subtitle: 'Personal details & goals' },
  '/inbody':   { title: 'Body Stats', subtitle: 'InBody measurements & trends' },
  '/workouts': { title: 'Workouts',   subtitle: 'Training logs & history' },
  '/plans':    { title: 'Plans',      subtitle: 'Workout & meal planning' },
  '/coach':    { title: 'AI Coach',   subtitle: 'Your personal fitness AI' },
};

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const currentPage = pageTitles[location.pathname] ?? { title: 'AI Gym Coach', subtitle: '' };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : 'AG';

  const displayName = user ? `${user.firstName} ${user.lastName}` : 'Demo User';

  return (
    <div className="flex h-full bg-zinc-950">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ───────────────────────────────────────────── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-30 flex flex-col w-64 bg-zinc-900 border-r border-zinc-800
          transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:flex
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
            <Activity size={16} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-none">AI Gym Coach</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">Fitness Assistant</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto text-zinc-500 hover:text-zinc-300 lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                 ${isActive
                   ? 'bg-emerald-600/10 text-emerald-400 border border-emerald-600/20'
                   : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 border border-transparent'
                 }`
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User pill + logout */}
        <div className="px-3 py-4 border-t border-zinc-800 space-y-1">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-800/50">
            <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-zinc-200 truncate">{displayName}</p>
              <p className="text-[10px] text-zinc-500 truncate">{user?.email ?? ''}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-400 hover:text-red-400 hover:bg-red-400/5 transition-colors"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 lg:min-w-0">
        {/* Topbar */}
        <header className="flex items-center gap-4 px-6 py-4 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-zinc-400 hover:text-white lg:hidden"
          >
            <Menu size={20} />
          </button>
          <div>
            <h1 className="text-base font-semibold text-white leading-none">{currentPage.title}</h1>
            <p className="text-xs text-zinc-500 mt-0.5">{currentPage.subtitle}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 bg-zinc-800 rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
