import { QueryClient } from "@tanstack/react-query";

/**
 * Ported from web's routes.tsx, same options. `refetchOnWindowFocus` stays off here for the same
 * reason it is off there, plus a mobile-specific one: AppContext already refreshes the access
 * token on every foreground return, and refetching every query on top of that would turn each
 * app switch into a burst of requests.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Avoid repeated retries for auth/client-side errors that only slow initial render.
      retry: (failureCount, error: any) => {
        const status = error?.response?.status;
        if (typeof status === "number" && status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});
