import { describe, expect, it, vi } from "vitest";

import type { RepairRouteResult } from "@/lib/routing/repair-route";
import { createRateLimitedFetch } from "@/lib/server/rate-limited-fetch";
import { createSlidingWindowRateLimiter } from "@/lib/server/sliding-window-rate-limiter";
import { createRouteScheduler } from "@/lib/timeline/route-scheduler";
import type { RoutingJob } from "@/lib/timeline/route-job";

describe("route scheduler rate-limit integration", () => {
  it("uses the fifth TDX slot for a manual job and makes queued automatic work wait", async () => {
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
    const fetched: string[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      fetched.push(String(input));
      return new Response("{}", { status: 200 });
    });
    const limitedFetch = createRateLimitedFetch(fetchFn, limiter);

    await limitedFetch("https://tdx.test/previous-1");
    await limitedFetch("https://tdx.test/previous-2");
    await limitedFetch("https://tdx.test/previous-3");

    const activeResponse = deferred<void>();
    const scheduler = createRouteScheduler({
      adapters: {
        openrouteservice: adapter("openrouteservice"),
        transitous: adapter("transitous"),
        tdx: {
          id: "tdx",
          async route(routingJob, signal) {
            await limitedFetch(
              `https://tdx.test/${routingJob.gap.id}`,
              { signal },
            );
            if (routingJob.gap.id === "active") {
              await activeResponse.promise;
            }
            return result("tdx");
          },
        },
      },
      selectLane: () => "tdx",
    });

    const active = scheduler.enqueue(job("active"), "automatic");
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(4));
    const automaticA = scheduler.enqueue(
      job("automatic-a"),
      "automatic",
    );
    const automaticB = scheduler.enqueue(
      job("automatic-b"),
      "automatic",
    );
    const manual = scheduler.enqueue(job("manual"), "manual");

    activeResponse.resolve();
    await active;
    await manual;

    expect(fetched.at(-1)).toBe("https://tdx.test/manual");
    expect(fetchFn).toHaveBeenCalledTimes(5);
    await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(1));
    expect(
      fetched.some((url) => url.endsWith("/automatic-a")),
    ).toBe(false);

    releaseWait?.();
    await automaticA;
    await automaticB;

    expect(fetched.slice(-2)).toEqual([
      "https://tdx.test/automatic-a",
      "https://tdx.test/automatic-b",
    ]);
    expect(wait).toHaveBeenCalledWith(60_000, expect.any(AbortSignal));
  });
});

function adapter(
  id: "openrouteservice" | "transitous",
) {
  return {
    id,
    route: vi.fn().mockResolvedValue(result(id)),
  };
}

function job(id: string): RoutingJob {
  return {
    gap: {
      id,
      mode: "bus",
      startPoint: { lat: 25, lon: 121.5 },
      endPoint: { lat: 25.1, lon: 121.6 },
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: "2026-01-01T00:10:00.000Z",
      distanceMeters: 1_000,
      elapsedMilliseconds: 600_000,
    },
    originalMode: "bus",
    mode: "bus",
  };
}

function result(
  source: "openrouteservice" | "transitous" | "tdx",
): RepairRouteResult {
  return {
    points: [
      { lat: 25, lon: 121.5 },
      { lat: 25.1, lon: 121.6 },
    ],
    provenance: {
      kind:
        source === "openrouteservice"
          ? "ground-route"
          : "transit-route",
      source,
      referenceDate:
        source === "openrouteservice" ? null : "2026-01-01",
      approximate: true,
      explanation: source,
    },
    attempts: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
