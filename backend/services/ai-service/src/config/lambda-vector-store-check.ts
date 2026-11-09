/**
 * Lazy vector-store availability check shared by the HTTP Lambda entrypoints
 * (lambda.ts, stream-lambda.ts).
 *
 * Lambda execution environments are frozen/thawed between invocations, so
 * there is no long-lived process to run a setInterval health check against.
 * Instead each invocation calls this, and the store is re-probed at most once
 * per VECTOR_STORE_RECHECK_MS per warm container; the result is cached in the
 * vector availability module state in app.ts.
 *
 * `./app` and the vector-store provider are imported lazily, AFTER
 * DATABASE_URL has been resolved from Secrets Manager by the caller.
 */
let vectorStoreCheckedAt = 0;
const VECTOR_STORE_RECHECK_MS = 60_000;

export async function ensureVectorStoreChecked(): Promise<void> {
  const now = Date.now();
  if (now - vectorStoreCheckedAt < VECTOR_STORE_RECHECK_MS) return;
  vectorStoreCheckedAt = now;
  const { setQdrantAvailable } = await import("../app");
  const { getVectorStore } = await import("../vector-store/provider");
  try {
    await getVectorStore().healthCheck();
    setQdrantAvailable(true);
  } catch {
    setQdrantAvailable(false);
  }
}
