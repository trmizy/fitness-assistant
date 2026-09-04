import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { App as CapacitorApp } from "@capacitor/app";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { ROLE_HOME } from "../config/landing";
import { dismissTopOverlay } from "./useBackDismissible";

/**
 * Android hardware Back, in priority order:
 *
 *   1. An overlay is open (dialog / sheet)     -> close it
 *   2. The mobile sidebar is open              -> close it
 *   3. Already on the role's home              -> first press warns, second within 2s exits
 *   4. There is history to go back to          -> navigate(-1)
 *   5. No history, not on home                 -> go to the role's home
 *
 * Note on step 3 coming before step 4: the spec listed `canGoBack` first, but that
 * contradicted its own acceptance criterion ("on the home screen, the first Back shows the
 * warning"). Once a user has navigated around and come back to the home screen, history is
 * NOT empty, so a canGoBack-first order would walk them backwards through old screens
 * instead of offering to exit. Reaching home is the signal that they are done — which is
 * how Android apps generally behave. Confirmed with the user before changing the order.
 *
 * What it replaces, and why each part matters:
 *
 * - The old handler destructured `canGoBack` and then ignored it, always calling
 *   `navigate(-1)`. On a freshly-restored process the history stack is empty, so `-1` has
 *   nowhere to go and the WebView quits the app — Back appeared to randomly close the app.
 * - It only knew two home screens (`/client/dashboard`, `/pt/dashboard`). Gym owners and
 *   admins had no home at all, so Back wandered or exited from their pages.
 * - It never considered overlays, so Back closed the whole screen out from under an open
 *   dialog instead of closing the dialog.
 *
 * Exit is only ever possible FROM a home screen, and only on a deliberate double press.
 */

const EXIT_CONFIRM_WINDOW_MS = 2000;

export function useNativeBackNavigation(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const { role, sidebarOpen, setSidebarOpen } = useApp();

  // Refs, not deps: the listener is registered once and always reads current values.
  // Re-registering on every navigation used to be a source of duplicate handlers.
  const stateRef = useRef({ pathname: location.pathname, role, sidebarOpen });
  stateRef.current = { pathname: location.pathname, role, sidebarOpen };

  const exitArmedAtRef = useRef(0);

  useEffect(() => {
    const listener = CapacitorApp.addListener("backButton", ({ canGoBack }) => {
      const { pathname, role: currentRole, sidebarOpen: isSidebarOpen } = stateRef.current;
      const home = ROLE_HOME[currentRole];

      // 1. Overlays first — Back should dismiss what is on top, not navigate behind it.
      if (dismissTopOverlay()) return;

      // 2. The mobile sidebar is an overlay too; it already has state in AppContext.
      if (isSidebarOpen) {
        setSidebarOpen(false);
        return;
      }

      // 3. Already home: Back means "I'm done" — confirm, then exit. Deliberately ahead of
      //    the history check; see the note in this file's header.
      if (pathname === home) {
        const now = Date.now();
        if (now - exitArmedAtRef.current < EXIT_CONFIRM_WINDOW_MS) {
          void CapacitorApp.exitApp();
          return;
        }
        exitArmedAtRef.current = now;
        toast("Nhấn lần nữa để thoát", { duration: EXIT_CONFIRM_WINDOW_MS });
        return;
      }

      // Any press that is not the second half of an exit confirmation cancels the pending
      // one, so a stale "armed" state can't leak into a later, unrelated press.
      exitArmedAtRef.current = 0;

      // 4. Normal case: step back through history.
      //    `canGoBack` comes from the WebView itself and is the only reliable signal that
      //    `navigate(-1)` has anywhere to go.
      if (canGoBack) {
        navigate(-1);
        return;
      }

      // 5. Nothing to go back to, and not home (deep link, restored process, a `replace`
      //    navigation): go home rather than dropping out of the app.
      navigate(home, { replace: true });
    });

    return () => {
      void listener.then((l) => l.remove());
    };
    // Registered once for the lifetime of the shell — see stateRef above.
  }, [navigate, setSidebarOpen]);
}
