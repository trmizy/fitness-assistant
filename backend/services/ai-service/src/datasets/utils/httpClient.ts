import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Lightweight axios wrapper used by dataset providers.
 * - Sets a default timeout so providers can never hang the server.
 * - Surfaces meaningful error messages (status + body) instead of raw Axios errors.
 */
export async function httpGet<T>(
  url: string,
  params?: Record<string, unknown>,
  headers?: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const config: AxiosRequestConfig = { params, headers, timeout: timeoutMs };
  try {
    const response = await axios.get<T>(url, config);
    return response.data;
  } catch (err) {
    throw normalizeHttpError(err, `GET ${url}`);
  }
}

export async function httpPost<T>(
  url: string,
  data?: unknown,
  headers?: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const config: AxiosRequestConfig = { headers, timeout: timeoutMs };
  try {
    const response = await axios.post<T>(url, data, config);
    return response.data;
  } catch (err) {
    throw normalizeHttpError(err, `POST ${url}`);
  }
}

function normalizeHttpError(err: unknown, context: string): Error {
  if (err instanceof AxiosError) {
    const status = err.response?.status ?? 'no-response';
    const body =
      typeof err.response?.data === 'string'
        ? err.response.data.slice(0, 200)
        : JSON.stringify(err.response?.data ?? {}).slice(0, 200);
    return new Error(`[DatasetHTTP] ${context} → ${status}: ${body}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
