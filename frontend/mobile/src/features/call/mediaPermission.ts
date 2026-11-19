/**
 * The first time a person grants camera/mic access, the browser (or the OS dialog on a phone) can settle AFTER the first
 * getUserMedia attempt already failed - the tap then looked dead (rehearsal 19/11: "the first video tap places no call").
 * Retry the acquisition once, shortly after, when the failure is the kind a just-granted permission fixes. A real denial
 * fails the same way twice and is reported as before.
 */
const RETRYABLE = new Set(["NotAllowedError", "PermissionDeniedError", "AbortError", "NotReadableError", "TrackStartError"]);

export async function acquireWithPermissionRetry<T>(
  acquire: () => Promise<T>,
  opts: { retryDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  try {
    return await acquire();
  } catch (err) {
    const name = String((err as { name?: unknown })?.name ?? "");
    if (!RETRYABLE.has(name)) throw err;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    await sleep(opts.retryDelayMs ?? 700);
    return acquire();
  }
}
