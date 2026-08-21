import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../context/AppContext";
import { profileService } from "../services/api";

const ONBOARDING_PATH = "/client/onboarding";

/**
 * Route-level guard for the client workspace, same shape as RequireRole:
 * redirects to the onboarding wizard when a client's profile hasn't
 * completed it yet. Only applies to the "client" role — PT/gym-owner/admin
 * workspaces have their own separate profile concerns and are not gated
 * here. Exempts the onboarding route itself so the redirect can't loop.
 */
export function RequireOnboarding({ children }: { children: ReactNode }) {
  const { role, isAuthenticated, user } = useApp();
  const location = useLocation();

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => profileService.getProfile().then((r) => r.profile),
    enabled: isAuthenticated && role === "client" && !!user?.id,
    staleTime: 60_000,
  });

  if (!isAuthenticated || role !== "client") return <>{children}</>;
  if (location.pathname.startsWith(ONBOARDING_PATH)) return <>{children}</>;

  // Avoid a flash of the redirect (or of dashboard content) while the very
  // first profile fetch is in flight — render nothing rather than guess.
  if (profileQuery.isLoading) return null;

  const profile = profileQuery.data;
  const needsOnboarding = !profile || profile.hasCompletedOnboarding !== true;
  if (needsOnboarding) return <Navigate to={ONBOARDING_PATH} replace />;

  return <>{children}</>;
}
