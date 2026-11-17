/** N15A-03: loads the admin directory once per page view (a plain read, no access log); returns a counter that changes when names arrive, so callers re-render. */
import { useEffect, useState } from "react";
import { api } from "../../../services/api";
import { gymAdminNameListeners, gymAdminNamesLoaded, markGymAdminNamesLoaded, rememberGymAdminNames } from "./gymAdminNames";

export function useGymAdminNames(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    gymAdminNameListeners.add(bump);
    if (!gymAdminNamesLoaded()) {
      markGymAdminNamesLoaded(true);
      api
        .get("/admin/dispute-cases/admins")
        .then(({ data }) => {
          rememberGymAdminNames(data);
          gymAdminNameListeners.forEach((l) => l());
        })
        .catch(() => markGymAdminNamesLoaded(false)); // retry on the next mount; names stay neutral meanwhile
    }
    return () => {
      gymAdminNameListeners.delete(bump);
    };
  }, []);
  return version;
}
