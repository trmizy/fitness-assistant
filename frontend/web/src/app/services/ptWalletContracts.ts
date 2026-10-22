import { api } from "./api";
import type { PtWalletContractsView } from "../pages/pt/ptWalletContracts.utils";

/**
 * FH-9 - the PT's money per contract (read only). Kept in its own file so the shared api.ts is not touched.
 * The `api` axios instance already carries the auth header and the base URL.
 */
export const ptWalletContractsService = {
  async get(): Promise<PtWalletContractsView> {
    const { data } = await api.get("/me/pt-wallet/contracts");
    return (data?.data ?? data) as PtWalletContractsView;
  },
};
