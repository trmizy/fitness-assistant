import { createClient } from "redis";
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
