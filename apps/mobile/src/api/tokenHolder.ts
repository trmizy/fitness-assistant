// In-memory mirror of the SecureStore tokens so the axios interceptor can
// read/write synchronously (matches the web app's localStorage.getItem
// pattern) instead of awaiting SecureStore on every single request.
let accessToken: string | null = null;
let refreshToken: string | null = null;

export function getAccessToken() {
  return accessToken;
}

export function getRefreshToken() {
  return refreshToken;
}

export function setInMemoryTokens(tokens: { accessToken: string; refreshToken: string } | null) {
  accessToken = tokens?.accessToken ?? null;
  refreshToken = tokens?.refreshToken ?? null;
}
