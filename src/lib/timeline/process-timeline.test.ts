import { describe, expect, it, vi } from "vitest";

import { distanceMeters } from "@/lib/geo/distance";
import {
  processTimeline,
  type TimelineProcessingDependencies,
} from "@/lib/timeline/process-timeline";
import type {
  TimelineLeg,
  TimelineRepairGap,
} from "@/lib/timeline/build-legs";
import { ProviderError } from "@/lib/server/provider-error";

describe("processTimeline", () => {
  it("retains recorded points without provider calls", async () => {
    const dependencies = deps();
    const result = await processTimeline(
      [leg({ recordedRuns: [[point(0, 0), point(0.005, 5)]] })],
      dependencies,
    );

    expect(dependencies.repair).not.toHaveBeenCalled();
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].provenance).toMatchObject({
      kind: "recorded-timeline",
      source: "google-timeline",
      approximate: false,
    });
    expect(result.downloadable).toBe(true);
    expect(result.gpx).toContain("<gpx");
  });

  it("processes multiple gaps sequentially and returns deterministic order", async () => {
    const order: string[] = [];
    const dependencies = deps({
      repair: vi.fn(async (gap) => {
        order.push(gap.id);
        return repaired(gap);
      }),
    });
    const first = gap("gap-a", 0, 10, 0, 0.1);
    const second = gap("gap-b", 20, 30, 0.1, 0.2);

    const result = await processTimeline(
      [leg({ gaps: [second, first] })],
      dependencies,
    );

    expect(order).toEqual(["gap-a", "gap-b"]);
    expect(result.segments.map(({ id }) => id)).toEqual([
      "gap-a:repair",
      "gap-b:repair",
    ]);
  });

  it("advances progress only after a route finishes successfully", async () => {
    const updates: Array<{ current: number; total: number }> = [];
    let finishRepair!: () => void;
    const routeGap = gap("pending", 0, 10, 0, 0.1);
    const processing = processTimeline(
      [leg({ gaps: [routeGap] })],
      deps({
        repair: vi.fn(
          () =>
            new Promise<ReturnType<typeof repaired>>((resolve) => {
              finishRepair = () => resolve(repaired(routeGap));
            }),
        ),
      }),
      {
        onProgress: ({ current, total }) => {
          updates.push({ current, total });
        },
      },
    );

    await vi.waitFor(() => expect(finishRepair).toBeTypeOf("function"));
    expect(updates.at(-1)).toEqual({ current: 0, total: 1 });

    finishRepair();
    await processing;

    expect(updates.at(-1)).toEqual({ current: 1, total: 1 });
  });

  it("does not count failed routes and keeps one total through finalization", async () => {
    const updates: Array<{ current: number; total: number }> = [];
    const first = gap("success-a", 0, 10, 0, 0.1);
    const failed = gap("failed", 20, 30, 0.1, 0.2);
    const last = gap("success-b", 40, 50, 0.2, 0.3);

    await processTimeline(
      [leg({ gaps: [first, failed, last] })],
      deps({
        repair: vi.fn(async (routeGap) => {
          if (routeGap.id === failed.id) {
            throw noRoute("no route");
          }
          return repaired(routeGap);
        }),
      }),
      {
        onProgress: ({ current, total }) => {
          updates.push({ current, total });
        },
      },
    );

    expect(updates[0]).toEqual({ current: 0, total: 3 });
    expect(updates.every(({ total }) => total === 3)).toBe(true);
    expect(updates.at(-1)).toEqual({ current: 2, total: 3 });
    expect(
      updates.every(
        ({ current }, index) =>
          index === 0 || current >= updates[index - 1].current,
      ),
    ).toBe(true);
  });

  it("retries a contiguous same-mode group as one route and replaces its partial repairs", async () => {
    const first = gap("gap-a", 0, 10, 0, 0.1);
    const middle = gap("gap-b", 10, 20, 0.1, 0.2);
    const last = gap("gap-c", 20, 30, 0.2, 0.3);
    const repair = vi.fn(async (routeGap: TimelineRepairGap) => {
      if (routeGap.id === middle.id) {
        throw noRoute("B→C has no provider route");
      }
      return repaired(routeGap);
    });
    const dependencies = deps({ repair });

    const result = await processTimeline(
      [leg({ gaps: [first, middle, last] })],
      dependencies,
    );

    expect(repair).toHaveBeenCalledTimes(4);
    expect(repair.mock.calls[3][0]).toMatchObject({
      mode: "walking",
      startPoint: first.startPoint,
      endPoint: last.endPoint,
      startTime: first.startTime,
      endTime: last.endTime,
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      mode: "walking",
      provenance: expect.objectContaining({
        source: "openrouteservice",
      }),
    });
    expect(result.segments[0].points[0]).toMatchObject({
      lat: first.startPoint.lat,
      time: first.startTime,
    });
    expect(result.segments[0].points.at(-1)).toMatchObject({
      lat: last.endPoint.lat,
      time: last.endTime,
    });
    expect(result.segments[0].id).not.toMatch(/^gap-[abc]:repair$/);
    expect(result.report.unresolved).toEqual([]);
    expect(result.report.automaticSuccess).toHaveLength(1);
    expect(
      result.report.providerAttempts.map(({ segmentId, status }) => ({
        segmentId,
        status,
      })),
    ).toEqual([
      { segmentId: first.id, status: "success" },
      { segmentId: middle.id, status: "failed" },
      { segmentId: last.id, status: "success" },
      {
        segmentId: `merged:${first.id}:${last.id}`,
        status: "success",
      },
    ]);
    expect(dependencies.putCachedRoute).toHaveBeenCalledTimes(3);
    expect(dependencies.putCachedRoute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startPoint: first.startPoint,
        endPoint: last.endPoint,
      }),
      "walking",
      expect.objectContaining({
        provenance: expect.objectContaining({
          source: "openrouteservice",
        }),
      }),
    );
  });

  it("only sends the originally failed gap to review after the merged retry also fails", async () => {
    const first = gap("gap-a", 0, 10, 0, 0.1);
    const middle = gap("gap-b", 10, 20, 0.1, 0.2);
    const last = gap("gap-c", 20, 30, 0.2, 0.3);
    const repair = vi.fn(async (routeGap: TimelineRepairGap) => {
      if (routeGap.id === middle.id) {
        throw noRoute("B→C has no provider route");
      }
      if (
        routeGap.startTime === first.startTime &&
        routeGap.endTime === last.endTime
      ) {
        throw noRoute("A→D merged route has no provider route");
      }
      return repaired(routeGap);
    });

    const result = await processTimeline(
      [leg({ gaps: [first, middle, last] })],
      deps({ repair }),
    );

    expect(repair).toHaveBeenCalledTimes(4);
    expect(result.segments.map(({ id }) => id)).toEqual([
      "gap-a:repair",
      "gap-c:repair",
    ]);
    expect(result.report.unresolved).toEqual([
      expect.objectContaining({
        segmentId: middle.id,
        message: expect.stringContaining("B→C has no provider route"),
      }),
    ]);
    expect(
      result.report.providerAttempts.filter(
        (attempt) => attempt.segmentId === middle.id,
      ),
    ).toEqual([
      expect.objectContaining({
        status: "failed",
        message: "B→C has no provider route",
      }),
    ]);
  });

  it("treats up to 60 seconds and 100 meters of drift as contiguous", async () => {
    const first = gap("gap-a", 0, 10, 0, 0.1);
    const second = gap("gap-b", 11, 20, 0, 0.2);
    second.startPoint.lat = first.endPoint.lat + latitudeForMeters(100);
    second.distanceMeters = distanceMeters(
      second.startPoint,
      second.endPoint,
    );
    const repair = vi.fn(async (routeGap: TimelineRepairGap) => {
      if (routeGap.id === first.id) {
        throw noRoute("first route failed");
      }
      return repaired(routeGap);
    });

    await processTimeline(
      [leg({ gaps: [first, second] })],
      deps({ repair }),
    );

    expect(repair).toHaveBeenCalledTimes(3);
    expect(repair.mock.calls[2][0]).toMatchObject({
      startPoint: first.startPoint,
      endPoint: second.endPoint,
    });
  });

  it.each([
    {
      name: "a time break over 60 seconds",
      mutate: (first: TimelineRepairGap, second: TimelineRepairGap) => {
        second.startTime = new Date(
          Date.parse(first.endTime) + 60_001,
        ).toISOString();
        second.startPoint.time = second.startTime;
      },
    },
    {
      name: "endpoint drift over 100 meters",
      mutate: (first: TimelineRepairGap, second: TimelineRepairGap) => {
        second.startPoint.lat =
          first.endPoint.lat + latitudeForMeters(100.01);
        second.distanceMeters = distanceMeters(
          second.startPoint,
          second.endPoint,
        );
      },
    },
  ])("does not merge across $name", async ({ mutate }) => {
    const first = gap("gap-a", 0, 10, 0, 0.1);
    const second = gap("gap-b", 10, 20, 0.1, 0.2);
    mutate(first, second);
    const repair = vi.fn(async (routeGap: TimelineRepairGap) => {
      if (routeGap.id === first.id) {
        throw noRoute("first route failed");
      }
      return repaired(routeGap);
    });

    const result = await processTimeline(
      [leg({ gaps: [first, second] })],
      deps({ repair }),
    );

    expect(repair).toHaveBeenCalledTimes(2);
    expect(result.report.unresolved).toEqual([
      expect.objectContaining({ segmentId: first.id }),
    ]);
  });

  it("does not merge contiguous gaps whose effective modes differ", async () => {
    const first = gap("gap-a", 0, 10, 0, 0.1);
    const second = gap("gap-b", 10, 20, 0.1, 0.2);
    const repair = vi.fn(async (routeGap: TimelineRepairGap) => {
      if (routeGap.id === first.id) {
        throw noRoute("first route failed");
      }
      return repaired(routeGap);
    });

    const result = await processTimeline(
      [
        leg({
          id: "walking-leg",
          mode: "walking",
          startTime: first.startTime,
          endTime: first.endTime,
          gaps: [first],
        }),
        leg({
          id: "driving-leg",
          mode: "driving",
          startTime: second.startTime,
          endTime: second.endTime,
          gaps: [second],
        }),
      ],
      deps({ repair }),
    );

    expect(repair).toHaveBeenCalledTimes(2);
    expect(result.report.unresolved).toEqual([
      expect.objectContaining({ segmentId: first.id }),
    ]);
  });

  it("uses cached repairs without provider calls", async () => {
    const cachedGap = gap("cached", 0, 10, 0, 0.1);
    const cached = repaired(cachedGap);
    const dependencies = deps({
      getCachedRoute: vi.fn().mockResolvedValue(cached),
    });

    const result = await processTimeline(
      [leg({ gaps: [cachedGap] })],
      dependencies,
    );

    expect(dependencies.repair).not.toHaveBeenCalled();
    expect(result.segments[0].provenance.source).toBe("openrouteservice");
  });

  it("applies a saved normalized user correction before cache or providers", async () => {
    const correctedGap = gap("corrected", 0, 10, 0, 0.1);
    const correctedRoute = repaired(correctedGap);
    const dependencies = deps({
      getCorrection: vi.fn().mockResolvedValue({
        gapId: "semantic-segments-v1|corrected",
        action: "reroute",
        originalMode: "walking",
        correctedMode: "bus",
        normalizedRoute: {
          points: correctedRoute.points,
          provenance: {
            ...correctedRoute.provenance,
            kind: "transit-route",
            source: "transitous",
            referenceDate: "2026-07-23",
          },
        },
        updatedAt: "2026-07-23T00:00:00Z",
      }),
    });

    const result = await processTimeline(
      [leg({ gaps: [correctedGap] })],
      dependencies,
    );

    expect(dependencies.getCachedRoute).not.toHaveBeenCalled();
    expect(dependencies.repair).not.toHaveBeenCalled();
    expect(result.report.userCorrectedSuccess).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      mode: "bus",
      provenance: {
        source: "transitous",
        originalMode: "walking",
        correctedMode: "bus",
        userOverride: true,
      },
    });
  });

  it.each([
    { meters: 1_999, expectedMode: "walking" },
    { meters: 2_000, expectedMode: "motorcycling" },
    { meters: 5_000, expectedMode: "motorcycling" },
    { meters: 5_001, expectedMode: "driving" },
  ] as const)(
    "defaults an unknown $meters meter gap to $expectedMode",
    async ({ meters, expectedMode }) => {
      const routeGap = gapAtDistance(`unknown-${meters}`, meters);
      const repair = vi.fn(async (request: TimelineRepairGap) =>
        repaired(request),
      );

      await processTimeline(
        [leg({ mode: "unknown", gaps: [routeGap] })],
        deps({ repair }),
      );

      expect(repair).toHaveBeenCalledWith(
        expect.objectContaining({
          id: routeGap.id,
          mode: expectedMode,
        }),
      );
    },
  );

  it("keeps a user mode correction ahead of the unknown-distance default", async () => {
    const routeGap = gapAtDistance("corrected-unknown", 5_001);
    const repair = vi.fn(async (request: TimelineRepairGap) =>
      repaired(request),
    );
    const dependencies = deps({
      getCorrection: vi.fn().mockResolvedValue({
        gapId: routeGap.id,
        action: "reroute",
        originalMode: "unknown",
        correctedMode: "walking",
        updatedAt: "2026-07-24T00:00:00Z",
      }),
      repair,
    });

    const result = await processTimeline(
      [leg({ mode: "unknown", gaps: [routeGap] })],
      dependencies,
    );

    expect(repair).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "walking" }),
    );
    expect(result.segments[0].provenance).toMatchObject({
      originalMode: "unknown",
      correctedMode: "walking",
      userOverride: true,
    });
  });

  it("keeps provider provenance and stores successful repairs", async () => {
    const routeGap = gap("success", 0, 10, 0, 0.1);
    const dependencies = deps();

    const result = await processTimeline(
      [leg({ gaps: [routeGap] })],
      dependencies,
    );

    expect(result.segments[0].provenance).toMatchObject({
      source: "openrouteservice",
      approximate: true,
    });
    expect(dependencies.putCachedRoute).toHaveBeenCalledWith(
      routeGap,
      "walking",
      expect.objectContaining({
        provenance: expect.objectContaining({ source: "openrouteservice" }),
      }),
    );
  });

  it("splits explicit flights and records them as skipped", async () => {
    const result = await processTimeline(
      [
        leg({
          id: "flight-leg",
          classification: "explicit-flight",
          mode: "flying",
          points: [point(0, 0), point(20, 60)],
        }),
      ],
      deps(),
    );

    expect(result.segments).toEqual([]);
    expect(result.report.skippedFlights).toEqual([
      expect.objectContaining({ segmentId: "flight-leg" }),
    ]);
    expect(result.downloadable).toBe(false);
  });

  it("splits unresolved gaps and continues with later legs", async () => {
    const dependencies = deps({
      repair: vi.fn().mockRejectedValue(new Error("no route")),
    });

    const result = await processTimeline(
      [
        leg({ gaps: [gap("unresolved", 0, 10, 0, 0.1)] }),
        leg({
          id: "later",
          startTime: at(20),
          endTime: at(30),
          recordedRuns: [[point(0.1, 20), point(0.105, 30)]],
        }),
      ],
      dependencies,
    );

    expect(result.report.unresolved).toHaveLength(1);
    expect(result.report.providerAttempts).toEqual([
      expect.objectContaining({ segmentId: "unresolved" }),
    ]);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].id).toContain("later");
    expect(result.partial).toBe(true);
    expect(result.downloadable).toBe(true);
  });

  it("marks high-speed long-distance failures as probable flights", async () => {
    const longGap = gap("probable", 0, 60, 0, 5);
    const result = await processTimeline(
      [leg({ mode: "driving", gaps: [longGap] })],
      deps({ repair: vi.fn().mockRejectedValue(new Error("no route")) }),
    );

    expect(result.report.skippedFlights[0].message).toContain("可能是飛行");
  });

  it("cancels future calls and returns no downloadable artifact", async () => {
    const controller = new AbortController();
    const repair = vi.fn(async (routeGap: TimelineRepairGap) => {
      controller.abort();
      throw new DOMException(`stopped ${routeGap.id}`, "AbortError");
    });

    const result = await processTimeline(
      [
        leg({
          recordedRuns: [[point(0, 0), point(0.005, 5)]],
          gaps: [
            gap("first", 10, 20, 0, 0.1),
            gap("second", 30, 40, 0.1, 0.2),
          ],
        }),
      ],
      deps({ repair }),
      { signal: controller.signal },
    );

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.canceled).toBe(true);
    expect(result.downloadable).toBe(false);
    expect(result.segments).toEqual([]);
    expect(result.gpx).toBeNull();
  });

  it("densifies every successful output segment to at most 2 km", async () => {
    const result = await processTimeline(
      [
        leg({
          recordedRuns: [[point(0, 0), point(0.1, 60)]],
        }),
      ],
      deps(),
    );

    for (const segment of result.segments) {
      for (let index = 1; index < segment.points.length; index += 1) {
        expect(
          distanceMeters(segment.points[index - 1], segment.points[index]),
        ).toBeLessThanOrEqual(2_000.01);
      }
    }
  });

  it("does not create an artifact from zero segments", async () => {
    const result = await processTimeline([], deps());

    expect(result.downloadable).toBe(false);
    expect(result.gpx).toBeNull();
  });
});

