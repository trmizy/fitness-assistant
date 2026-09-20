import { useEffect, useState } from "react";
import { Redirect } from "expo-router";

import { useApp } from "../src/context/AppContext";
import { ROLE_HOME } from "../src/config/landing";
import { Preferences } from "../src/services/storage";
import { INTRO_SEEN_KEY } from "./welcome";

/**
 * Root redirect. Nothing renders at "/" — it exists only to send whoever arrives to the right
 * place. A signed-in user is decided synchronously: AppProvider has already finished restoring the
 * session before anything below it mounts (see src/services/session.ts), so `isAuthenticated` here
 * is a settled answer, never a loading one.
 *
 * A signed-out one costs one storage read, to know whether the SH-02 intro has been seen on this
 * install. The read is deliberately not made for signed-in users: they never see the intro, and the
 * cold start to the dashboard is already the slowest path in the app (PERFORMANCE_BASELINE.md).
 *
 * This replaced the Phase 2 debug screen.
 */
export default function RootRedirect() {
  const { isAuthenticated, role } = useApp();
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);

  useEffect(() => {
    if (isAuthenticated) return;
    let active = true;
    void Preferences.get({ key: INTRO_SEEN_KEY }).then(({ value }) => {
      // A failed read returns null, which shows the intro — the harmless direction to be wrong in.
      if (active) setIntroSeen(value === "1");
    });
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  if (isAuthenticated) return <Redirect href={ROLE_HOME[role]} />;
  // One frame of the app's own background while the flag is read, rather than a login form that may
  // be replaced a moment later by the intro.
  if (introSeen === null) return null;
  return <Redirect href={introSeen ? "/login" : "/welcome"} />;
}
