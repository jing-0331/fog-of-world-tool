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

function point(lat: number, minute: number) {
  return { lat, lon: 0, time: at(minute) };
}

function at(minute: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
}
