import { Navigate } from "react-router";
import { useApp } from "../context/AppContext";
import { ROLE_HOME } from "../config/landing";

/**
 * Decides where "/" goes, based on whether a session survived.
 *
 * This route used to be a hard `<Navigate to="/login" replace />`. On the web that is
 * mostly invisible — people open a real URL, or the browser restores the last one. In the
 * Capacitor app it is the whole ballgame: the WebView ALWAYS boots at "/", so every single
 * launch was pushed to the login screen no matter how healthy the stored session was. And
 * because LoginPage only navigates away after a successful manual submit, a user with a
 * perfectly valid session simply sat there and had to type their password again — which is
 * exactly the "it logs me out every time I close the app" report.
 *
 * Safe to read `isAuthenticated` synchronously here: session restore resolves before the
 * router renders anything (AppProvider holds the splash until then), so this is a settled
 * answer rather than a still-loading one.
 */
export function RootRedirect() {
  const { isAuthenticated, role } = useApp();
  return <Navigate to={isAuthenticated ? ROLE_HOME[role] : "/login"} replace />;
}
