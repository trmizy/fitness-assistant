/**
 * Android App Links for the gym share link (`https://gymini.vn/gyms/<id>`, see gymHours.publicGymUrl).
 *
 * The link is the same one web serves; with the verified intent filter (app.json -> android.intentFilters,
 * mirrored in AndroidManifest.xml) an installed app receives it directly instead of the browser. This file
 * is the pure half: which incoming URLs are gym links, and which app route they open.
 *
 * Hosts must stay in step with the intent filter — a URL on any other host is never rewritten here.
 */
export const GYM_LINK_HOSTS = ["gymini.vn", "www.gymini.vn"] as const;

/** Gym ids are server-issued (uuid / cuid): letters, digits, `-` and `_` only. Anything else is not ours. */
const GYM_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The gym id inside an incoming gym link, or null for everything else.
 *
 * Accepts the absolute https link (what Android hands the app for an App Link) and the bare
 * `/gyms/<id>` path (some expo-router versions strip the origin). Query and hash are ignored.
 */
export function gymIdFromAppLink(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const input = url.trim();
  if (!input) return null;
  let path = input;
  const absolute = /^https:\/\/([^/?#:]+)(?::443)?(\/[^?#]*)?/i.exec(input);
  if (absolute) {
    if (!(GYM_LINK_HOSTS as readonly string[]).includes(absolute[1].toLowerCase())) return null;
    path = absolute[2] ?? "";
  } else if (!input.startsWith("/") || input.startsWith("//")) {
    return null;
  }
  const m = /^\/gyms\/([^/?#]+)\/?$/.exec(path);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return GYM_ID.test(id) ? id : null;
}

/** The client gym-detail screen for a gym link (its stack's hub, `index`, sits under it via initialRouteName). */
export function gymAppLinkRoute(url: string | null | undefined): string | null {
  const id = gymIdFromAppLink(url);
  return id ? `/client/services/gyms/${encodeURIComponent(id)}` : null;
}
