import { lazy, Suspense, useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { CircleNotchIcon as Loader2, XIcon as X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useApp } from "../../context/AppContext";

// Lazy, same as every route in routes.tsx — AICoachFloatingPanel is
// mounted unconditionally in AppShell (so it's ready on every page), but
// AICoachPage itself (782 lines, chat history, image upload) must not be
// eagerly bundled into every user's initial load just because the panel
// exists. Confirmed via a real build: without this, the main chunk grew
// ~96KB for every visitor, whether or not they ever open AI Coach.
const AICoachPage = lazy(() => import("../../pages/client/AICoachPage").then((m) => ({ default: m.AICoachPage })));

/**
 * The in-place panel AICoachFloatingButton opens. Desktop: a fixed corner
 * card. Mobile: a full-screen sheet, since AICoachPage's session-list +
 * chat two-pane layout genuinely needs real space on a small screen — a
 * small popover would be unusable there. Delegates 100% of the chat/
 * session logic to the existing AICoachPage (see its new `onClose` prop);
 * this component owns only sizing/positioning/animation.
 */
export function AICoachFloatingPanel() {
  const { isAiCoachOpen, closeAiCoach, user } = useApp();
  const location = useLocation();
  const lastRoute = useRef(`${location.pathname}${location.search}`);

  // Below 1024px this panel is a FULL-SCREEN sheet (fixed inset-0). A link inside a chat card (e.g. "Xem hồ sơ & đặt lịch" -> /client/services?ptId=)
  // changes the page behind it, so the user saw nothing happen until a reload reset the panel. Close the sheet when the route changes.
  // On desktop it is a corner card that does not cover the page, so it stays open.
  useEffect(() => {
    const route = `${location.pathname}${location.search}`;
    if (route === lastRoute.current) return;
    lastRoute.current = route;
    if (isAiCoachOpen && window.matchMedia("(max-width: 1023px)").matches) closeAiCoach();
  }, [location.pathname, location.search, isAiCoachOpen, closeAiCoach]);

  return (
    <AnimatePresence>
      {isAiCoachOpen && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          className="fixed inset-0 z-40 overflow-hidden bg-zinc-950 shadow-2xl lg:inset-auto lg:bottom-5 lg:right-5 lg:h-[min(640px,80vh)] lg:w-[400px] lg:rounded-2xl lg:border lg:border-zinc-800/60"
        >
          <Suspense
            fallback={
              <div className="relative flex h-full w-full items-center justify-center bg-zinc-950">
                <button
                  type="button"
                  onClick={closeAiCoach}
                  aria-label="Đóng AI Coach"
                  data-testid="ai-coach-close"
                  className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:text-zinc-200"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
                <Loader2 className="h-6 w-6 animate-spin text-green-500" />
              </div>
            }
          >
            {/* Keyed by identity: all of the page's local state (list/chat view, draft thread, typed text, staged image) is per user. */}
            <AICoachPage key={user?.id ?? "guest"} onClose={closeAiCoach} compact />
          </Suspense>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
