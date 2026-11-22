/**
 * GymOwnerScopeProvider - the one scope value for the Gym Owner workspace (05 sections 5-7).
 * Sources: GET /owner/onboarding/status (role, via useStaffRole), GET /owner/brands (only for roles with brand.view),
 * GET /owner/gyms (already filtered to the caller's scope by gym-service). Query keys are the existing ones so the legacy
 * pages and this provider share one cache entry per resource; later batches move pages to goKey().
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { gymService } from "../../../services/api";
import { useApp } from "../../../context/AppContext";
import { useStaffRole } from "../../../hooks/useStaffRole";
import { canViewBrands, type PartnerRole } from "../../../utils/gymStaffRole";
import { scopeKindForLocation } from "../../../components/layout/gym-owner/gymOwnerNav";
import { readCssMs } from "../../../components/layout/gym-owner/motion";
import {
  ALL_BRANCHES,
  canOfferAllBranches,
  classifyApiError,
  detailGymIdFromPath,
  makeScopeKey,
  pickableGyms,
  readLastGymId,
  resolveScope,
  writeLastGymId,
  type ScopeGym,
  type ScopeKind,
} from "./scopeModel";

export interface GymOwnerScopeValue {
  status: "loading" | "ready" | "error";
  userId: string;
  role: PartnerRole | undefined;
  brandId: string | null;
  brandName: string | null;
  /** Branches in scope (DRAFT rows removed). */
  gyms: ScopeGym[];
  /** Branch id, or "ALL" (all branches in scope / brand-wide). */
  gymId: string;
  scopeKey: string;
  /**
   * What the page area is keyed by (remount + "scope changed" detection). Equal to `scopeKey`, except on Hội viên & gói where the
   * Hội viên tab (branch) and the Gói tab (brand) share one key per branch, so switching tab animates the tab pill instead of
   * remounting the page behind a skeleton. Data guards keep using `scopeKey`.
   */
  pageKey: string;
  scopeKind: ScopeKind;
  /** ok | out-of-scope (gymId in the URL is not yours; never switched silently) | no-branch. */
  resolution: "ok" | "out-of-scope" | "no-branch";
  requestedGymId: string | null;
  canOfferAll: boolean;
  /** True from a scope change until the content has been re-revealed: write buttons must be disabled meanwhile. */
  scopeChanging: boolean;
  /** A PARTNER_SUSPENDED answer was observed from gym-service. */
  suspended: boolean;
  /** Last fetch of the branch list failed while an older copy is shown. */
  stale: { since: number } | null;
  error: unknown;
  setGymId: (gymId: string) => void;
  retry: () => void;
  /** Subscribe to scope changes (drawers/forms close on them). Returns the unsubscribe function. */
  onScopeChange: (cb: (scopeKey: string) => void) => () => void;
}

const Ctx = createContext<GymOwnerScopeValue | null>(null);

export function useGymOwnerScope(): GymOwnerScopeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useGymOwnerScope must be used inside GymOwnerScopeProvider.");
  return v;
}

/** Hook for batches that render drawers: runs `cb` whenever the scope changes. */
export function useScopeChangeEffect(cb: (scopeKey: string) => void) {
  const { onScopeChange } = useGymOwnerScope();
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => onScopeChange((k) => ref.current(k)), [onScopeChange]);
}

