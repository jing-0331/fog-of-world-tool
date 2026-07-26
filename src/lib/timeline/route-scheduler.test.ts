import { describe, expect, it, vi } from "vitest";

import type { RepairRouteResult } from "@/lib/routing/repair-route";
import { createRouteScheduler } from "@/lib/timeline/route-scheduler";
import type {
  AutomaticLane,
  RoutingJob,
} from "@/lib/timeline/route-job";

describe("createRouteScheduler", () => {
  it("starts one job in each provider lane without cross-lane blocking", async () => {
    const gates = new Map<AutomaticLane, ReturnType<typeof deferred>>([
      ["openrouteservice", deferred()],
      ["transitous", deferred()],
      ["tdx", deferred()],
    ]);
    const started: AutomaticLane[] = [];
    const adapterFor = (lane: AutomaticLane) => ({
      id: lane,
      route: vi.fn(async () => {
        started.push(lane);
        return gates.get(lane)!.promise;
      }),
    });
    const scheduler = createRouteScheduler({
      adapters: {
        openrouteservice: adapterFor("openrouteservice"),
        transitous: adapterFor("transitous"),
        tdx: adapterFor("tdx"),
      },
      selectLane: (routingJob) =>
        routingJob.gap.id as AutomaticLane,
    });

    const scheduled = (
      ["openrouteservice", "transitous", "tdx"] as const
    ).map((lane) =>
      scheduler.enqueue(job(lane), "automatic"),
    );

    await vi.waitFor(() =>
      expect(new Set(started)).toEqual(
        new Set(["openrouteservice", "transitous", "tdx"]),
      ),
    );
    for (const [lane, gate] of gates) {
      gate.resolve(result(lane));
    }

    await expect(Promise.all(scheduled)).resolves.toEqual([
      {
        lane: "openrouteservice",
        result: result("openrouteservice"),
      },
      {
        lane: "transitous",
        result: result("transitous"),
      },
      { lane: "tdx", result: result("tdx") },
    ]);
  });
});

function job(id: string): RoutingJob {
  return {
    gap: {
      id,
      mode: "bus",
      startPoint: { lat: 0, lon: 0 },
      endPoint: { lat: 0.1, lon: 0.1 },
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: "2026-01-01T00:10:00.000Z",
      distanceMeters: 1_000,
      elapsedMilliseconds: 600_000,
    },
    originalMode: "bus",
    mode: "bus",
  };
}

function result(id: string): RepairRouteResult {
  return {
    points: [
      { lat: 0, lon: 0 },
      { lat: 0.1, lon: 0.1 },
    ],
    provenance: {
      kind: "transit-route",
      source: id === "tdx" ? "tdx" : "transitous",
      referenceDate: "2026-01-01",
      approximate: true,
      explanation: id,
    },
    attempts: [],
  };
}

function deferred() {
  let resolve!: (value: RepairRouteResult) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<RepairRouteResult>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  return { promise, resolve, reject };
}
