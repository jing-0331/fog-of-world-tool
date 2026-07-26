import { describe, expect, it, vi } from "vitest";

import type { RepairRouteResult } from "@/lib/routing/repair-route";
import { createRoutingLane } from "@/lib/timeline/routing-lane";
import type { RoutingJob } from "@/lib/timeline/route-job";

describe("createRoutingLane", () => {
  it("runs one job at a time in enqueue order through the injected adapter", async () => {
    const first = deferred<RepairRouteResult>();
    const second = deferred<RepairRouteResult>();
    const started: string[] = [];
    const route = vi.fn((job: RoutingJob) => {
      started.push(job.gap.id);
      return job.gap.id === "a" ? first.promise : second.promise;
    });
    const lane = createRoutingLane({
      adapter: { id: "openrouteservice", route },
      concurrency: 1,
    });

    const firstResult = lane.enqueue(job("a"), "automatic");
    const secondResult = lane.enqueue(job("b"), "automatic");

    await vi.waitFor(() => expect(started).toEqual(["a"]));
    first.resolve(result("a"));
    await expect(firstResult).resolves.toEqual(result("a"));
    await vi.waitFor(() => expect(started).toEqual(["a", "b"]));
    second.resolve(result("b"));

    await expect(secondResult).resolves.toEqual(result("b"));
    await expect(lane.whenIdle()).resolves.toBeUndefined();
    expect(route).toHaveBeenCalledTimes(2);
  });

  it("runs a manual job after the active job and before queued automatic jobs", async () => {
    const gates = new Map(
      ["active", "automatic-a", "automatic-b", "manual"].map((id) => [
        id,
        deferred<RepairRouteResult>(),
      ]),
    );
    const started: string[] = [];
    const lane = createRoutingLane({
      adapter: {
        id: "tdx",
        route: vi.fn((routingJob) => {
          started.push(routingJob.gap.id);
          return gates.get(routingJob.gap.id)!.promise;
        }),
      },
      concurrency: 1,
    });

    const active = lane.enqueue(job("active"), "automatic");
    await vi.waitFor(() => expect(started).toEqual(["active"]));
    const automaticA = lane.enqueue(job("automatic-a"), "automatic");
    const automaticB = lane.enqueue(job("automatic-b"), "automatic");
    const manual = lane.enqueue(job("manual"), "manual");

    gates.get("active")!.resolve(result("active"));
    await active;
    await vi.waitFor(() =>
      expect(started).toEqual(["active", "manual"]),
    );

    gates.get("manual")!.resolve(result("manual"));
    await manual;
    await vi.waitFor(() =>
      expect(started).toEqual(["active", "manual", "automatic-a"]),
    );

    gates.get("automatic-a")!.resolve(result("automatic-a"));
    await automaticA;
    await vi.waitFor(() =>
      expect(started).toEqual([
        "active",
        "manual",
        "automatic-a",
        "automatic-b",
      ]),
    );
    gates.get("automatic-b")!.resolve(result("automatic-b"));
    await automaticB;
  });
});

function job(id: string): RoutingJob {
  return {
    gap: {
      id,
      mode: "walking",
      startPoint: { lat: 0, lon: 0 },
      endPoint: { lat: 0.1, lon: 0.1 },
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: "2026-01-01T00:10:00.000Z",
      distanceMeters: 1_000,
      elapsedMilliseconds: 600_000,
    },
    originalMode: "walking",
    mode: "walking",
  };
}

function result(id: string): RepairRouteResult {
  return {
    points: [
      { lat: 0, lon: 0 },
      { lat: 0.1, lon: 0.1 },
    ],
    provenance: {
      kind: "ground-route",
      source: "openrouteservice",
      referenceDate: null,
      approximate: true,
      explanation: id,
    },
    attempts: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
