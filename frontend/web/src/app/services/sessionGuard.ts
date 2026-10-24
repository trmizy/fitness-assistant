/** In-process session identity and serialized native-storage writes. */
export class SessionChangedError extends Error {
  constructor() { super("Session changed while the request was running"); this.name = "SessionChangedError"; }
}

export function createSessionGuard() {
  let generation = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const current = () => generation;
  const assertCurrent = (expected: number) => {
    if (expected !== generation) throw new SessionChangedError();
  };
  return {
    current,
    begin: () => ++generation,
    assertCurrent,
    // Checking only before Preferences.set is insufficient: native writes themselves
    // are asynchronous. New-session writes must wait for any old write to finish.
    run<T>(expected: number, operation: () => Promise<T>): Promise<T> {
      const result = tail.then(async () => {
        assertCurrent(expected);
        const value = await operation();
        assertCurrent(expected);
        return value;
      });
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

export const sessionGuard = createSessionGuard();
