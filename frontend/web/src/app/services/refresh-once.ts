/**
 * Ensures the underlying async fn is called at most once while a result is
 * in-flight. Concurrent callers share the same pending promise and each
 * receive the resolved value when it settles.
 *
 * Zero browser dependencies — importable in Node.js unit tests.
 */
export function makeRefreshOnce<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return function refreshOnce(): Promise<T> {
    if (!pending) {
      pending = fn().finally(() => {
        pending = null;
      });
    }
    return pending;
  };
}
