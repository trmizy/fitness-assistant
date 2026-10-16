import type { ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect, usePathname } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { useApp } from "../../context/AppContext";
import { profileService } from "../../services/api";
import { ONBOARDING_PATH } from "../../config/landing";
import { useWorkspaceAccent } from "../../theme/workspace";

/**
 * Sends a client who has not finished the onboarding wizard into it. Ported from web's
 * RequireOnboarding, including both of its deliberate escape hatches:
 *
 *  - **Only the client role is gated.** PT/gym-owner/admin workspaces have their own separate
 *    profile concerns and are not touched here.
 *  - **A FAILED profile fetch is not evidence that onboarding is incomplete.** Web hit this under
 *    gateway rate limiting: the backend profile was already complete, but one transient failure
 *    threw the user back into the wizard. Onboarding is a UX gate, not an authorization boundary,
 *    so it fails OPEN and lets the screen's own API calls surface any real error.
 *
 * The onboarding route itself is exempt, or the redirect would loop.
 *
 * Failing open has to STICK. React Query puts a data-less query back to "pending" every time it
 * refetches, so gating on `isLoading` alone took the whole workspace down again on each retry
 * cycle: with the saved server unreachable the app showed a blank screen for ~45 s, the dashboard
 * for an instant (whose own mount refetched the profile), then blank again — forever, with no way
 * to reach Settings or log out (real phone, 6/10). Once the fetch has failed even once
 * (`errorUpdateCount`), the screens stay up while later attempts run behind them. The gate itself
 * tries once (no retries): it only delays a first paint, and a transient miss is exactly the case
 * that is meant to fail open.
 */
export function RequireOnboarding({ children }: { children: ReactNode }) {
  const { role, isAuthenticated, user } = useApp();
  const pathname = usePathname();

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => profileService.getProfile().then((res: any) => res.profile),
    enabled: isAuthenticated && role === "client" && !!user?.id,
    staleTime: 60_000,
    retry: false,
  });
  const accent = useWorkspaceAccent();

  if (!isAuthenticated || role !== "client") return <>{children}</>;
  if (pathname.startsWith(ONBOARDING_PATH)) return <>{children}</>;

  // "Failed before and still has nothing" — once a profile does arrive, the normal check below
  // takes over again.
  const failedWithNothing = profileQuery.errorUpdateCount > 0 && profileQuery.data === undefined;
  if (profileQuery.isError || failedWithNothing) return <>{children}</>;
  // Hold the screens back while the very first profile fetch is in flight — otherwise the user
  // sees a flash of dashboard content or of the redirect itself. A spinner, not a blank: on a slow
  // link this can last several seconds, and a blank screen reads as a hung app.
  if (profileQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={accent.primary} />
      </View>
    );
  }

  const profile = profileQuery.data;
  const needsOnboarding = !profile || profile.hasCompletedOnboarding !== true;
  if (needsOnboarding) return <Redirect href={ONBOARDING_PATH} />;

  return <>{children}</>;
}
