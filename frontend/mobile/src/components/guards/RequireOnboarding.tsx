import type { ReactNode } from "react";
import { Redirect, usePathname } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { useApp } from "../../context/AppContext";
import { profileService } from "../../services/api";
import { ONBOARDING_PATH } from "../../config/landing";

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
 */
export function RequireOnboarding({ children }: { children: ReactNode }) {
  const { role, isAuthenticated, user } = useApp();
  const pathname = usePathname();

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => profileService.getProfile().then((res: any) => res.profile),
    enabled: isAuthenticated && role === "client" && !!user?.id,
    staleTime: 60_000,
  });

  if (!isAuthenticated || role !== "client") return <>{children}</>;
  if (pathname.startsWith(ONBOARDING_PATH)) return <>{children}</>;

  // Render nothing rather than guess while the very first profile fetch is in flight — otherwise
  // the user sees a flash of dashboard content or of the redirect itself.
  if (profileQuery.isLoading) return null;
  if (profileQuery.isError) return <>{children}</>;

  const profile = profileQuery.data;
  const needsOnboarding = !profile || profile.hasCompletedOnboarding !== true;
  if (needsOnboarding) return <Redirect href={ONBOARDING_PATH} />;

  return <>{children}</>;
}
