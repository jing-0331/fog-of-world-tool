import type { RequestRateLimiter } from "@/lib/server/request-rate-limiter";

export function createRateLimitedFetch(
  fetchFn: typeof fetch,
  limiter: RequestRateLimiter,
): typeof fetch {
  return async (input, init) => {
    await limiter.acquire(init?.signal ?? undefined);
    return fetchFn(input, init);
  };
}
