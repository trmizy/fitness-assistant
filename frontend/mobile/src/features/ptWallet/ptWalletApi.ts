import { api } from "../../services/api";
import type { PtWalletContractsView } from "./ptWalletContracts";

/** GET /me/pt-wallet/contracts - read only, derived from the ledger by payment-service. Own file: the shared services/api.ts is not touched. */
export async function fetchPtWalletContracts(): Promise<PtWalletContractsView> {
  const { data } = await api.get("/me/pt-wallet/contracts");
  return (data?.data ?? data) as PtWalletContractsView;
}