function deps(
  overrides: Partial<TimelineProcessingDependencies> = {},
): TimelineProcessingDependencies {
  return {
    getCorrection: vi.fn().mockResolvedValue(null),
    getCachedRoute: vi.fn().mockResolvedValue(null),
    putCachedRoute: vi.fn().mockResolvedValue(undefined),
    repair: vi.fn(async (routeGap) => repaired(routeGap)),
    ...overrides,
  };
}

function repaired(routeGap: TimelineRepairGap) {
  return {
    points: [routeGap.startPoint, routeGap.endPoint],
    provenance: {
      kind: "ground-route" as const,
      source: "openrouteservice" as const,
      referenceDate: null,
      approximate: true,
      explanation: "合成修補",
    },
    attempts: [
      {
        source: "openrouteservice" as const,
        status: "success" as const,
        message: "合成修補",
        retryable: false,
      },
    ],
  };
}

function noRoute(message: string): ProviderError {
  return new ProviderError({
    code: "no_data",
    message,
    retryable: false,
  });
}

function leg(
  overrides: Partial<TimelineLeg> = {},
): TimelineLeg {
  return {
    id: "leg",
    sourceSegmentId: "semantic",
    mode: "walking",
    startTime: at(0),
    endTime: at(60),
    points: [point(0, 0), point(0.1, 60)],
    recordedRuns: [],
    gaps: [],
    classification: "route",
    unmatched: false,
    ...overrides,
  };
}

