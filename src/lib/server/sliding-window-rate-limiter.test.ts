import { describe, expect, it, vi } from "vitest";

import { createSlidingWindowRateLimiter } from "@/lib/server/sliding-window-rate-limiter";

describe("sliding-window rate limiter", () => {
  it("allows five requests immediately and waits before the sixth", async () => {
    let nowMilliseconds = 0;
    let releaseWait: (() => void) | undefined;
    const wait = vi.fn(
      (milliseconds: number) =>
        new Promise<void>((resolve) => {
          releaseWait = () => {
            nowMilliseconds += milliseconds;
            resolve();
          };
        }),
    );
    const limiter = createSlidingWindowRateLimiter({
      limit: 5,
      windowMilliseconds: 60_000,
      now: () => nowMilliseconds,
      wait,
    });

    await Promise.all(Array.from({ length: 5 }, () => limiter.acquire()));

    let sixthRequestStarted = false;
    const sixthRequest = limiter.acquire().then(() => {
      sixthRequestStarted = true;
    });
    await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(1));

    expect(sixthRequestStarted).toBe(false);
    expect(wait).toHaveBeenCalledWith(60_000, undefined);

    releaseWait?.();
    await sixthRequest;

    expect(sixthRequestStarted).toBe(true);
  });

  it("removes a cancelled waiter without blocking later requests", async () => {
    let nowMilliseconds = 0;
    const wait = vi.fn(
      (_milliseconds: number, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        }),
    );
    const limiter = createSlidingWindowRateLimiter({
      limit: 5,
      windowMilliseconds: 60_000,
      now: () => nowMilliseconds,
      wait,
    });
    await Promise.all(Array.from({ length: 5 }, () => limiter.acquire()));
    const controller = new AbortController();

    const cancelledRequest = limiter.acquire(controller.signal);
    await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(cancelledRequest).rejects.toMatchObject({
      name: "AbortError",
    });

    nowMilliseconds = 60_000;
    await expect(limiter.acquire()).resolves.toBeUndefined();
  });
});
