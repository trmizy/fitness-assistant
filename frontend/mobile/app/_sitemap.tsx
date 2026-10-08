import { Redirect } from "expo-router";

/**
 * Replaces expo-router's built-in developer sitemap (reachable at `/_sitemap` in any build).
 * It lists every route of the app and crashed the release build when opened (real phone, 7/10);
 * users have no use for it.
 */
export default function Sitemap() {
  return <Redirect href="/" />;
}
