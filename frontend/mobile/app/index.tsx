import { Redirect } from "expo-router";

import { useApp } from "../src/context/AppContext";
import { ROLE_HOME } from "../src/config/landing";

/**
 * Root redirect. Nothing renders at "/" — it exists only to send whoever arrives to the right
 * place, which is why it can decide synchronously: AppProvider has already finished restoring the
 * session before anything below it mounts (see src/services/session.ts), so `isAuthenticated` here
 * is a settled answer, never a loading one.
 *
 * This replaced the Phase 2 debug screen.
 */
export default function RootRedirect() {
  const { isAuthenticated, role } = useApp();

  return <Redirect href={isAuthenticated ? ROLE_HOME[role] : "/login"} />;
}
