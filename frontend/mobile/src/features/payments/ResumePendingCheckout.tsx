import { useEffect, useRef } from "react";
import { router, usePathname } from "expo-router";

import { useApp } from "../../context/AppContext";
import { resultHref } from "./payments";
import { takePendingCheckout } from "./pendingCheckout";

/**
 * Phase 14.1 — once per signed-in client, brings back a checkout the app was killed in the middle
 * of (see pendingCheckout.ts). Renders nothing.
 *
 * Mounted inside the client workspace's guards, so it only ever runs for a signed-in client and the
 * record is matched against that exact user. If the gateway's deep link did make it through, the
 * result screen is already showing and this only clears the record.
 */
export function ResumePendingCheckout() {
  const { user } = useApp();
  const pathname = usePathname();
  const checkedFor = useRef<string | null>(null);

  useEffect(() => {
    const userId = user?.id;
    if (!userId || checkedFor.current === userId) return;
    checkedFor.current = userId;
    const alreadyThere = pathname.startsWith("/client/payments/result");
    void takePendingCheckout(userId).then((transactionId) => {
      if (transactionId && !alreadyThere) router.navigate(resultHref(transactionId) as never);
    });
    // Once per user, on the first render that has one — later path changes must not re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return null;
}
