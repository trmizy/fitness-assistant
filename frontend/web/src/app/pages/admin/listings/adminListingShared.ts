import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminNeedsRefetch, listingErrorMessage } from "../../../utils/listingErrors";

export type ListingKind = "pts" | "gyms";

/** Everything the admin page caches is under one of these roots, so one call refreshes whatever is on screen. */
export const ADMIN_LISTING_ROOTS = ["admin-listing-queue", "admin-listing-revision", "admin-listing-history", "admin-amenity-catalogue", "admin-amenity-proposals"] as const;

export const queueKey = (kind: ListingKind, params: unknown) => ["admin-listing-queue", kind, params] as const;
export const revisionKey = (kind: ListingKind, rid: string) => ["admin-listing-revision", kind, rid] as const;
export const previewKey = (kind: ListingKind, rid: string) => ["admin-listing-preview", kind, rid] as const;
export const historyKey = (kind: ListingKind, id: string) => ["admin-listing-history", kind, id] as const;
export const catalogueKey = (params?: unknown) => ["admin-amenity-catalogue", params ?? null] as const;
export const proposalsKey = (status: string) => ["admin-amenity-proposals", status] as const;

export function refreshAdminListings(queryClient: QueryClient): void {
  for (const root of ADMIN_LISTING_ROOTS) void queryClient.invalidateQueries({ queryKey: [root] });
  void queryClient.invalidateQueries({ queryKey: ["admin-listing-preview"] });
}

/**
 * One handler for every admin write. A 409 that means "what you are looking at is out of date"
 * (already decided by someone else, the listing moved, the proposal was decided…) shows the Vietnamese
 * sentence AND re-fetches, so the screen shows the truth right after the toast.
 */
export function handleAdminError(error: unknown, queryClient: QueryClient, fallback: string): void {
  toast.error(listingErrorMessage(error, fallback));
  if (adminNeedsRefetch(error)) refreshAdminListings(queryClient);
}
