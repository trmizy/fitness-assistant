import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useLocation } from "react-router";
import { useApp } from "../../context/AppContext";
import { GyminiMonkeyMark } from "../icons/gymini/mascot";
import { AI_FAB_LIFT_VAR, isAiCoachFabHiddenOn } from "./aiCoachFab";

/**
 * Global, always-visible entry point to AI Coach — replaces the old "AI
 * Coach" tab inside the Chat page (see AICoachFloatingPanel, ChatCoachPage
 * removal). Rendered once in AppShell, same placement pattern as
 * CallOverlay, so it persists across every client route instead of only
 * existing on /client/chat.
 */
// Batch 3 — the button used to pulse its scale and box-shadow forever (repeat: Infinity): a
// repaint on every frame of every page, motion that never stops (WCAG 2.2.2), and no reduced-
// motion branch. It now plays ONE short ring intro per app session, then rests. The resting
// look (green hairline, green shadow, mascot) is unchanged, so the button reads the same.
let introPlayedThisSession = false;

export function AICoachFloatingButton() {
  const { isAuthenticated, role, isAiCoachOpen, openAiCoach } = useApp();
  const { pathname } = useLocation();
  const reduceMotion = useReducedMotion();

  // AI Coach is a client-side feature only (AICoachPage lives under
  // /client/...). AppShell is shared by client, pt, gym_owner AND admin
  // (see routes.tsx's 4 separate RequireRole blocks) — a plain `isPT`
  // check does nothing for gym_owner/admin (isPT is false for both), so
  // it would have wrongly shown this to roles that have no client
  // workspace at all. Show only for an actual client, or a PT currently
  // viewing their own client-style workspace.
  // A PT also gets it in their own workspace: the PT Copilot (roster overview, drafted client proposals) is the same chat.
  const inClientContext = role === "client" || role === "pt";
  if (!isAuthenticated || !inClientContext || isAiCoachOpen) return null;
  // Not on the chat screens (it covered "Gửi" and the "Thử lại" link) nor on AI Coach's own page.
  if (isAiCoachFabHiddenOn(pathname)) return null;

  return <AICoachFab onOpen={openAiCoach} reduceMotion={!!reduceMotion} />;
}

function AICoachFab({ onOpen, reduceMotion }: { onOpen: () => void; reduceMotion: boolean }) {
  // Decided once per mount (StrictMode-safe: the flag is set after commit, not during render).
  const [playIntro, setPlayIntro] = useState(() => !reduceMotion && !introPlayedThisSession);
  useEffect(() => { introPlayedThisSession = true; }, []);
  const openAiCoach = onOpen;

  return (
    <motion.button
      type="button"
      onClick={openAiCoach}
      aria-label="Mở AI Coach"
      data-testid="ai-coach-fab"
      initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      whileHover={reduceMotion ? undefined : { scale: 1.06 }}
      whileTap={reduceMotion ? undefined : { scale: 0.94 }}
      // bottom rises with a page's sticky bottom bar (--ai-fab-lift, set by StickyActionBar) so it never sits on its buttons.
      style={{ bottom: `calc(1.25rem + var(${AI_FAB_LIFT_VAR}, 0px))` }}
      className="fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-green-500/30 bg-zinc-900/90 text-green-400 shadow-lg shadow-green-500/20 backdrop-blur-md"
    >
      {playIntro && (
        // One attention ring, twice, ~2.6 s total; transform + opacity only, then removed from the tree.
        <motion.span
          aria-hidden
          data-testid="ai-coach-fab-intro"
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-green-400"
          initial={{ scale: 1, opacity: 0.55 }}
          animate={{ scale: 1.45, opacity: 0 }}
          transition={{ duration: 1.2, ease: "easeOut", repeat: 1, repeatDelay: 0.2, delay: 0.3 }}
          onAnimationComplete={() => setPlayIntro(false)}
        />
      )}
      <GyminiMonkeyMark size={28} />
    </motion.button>
  );
}
