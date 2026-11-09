/**
 * D7 - React Query keys and reads of the two money-exception views.
 *
 * Every key is `["admin","finance","money-exceptions", <userId>, ...]`: under the "Tài chính" prefix (so the Đối soát header "Làm mới" re-reads
 * them), and carrying the signed-in user id so one account's data can never be served to the next (the app also clears the cache on logout /
 * login / session expiry). No polling, no refetch-on-focus, no automatic retry: the late-open list reads the ledger once per row and a write
 * must never be repeated behind the admin's back; reloading is always a click.
 */
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../../../context/AppContext";
import { moneyExceptionApi } from "./moneyExceptionApi";
import { parseAdminDirectory, type AdminDirectoryEntry } from "./adminDirectory";
import {
  normalizeCapabilities,
  normalizeD65bDetail,
  normalizeD65bList,
  normalizeD65bPreview,
  normalizeLateItem,
  normalizeLateList,
  type D65bDetail,
  type D65bSessionPreview,
  type D65bSummary,
  type LateItem,
  type MoneyCapabilities,
} from "./moneyExceptionTypes";
import { RECON_KEYS } from "../useReconciliationData";

export const MONEY_ROOT = ["admin", "finance", "money-exceptions"] as const;

export function moneyKeys(userId: string) {
  if (!userId) throw new Error("moneyKeys needs the signed-in user id");
  const base = [...MONEY_ROOT, userId] as const;
  return {
    all: base,
    capabilities: () => [...base, "capabilities"] as const,
    admins: () => [...base, "admins"] as const,
    d65bList: () => [...base, "d65b", "list"] as const,
    d65bDetail: (id: string) => [...base, "d65b", "detail", id] as const,
    d65bPreview: (sessionId: string) => [...base, "d65b", "preview", sessionId] as const,
    lateList: () => [...base, "late", "list"] as const,
    lateItem: (rowId: string) => [...base, "late", "item", rowId] as const,
  };
}
export type MoneyKeys = ReturnType<typeof moneyKeys>;

const READ = { refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false, staleTime: 0 } as const;
const malformed = () => Object.assign(new Error("MALFORMED_RESPONSE"), { malformed: true });

export function useMoneyKeys(): { keys: MoneyKeys | null; userId: string | null } {
  const { user } = useApp();
  const userId = user?.id ?? null;
  return useMemo(() => ({ keys: userId ? moneyKeys(userId) : null, userId }), [userId]);
}

/** A1. A failed read is NOT "flags off": the caller gets `unknown` flags and shows no write control. */
export function useCapabilities() {
  const { keys } = useMoneyKeys();
  const q = useQuery({
    queryKey: keys?.capabilities() ?? ["admin", "finance", "money-exceptions", "none", "capabilities"],
    enabled: !!keys,
    queryFn: async (): Promise<MoneyCapabilities> => normalizeCapabilities((await moneyExceptionApi.capabilities()).data),
    ...READ,
  });
  return q;
}

export function useAdminDirectory(enabled: boolean) {
  const { keys } = useMoneyKeys();
  return useQuery({
    queryKey: keys?.admins() ?? ["admin", "finance", "money-exceptions", "none", "admins"],
    enabled: !!keys && enabled,
    queryFn: async (): Promise<AdminDirectoryEntry[]> => parseAdminDirectory((await moneyExceptionApi.adminUsers()).data),
    ...READ,
    staleTime: 5 * 60_000,
  });
}

export function useD65bList() {
  const { keys } = useMoneyKeys();
  return useQuery({
    queryKey: keys?.d65bList() ?? ["admin", "finance", "money-exceptions", "none", "d65b-list"],
    enabled: !!keys,
    queryFn: async (): Promise<D65bSummary[]> => {
      const list = normalizeD65bList((await moneyExceptionApi.d65bList(50)).data);
      if (!list) throw malformed();
      return list;
    },
    ...READ,
  });
}

export function useD65bDetail(id: string | null) {
  const { keys } = useMoneyKeys();
  return useQuery({
    queryKey: keys && id ? keys.d65bDetail(id) : ["admin", "finance", "money-exceptions", "none", "d65b-detail"],
    enabled: !!keys && !!id,
    queryFn: async (): Promise<D65bDetail> => {
      const d = normalizeD65bDetail((await moneyExceptionApi.d65bGet(id!)).data);
      if (!d) throw malformed();
      return d;
    },
    ...READ,
  });
}

export function useD65bPreview(sessionId: string | null) {
  const { keys } = useMoneyKeys();
  return useQuery({
    queryKey: keys && sessionId ? keys.d65bPreview(sessionId) : ["admin", "finance", "money-exceptions", "none", "d65b-preview"],
    enabled: !!keys && !!sessionId,
    queryFn: async (): Promise<D65bSessionPreview> => {
      const p = normalizeD65bPreview((await moneyExceptionApi.d65bBySession(sessionId!)).data);
      if (!p) throw malformed();
      return p;
    },
    ...READ,
  });
}

export function useLateList() {
  const { keys } = useMoneyKeys();
  return useQuery({
    queryKey: keys?.lateList() ?? ["admin", "finance", "money-exceptions", "none", "late-list"],
    enabled: !!keys,
    queryFn: async (): Promise<LateItem[]> => {
      const list = normalizeLateList((await moneyExceptionApi.lateList(50)).data);
      if (!list) throw malformed();
      return list;
    },
    ...READ,
  });
}

export function useLateItem(rowId: string | null) {
  const { keys } = useMoneyKeys();
  return useQuery({
    queryKey: keys && rowId ? keys.lateItem(rowId) : ["admin", "finance", "money-exceptions", "none", "late-item"],
    enabled: !!keys && !!rowId,
    queryFn: async (): Promise<LateItem> => {
      const it = normalizeLateItem((await moneyExceptionApi.lateGet(rowId!)).data);
      if (!it) throw malformed();
      return it;
    },
    ...READ,
  });
}

/**
 * After a write: re-read this account's money-exception data AND the existing Đối soát reports (the settlement rows / obligations they show
 * just changed). Resolves when the reads finished, so a dialog can wait for "the screen shows the real state" before it reports.
 */
export function useAfterMoneyWrite() {
  const qc = useQueryClient();
  const { keys } = useMoneyKeys();
  return async () => {
    if (!keys) return;
    await Promise.all([
      qc.invalidateQueries({ queryKey: keys.all }),
      qc.invalidateQueries({ queryKey: RECON_KEYS.sessions }),
      qc.invalidateQueries({ queryKey: RECON_KEYS.obligations }),
      qc.invalidateQueries({ queryKey: RECON_KEYS.balance }),
    ]);
    const failed = qc.getQueryCache().findAll({ queryKey: keys.all, type: "active" }).find((q) => q.state.status === "error");
    if (failed) throw failed.state.error ?? new Error("Không tải lại được dữ liệu đối soát.");
  };
}
