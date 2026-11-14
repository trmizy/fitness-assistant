/**
 * N13F-05 - Express 4 only catches SYNCHRONOUS throws in a route handler. A rejected promise from an `async` handler
 * with no try/catch of its own (GET /admin/payments/finance-overview, /reconciliation, /commissions, ...) never reached
 * Express: it became an unhandled rejection, and on modern Node that terminates the whole process - one transient
 * Prisma error (P2037 "too many connections") took every payment, wallet and webhook down until a manual restart.
 *
 * This forwards the rejection of ANY route/middleware handler to `next(err)`, so it lands in the error middleware
 * (middleware/error-handler.ts). It is the same mechanism the `express-async-errors` package uses, kept in-repo (no new
 * dependency): Layer.handle_request is the one place Express 4 invokes every handler, so no route can be forgotten -
 * unlike wrapping ~100 handlers one by one. Handlers that already catch their own errors are unaffected (they never
 * reject). Idempotent; app.ts installs it before any router is created.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Layer = require('express/lib/router/layer');

const INSTALLED = Symbol.for('gymini.payment.asyncRouteErrors');

export function installAsyncRouteErrorForwarding(): void {
  if (Layer.prototype[INSTALLED]) return;
  Layer.prototype[INSTALLED] = true;
  Layer.prototype.handle_request = function handleRequest(
    this: { handle: (...a: unknown[]) => unknown },
    req: unknown,
    res: unknown,
    next: (err?: unknown) => void,
  ) {
    const fn = this.handle;
    if (fn.length > 3) {
      // an error-handling middleware, not a request handler
      return next();
    }
    try {
      const out = fn(req, res, next) as { catch?: (cb: (e: unknown) => void) => unknown } | undefined;
      if (out && typeof out.catch === 'function') out.catch(next);
    } catch (err) {
      next(err);
    }
  };
}