export function GymOwnerScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useApp();
  const userId = (user as { id?: string } | null)?.id ?? "anonymous";
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const staff = useStaffRole();
  const role = staff.role;

  const gymsQuery = useQuery<ScopeGym[]>({
    queryKey: ["owned-gyms"],
    queryFn: () => gymService.listOwnedGyms(),
    enabled: !!role,
  });
  // RECEPTIONIST has no brand.view: calling it would only produce a silent 403.
  const brandsQuery = useQuery<{ id: string; name: string; approvedName?: string | null }[]>({
    queryKey: ["owned-brands"],
    queryFn: () => gymService.listOwnedBrands(),
    enabled: canViewBrands(role),
  });

  const allGyms = gymsQuery.data ?? [];
  const gyms = useMemo(() => pickableGyms(allGyms), [allGyms]);
  const brand = brandsQuery.data?.[0];
  const brandId = brand?.id ?? gyms.find((g) => g.brandId)?.brandId ?? null;
  const brandName = brand ? (brand.approvedName ?? brand.name) : null;

  const navigate = useNavigate();

  // Branch detail (/gym-owner/gyms/:id, G2): the branch is the one in the PATH, so the strip follows it. A DRAFT row is not a
  // pickable branch (it lives in the wizard), so its detail page keeps the old "no branch strip" behaviour instead of a false
  // out-of-scope frame. An id that is not in the (scope-filtered) list stays a branch screen and becomes out-of-scope (05 section 5).
  const detailId = detailGymIdFromPath(pathname);
  const detailGym = detailId ? allGyms.find((g) => g.id === detailId) : undefined;
  const detailKind: ScopeKind | null = detailId && detailGym?.status !== "DRAFT" ? "branch" : null;
  // G3: Hội viên & gói is branch-wide on the Hội viên tab and brand-wide on the Gói tab, so the kind also reads `?tab=`.
  const scopeKind: ScopeKind = detailKind ?? scopeKindForLocation(pathname, params.get("tab"), role);
  const requestedGymId = detailKind ? detailId : params.get("gymId");

  const status: GymOwnerScopeValue["status"] =
    staff.isLoading || (!!role && gymsQuery.isLoading) || (canViewBrands(role) && brandsQuery.isLoading)
      ? "loading"
      : staff.isError || !role || (gymsQuery.isError && !gymsQuery.data)
        ? "error"
        : "ready";

  const resolution = useMemo(
    () => resolveScope({ kind: scopeKind, gyms, requestedGymId, lastGymId: readLastGymId(userId) }),
    [scopeKind, gyms, requestedGymId, userId],
  );
  const gymId = resolution.kind === "ok" ? resolution.gymId : ALL_BRANCHES;
  const scopeKey = makeScopeKey({ userId, role, brandId, gymId });
  const onMembersPage = pathname.replace(/\/$/, "") === "/gym-owner/members";
  const pageKey =
    onMembersPage && requestedGymId && gyms.some((g) => g.id === requestedGymId) ? makeScopeKey({ userId, role, brandId, gymId: requestedGymId }) : scopeKey;

  // Canonical URL: branch-required screens always carry ?gymId= (05 section 5). Only written once everything is known.
  const writeUrl = status === "ready" && resolution.kind === "ok" ? resolution.writeUrl : null;
  useEffect(() => {
    if (writeUrl && requestedGymId !== writeUrl) {
      const next = new URLSearchParams(params);
      next.set("gymId", writeUrl);
      setParams(next, { replace: true });
    }
  }, [writeUrl, requestedGymId, params, setParams]);
  useEffect(() => {
    if (status === "ready" && resolution.kind === "ok" && gymId !== ALL_BRANCHES) writeLastGymId(userId, gymId);
  }, [status, resolution.kind, gymId, userId]);

  const setGymId = useCallback(
    (next: string) => {
      if (detailKind && next !== ALL_BRANCHES) {
        // Same tab of the other branch; `settings` is a one-shot shortcut and is not carried over.
        const tab = params.get("tab");
        navigate(`/gym-owner/gyms/${encodeURIComponent(next)}${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`);
        return;
      }
      const sp = new URLSearchParams(params);
      if (next === ALL_BRANCHES) sp.delete("gymId");
      else sp.set("gymId", next);
      setParams(sp);
    },
    [params, setParams, detailKind, navigate],
  );

  // Scope change = the key changed on the SAME path (a navigation to another page is not a scope change).
  const [scopeChanging, setScopeChanging] = useState(false);
  const listeners = useRef(new Set<(k: string) => void>());
  const prev = useRef<{ key: string; path: string } | null>(null);
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (status !== "ready") {
      prev.current = null;
      return;
    }
    const before = prev.current;
    prev.current = { key: pageKey, path: pathname };
    if (!before || before.path !== pathname || before.key === pageKey) return;
    listeners.current.forEach((cb) => cb(scopeKey));
    setScopeChanging(true);
    if (changeTimer.current) clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(() => setScopeChanging(false), readCssMs("--reveal-dur", 250) + readCssMs("--duration-stagger", 40));
  }, [scopeKey, pageKey, pathname, status]);
  useEffect(
    () => () => {
      if (changeTimer.current) clearTimeout(changeTimer.current);
    },
    [],
  );

  const onScopeChange = useCallback((cb: (k: string) => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);

  // PARTNER_SUSPENDED can come back from any gym-service request: watch the cache instead of every page.
  const [suspendedSeen, setSuspendedSeen] = useState(false);
  useEffect(() => {
    setSuspendedSeen(false);
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      if (event.action.type === "error" && classifyApiError(event.action.error) === "suspended") setSuspendedSeen(true);
      if (event.action.type === "success" && event.query.queryKey[0] === "partner-onboarding-status") setSuspendedSeen(false);
    });
  }, [queryClient, userId]);
  const suspended = suspendedSeen || classifyApiError(staff.error) === "suspended";

  const error = staff.error ?? gymsQuery.error ?? null;
  const retry = useCallback(() => {
    void staff.refetch();
    void gymsQuery.refetch();
    void brandsQuery.refetch();
  }, [staff, gymsQuery, brandsQuery]);

  const stale = gymsQuery.isError && gymsQuery.data ? { since: gymsQuery.dataUpdatedAt } : null;

  const value: GymOwnerScopeValue = {
    status,
    userId,
    role,
    brandId,
    brandName,
    gyms,
    gymId,
    scopeKey,
    pageKey,
    scopeKind,
    resolution: resolution.kind,
    requestedGymId: resolution.kind === "out-of-scope" ? resolution.requested : requestedGymId,
    canOfferAll: canOfferAllBranches(scopeKind, gyms.length),
    scopeChanging,
    suspended,
    stale,
    error,
    setGymId,
    retry,
    onScopeChange,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
