import type { RequestRateLimiter } from "@/lib/server/request-rate-limiter";

interface SlidingWindowRateLimiterOptions {
  limit: number;
  windowMilliseconds: number;
  now?: () => number;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export function createSlidingWindowRateLimiter({
  limit,
  windowMilliseconds,
  now = Date.now,
  wait = waitFor,
}: SlidingWindowRateLimiterOptions): RequestRateLimiter {
  let requestTimestamps: number[] = [];
  let queueTail = Promise.resolve();

  const reserveRequest = async (signal?: AbortSignal): Promise<void> => {
    throwIfAborted(signal);

    while (true) {
      const currentTime = now();
      const windowStart = currentTime - windowMilliseconds;
      requestTimestamps = requestTimestamps.filter(
        (timestamp) => timestamp > windowStart,
      );

      if (requestTimestamps.length < limit) {
        requestTimestamps.push(currentTime);
        return;
      }

      const waitMilliseconds = Math.max(
        0,
        requestTimestamps[0] + windowMilliseconds - currentTime,
      );
      await wait(waitMilliseconds, signal);
      throwIfAborted(signal);
    }
  };

  return {
    acquire(signal) {
      const reservation = queueTail.then(() => reserveRequest(signal));
      queueTail = reservation.then(
        () => undefined,
        () => undefined,
      );
      return reservation;
    },
  };
}

function waitFor(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortReason(signal));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

function abortReason(signal?: AbortSignal): unknown {
  return (
    signal?.reason ??
    new DOMException("The operation was aborted.", "AbortError")
  );
}
