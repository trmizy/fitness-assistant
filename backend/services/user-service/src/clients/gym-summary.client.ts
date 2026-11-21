import axios from 'axios';
import { installLambdaAdapter, serviceBaseUrl } from "./lambda-http.client";
import { toContractGymInfo, type ContractGymInfo } from "../services/contract-dto";

installLambdaAdapter();
const GYM_SERVICE_URL = serviceBaseUrl('GYM', 'http://localhost:3006');

/**
 * Public gym card (name + address) for a contract's chosen branch - the same public `GET /gyms/:id` the client's own
 * contract screens read. Best effort: a slow or unreachable gym-service yields null (the PT list must still load; the
 * contract row keeps its `gymId`).
 */
export async function fetchContractGymInfo(gymId: string): Promise<ContractGymInfo | null> {
  try {
    const { data } = await axios.get(`${GYM_SERVICE_URL}/gyms/${encodeURIComponent(gymId)}`, { timeout: 2_500 });
    return toContractGymInfo(data?.data ?? data);
  } catch {
    return null;
  }
}
