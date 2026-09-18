import { motion } from "motion/react";
import { useApp } from "../../context/AppContext";
import { GyminiMonkeyMark } from "../icons/gymini/mascot";

/**
 * Global, always-visible entry point to AI Coach — replaces the old "AI
 * Coach" tab inside the Chat page (see AICoachFloatingPanel, ChatCoachPage
 * removal). Rendered once in AppShell, same placement pattern as
 * CallOverlay, so it persists across every client route instead of only
 * existing on /client/chat.
 */
export function AICoachFloatingButton() {
  const { isAuthenticated, role, activeView, isAiCoachOpen, openAiCoach } = useApp();

  // AI Coach is a client-side feature only (AICoachPage lives under
  // /client/...). AppShell is shared by client, pt, gym_owner AND admin
  // (see routes.tsx's 4 separate RequireRole blocks) — a plain `isPT`
  // check does nothing for gym_owner/admin (isPT is false for both), so
  // it would have wrongly shown this to roles that have no client
  // workspace at all. Show only for an actual client, or a PT currently
  // viewing their own client-style workspace.
  const inClientContext = role === "client" || (role === "pt" && activeView === "client");
  if (!isAuthenticated || !inClientContext || isAiCoachOpen) return null;

  return (
    <motion.button
      type="button"
      onClick={openAiCoach}
      aria-label="Mở AI Coach"
      initial={{ scale: 0, opacity: 0 }}
      animate={{
        scale: [1, 1.06, 1],
        opacity: 1,
        boxShadow: [
          "0 0 0 0 rgba(34,197,94,0.35)",
          "0 0 0 10px rgba(34,197,94,0)",
          "0 0 0 0 rgba(34,197,94,0)",
        ],
      }}
      transition={{
        scale: { duration: 2.4, repeat: Infinity, ease: "easeInOut" },
        boxShadow: { duration: 2.4, repeat: Infinity, ease: "easeOut" },
        opacity: { duration: 0.2 },
      }}
      whileHover={{ scale: 1.12 }}
      whileTap={{ scale: 0.94 }}
      className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-green-500/30 bg-zinc-900/90 text-green-400 shadow-lg shadow-green-500/20 backdrop-blur-md"
    >
      <GyminiMonkeyMark size={28} />
    </motion.button>
  );
}
