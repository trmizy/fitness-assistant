import { api } from "./api";
import type { PtRestrictionEpisode, SuspendCategory } from "../pages/admin/ptSuspension";

/** N15B-04: admin routes of user-service/pt-restriction.controller (the acting admin is the token identity, never a body field). */
export const adminPtRestrictionService = {
  history: async (ptUserId: string): Promise<PtRestrictionEpisode[]> => {
    const { data } = await api.get(`/admin/pts/${encodeURIComponent(ptUserId)}/restrictions`);
    return Array.isArray(data?.restrictions) ? data.restrictions : [];
  },
  suspend: async (ptUserId: string, body: { category: SuspendCategory; reason: string; publicReason?: string }) => {
    const { data } = await api.post(`/admin/pts/${encodeURIComponent(ptUserId)}/suspend`, body);
    return data as { changed: boolean; sessionsCancelled?: number };
  },
  lift: async (ptUserId: string, reason: string) => {
    const { data } = await api.post(`/admin/pts/${encodeURIComponent(ptUserId)}/lift-suspension`, { reason });
    return data as { changed: boolean };
  },
};
