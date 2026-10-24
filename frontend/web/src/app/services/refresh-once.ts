/**
 * Ensures the underlying async fn is called at most once while a result is
 * in-flight. Concurrent callers share the same pending promise and each
 * receive the resolved value when it settles.
 *
 * Zero browser dependencies — importable in Node.js unit tests.
 */
export function makeRefreshOnce<T>(fn: () => Promise<T>, sessionKey: () => unknown = () => 0): () => Promise<T> {
  let pending: Promise<T> | null = null;
  let key: unknown;
  return function refreshOnce(): Promise<T> {
    const nextKey = sessionKey();
    if (!pending || key !== nextKey) {
      key = nextKey;
      const request = fn().finally(() => {
        if (pending === request) pending = null;
      });
      pending = request;
    }
    return pending;
  };
}
