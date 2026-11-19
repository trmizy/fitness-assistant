import Constants from "expo-constants";

import { clientIdentityHeaders } from "./listingFlow";

/**
 * `X-Gymini-Client: mobile/<expo version>/<build>` — attached to every gateway request (axios `api`, the refresh client,
 * the AI stream and authenticated downloads). The value is public app metadata, never user data. The pure builder lives
 * in `listingFlow.ts` so it can be unit-tested without Expo.
 */
export function currentClientHeaders(): Record<string, string> {
  return clientIdentityHeaders({
    version: Constants.expoConfig?.version,
    build: Constants.nativeBuildVersion,
  });
}
