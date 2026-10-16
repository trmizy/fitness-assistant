import { createClient } from "redis";
import { logger } from "@gym-coach/shared";
import { isLambdaRuntime } from "../utils/runtime.util";

const redisEnabled =
  process.env.FITNESS_DISABLE_REDIS !== "true" &&
  (process.env.NODE_ENV !== "test" || process.env.FITNESS_ENABLE_REDIS_IN_TEST === "true") &&
  (!isLambdaRuntime() || Boolean(process.env.REDIS_HOST));

const realRedisClient = redisEnabled
  ? createClient({
      url: `redis://${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || 6379}`,
    })
  : null;

// N1 — an EventEmitter "error" event with no listener is a Node uncaught
// exception (it rethrows synchronously), which previously crashed the whole
// process on a socket error/timeout. The client's own default reconnect
// strategy already handles reconnection; this listener only stops that error
// from being unhandled. Callers still see failures (get/setEx reject) and
// must treat Redis as unavailable themselves — see exercise.repository.ts.
realRedisClient?.on("error", (err: unknown) => {
  logger.error({ err: (err as Error)?.message }, "[redis] client error");
});

export const redisClient = realRedisClient ?? {
  isOpen: false,
  async connect() {},
  async quit() {},
  async get(_key: string) {
    return null;
  },
  async setEx(_key: string, _seconds: number, _value: string) {},
  async keys(_pattern: string) {
    return [] as string[];
  },
  async del(_keys: string[] | string) {
    return 0;
  },
};

export function isRedisEnabled(): boolean {
  return Boolean(realRedisClient);
}