function gap(
  id: string,
  startMinute: number,
  endMinute: number,
  startLat: number,
  endLat: number,
): TimelineRepairGap {
  const startPoint = point(startLat, startMinute);
  const endPoint = point(endLat, endMinute);
  return {
    id,
    mode: "walking",
    startPoint,
    endPoint,
    startTime: startPoint.time!,
    endTime: endPoint.time!,
    distanceMeters: distanceMeters(startPoint, endPoint),
    elapsedMilliseconds:
      Date.parse(endPoint.time!) - Date.parse(startPoint.time!),
  };
}

function gapAtDistance(id: string, meters: number): TimelineRepairGap {
  const startPoint = point(0, 0);
  const endPoint = point(latitudeForMeters(meters), 10);
  return {
    id,
    mode: "unknown",
    startPoint,
    endPoint,
    startTime: startPoint.time!,
    endTime: endPoint.time!,
    distanceMeters: meters,
    elapsedMilliseconds:
      Date.parse(endPoint.time!) - Date.parse(startPoint.time!),
  };
}

function latitudeForMeters(meters: number): number {
  return (meters / 6_371_008.8) * (180 / Math.PI);
}

function point(lat: number, minute: number) {
  return { lat, lon: 0, time: at(minute) };
}

function at(minute: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
}
