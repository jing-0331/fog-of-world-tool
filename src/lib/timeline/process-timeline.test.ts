import { describe, expect, it, vi } from "vitest";

import type {
  GeoPoint,
  TransportMode,
} from "@/lib/domain/types";
import { distanceMeters } from "@/lib/geo/distance";
import {
  startTimelineProcessing,
  type TimelineProcessingDependencies,
} from "@/lib/timeline/process-timeline";
import type {
  TimelineLeg,
  TimelineRepairGap,
} from "@/lib/timeline/build-legs";
import { ProviderError } from "@/lib/server/provider-error";

function processTimeline(
  ...args: Parameters<typeof startTimelineProcessing>
) {
  return startTimelineProcessing(...args).automaticDone;
}

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

  it("keeps TDX and regular routes on independent sequential lanes", async () => {
    const updates: Array<{ current: number; total: number }> = [];
    const tdxGap = taiwanGap("tdx-pending", 0, 10);
    const regularGap = gap("regular", 20, 30, 0, 0.1);
    let finishTdxRepair!: () => void;
    let finishRegularStore!: () => void;
    const repair = vi.fn(
      async (routeGap: TimelineRepairGap) => {
        if (routeGap.id === tdxGap.id) {
          await new Promise<void>((resolve) => {
            finishTdxRepair = resolve;
          });
        }
        return repaired(routeGap);
      },
    );
    const putCachedRoute = vi.fn(
      async (routeGap: TimelineRepairGap) => {
        if (routeGap.id === regularGap.id) {
          await new Promise<void>((resolve) => {
            finishRegularStore = resolve;
          });
        }
      },
    );
    const processing = processTimeline(
      [
        leg({
          id: "tdx-leg",
          mode: "bus",
          startTime: tdxGap.startTime,
          endTime: tdxGap.endTime,
          gaps: [tdxGap],
        }),
        leg({
          id: "regular-leg",
          mode: "walking",
          startTime: regularGap.startTime,
          endTime: regularGap.endTime,
          gaps: [regularGap],
        }),
      ],
      deps({ repair, putCachedRoute }),
      {
        onProgress: ({ current, total }) => {
          updates.push({ current, total });
        },
      },
    );

    await vi.waitFor(() => expect(finishTdxRepair).toBeTypeOf("function"));
    try {
      await vi.waitFor(() =>
        expect(finishRegularStore).toBeTypeOf("function"),
      );
      expect(updates.at(-1)).toEqual({ current: 0, total: 2 });

      finishRegularStore();
      await vi.waitFor(() =>
        expect(updates.at(-1)).toEqual({ current: 1, total: 2 }),
      );
    } finally {
      finishTdxRepair();
      await vi.waitFor(() =>
        expect(finishRegularStore).toBeTypeOf("function"),
      );
      finishRegularStore();
      await processing;
    }

    expect(updates.at(-1)).toEqual({ current: 2, total: 2 });
  });

  it("keeps Transitous and OpenRouteService on independent lanes", async () => {
    const transitGap = gap("transitous-pending", 0, 10, 0, 0.1);
    const walkingGap = gap("ors-pending", 20, 30, 0.2, 0.3);
    const releases = new Map<string, () => void>();
    const repair = vi.fn(
      (routeGap: TimelineRepairGap) =>
        new Promise<ReturnType<typeof repaired>>((resolve) => {
          releases.set(routeGap.id, () =>
            resolve(repaired(routeGap)),
          );
        }),
    );
    const processing = processTimeline(
      [
        leg({
          id: "transitous-leg",
          mode: "bus",
          startTime: transitGap.startTime,
          endTime: transitGap.endTime,
          gaps: [transitGap],
        }),
        leg({
          id: "ors-leg",
          mode: "walking",
          startTime: walkingGap.startTime,
          endTime: walkingGap.endTime,
          gaps: [walkingGap],
        }),
      ],
      deps({ repair }),
    );

    await vi.waitFor(() =>
      expect(new Set(releases.keys())).toEqual(
        new Set([transitGap.id, walkingGap.id]),
      ),
    );

    releases.get(transitGap.id)!();
    releases.get(walkingGap.id)!();
    await processing;
  });

  it("coalesces adjacent Taiwan public-transit legs into one TDX job before dispatch", async () => {
    const first = routingLeg({
      id: "taiwan-bus-a-b",
      mode: "bus",
      startMinute: 0,
      endMinute: 10,
      start: { lat: 22, lon: 120 },
      end: { lat: 23, lon: 121 },
    });
    const second = routingLeg({
      id: "taiwan-bus-x-c",
      mode: "bus",
      startMinute: 12,
      startSecond: 59,
      endMinute: 30,
      start: { lat: 25, lon: 122 },
      end: { lat: 24, lon: 120 },
    });
    const repair = vi.fn(async (routeGap: TimelineRepairGap) =>
      transitRepaired(routeGap, "tdx"),
    );

    const lanes: string[] = [];
    const session = startTimelineProcessing(
      [first, second],
      deps({ repair }),
    );
    session.subscribe((event) => {
      if (event.type === "route-succeeded") {
        lanes.push(event.lane);
      }
    });
    const result = await session.automaticDone;

    expect(repair).toHaveBeenCalledTimes(1);
    expect(lanes).toEqual(["tdx"]);
    expect(result.report.automaticSuccess).toHaveLength(1);
    expect(result.report.providerAttempts).toHaveLength(1);
    const request = repair.mock.calls[0][0];
    expect(request).toMatchObject({
      mode: "bus",
      startPoint: first.points[0],
      endPoint: second.points.at(-1),
      startTime: first.startTime,
      endTime: second.endTime,
    });
    expect(request.id).toContain(first.id);
    expect(request.id).toContain(second.id);
  });

  it("coalesces a four-leg overseas public-transit chain into one Transitous job", async () => {
    const first = routingLeg({
      id: "overseas-ferry-a-b",
      mode: "ferry",
      startMinute: 0,
      endMinute: 10,
      start: { lat: -10, lon: 10 },
      end: { lat: -11, lon: 11 },
    });
    const second = routingLeg({
      id: "overseas-ferry-x-c",
      mode: "ferry",
      startMinute: 11,
      endMinute: 20,
      start: { lat: 30, lon: -30 },
      end: { lat: 31, lon: -31 },
    });
    const third = routingLeg({
      id: "overseas-ferry-y-d",
      mode: "ferry",
      startMinute: 22,
      endMinute: 30,
      start: { lat: -40, lon: 40 },
      end: { lat: -41, lon: 41 },
    });
    const fourth = routingLeg({
      id: "overseas-ferry-z-e",
      mode: "ferry",
      startMinute: 32,
      endMinute: 45,
      start: { lat: 50, lon: -50 },
      end: { lat: 51, lon: -51 },
    });
    const repair = vi.fn(async (routeGap: TimelineRepairGap) =>
      transitRepaired(routeGap, "transitous"),
    );

    const lanes: string[] = [];
    const session = startTimelineProcessing(
      [first, second, third, fourth],
      deps({ repair }),
    );
    session.subscribe((event) => {
      if (event.type === "route-succeeded") {
        lanes.push(event.lane);
      }
    });
    const result = await session.automaticDone;

    expect(repair).toHaveBeenCalledTimes(1);
    expect(lanes).toEqual(["transitous"]);
    expect(result.report.automaticSuccess).toHaveLength(1);
    expect(result.report.providerAttempts).toHaveLength(1);
    const request = repair.mock.calls[0][0];
    expect(request).toMatchObject({
      mode: "ferry",
      startPoint: first.points[0],
      endPoint: fourth.points.at(-1),
      startTime: first.startTime,
      endTime: fourth.endTime,
    });
    expect(request.id).toContain(first.id);
    expect(request.id).toContain(fourth.id);
  });

  it.each(["walking", "driving"] as const)(
    "keeps adjacent %s legs as two OpenRouteService jobs",
    async (mode) => {
      const first = routingLeg({
        id: `${mode}-a-b`,
        mode,
        startMinute: 0,
        endMinute: 10,
        start: { lat: 1, lon: 1 },
        end: { lat: 2, lon: 2 },
      });
      const second = routingLeg({
        id: `${mode}-x-c`,
        mode,
        startMinute: 12,
        startSecond: 59,
        endMinute: 30,
        start: { lat: 40, lon: 40 },
        end: { lat: 41, lon: 41 },
      });
      const repair = vi.fn(
        async (routeGap: TimelineRepairGap) =>
          repaired(routeGap),
      );

      await processTimeline(
        [first, second],
        deps({ repair }),
      );

      expect(repair).toHaveBeenCalledTimes(2);
      expect(
        repair.mock.calls.map(([request]) => request.id),
      ).toEqual([
        first.gaps[0].id,
        second.gaps[0].id,
      ]);
    },
  );

  it("uses the completed count in active-lane progress messages", async () => {
    const updates: Array<{
      current: number;
      total: number;
      message: string;
    }> = [];
    const tdxGap = taiwanGap("tdx-pending", 0, 10);
    const regularDone = gap("regular-done", 20, 30, 0, 0.1);
    const regularPending = gap("regular-pending", 40, 50, 0.2, 0.3);
    let finishTdxRepair!: () => void;
    let finishRegularRepair!: () => void;
    const processing = processTimeline(
      [
        leg({
          id: "tdx-leg",
          mode: "bus",
          startTime: tdxGap.startTime,
          endTime: tdxGap.endTime,
          gaps: [tdxGap],
        }),
        leg({
          id: "regular-leg",
          mode: "walking",
          startTime: regularDone.startTime,
          endTime: regularPending.endTime,
          gaps: [regularDone, regularPending],
        }),
      ],
      deps({
        repair: vi.fn(async (routeGap: TimelineRepairGap) => {
          if (routeGap.id === tdxGap.id) {
            await new Promise<void>((resolve) => {
              finishTdxRepair = resolve;
            });
          }
          if (routeGap.id === regularPending.id) {
            await new Promise<void>((resolve) => {
              finishRegularRepair = resolve;
            });
          }
          return repaired(routeGap);
        }),
      }),
      {
        onProgress: (progress) => updates.push(progress),
      },
    );

    await vi.waitFor(() =>
      expect(finishRegularRepair).toBeTypeOf("function"),
    );
    try {
      expect(updates.at(-1)).toEqual({
        current: 1,
        total: 3,
        message: "正在處理一般路段；已完成 1/3",
      });
    } finally {
      finishTdxRepair();
      finishRegularRepair();
      await processing;
    }
  });

  it("advances progress only after a repaired route is stored", async () => {
    const updates: Array<{ current: number; total: number }> = [];
    let finishRepair!: () => void;
    let finishStore!: () => void;
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
        putCachedRoute: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finishStore = resolve;
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
    await vi.waitFor(() => expect(finishStore).toBeTypeOf("function"));
    expect(updates.at(-1)).toEqual({ current: 0, total: 1 });

    finishStore();
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

  it("keeps merged TDX retries from blocking regular merged retries", async () => {
    const tdxFirst = taiwanGap("tdx-a", 0, 10, 0);
    const tdxSecond = taiwanGap("tdx-b", 10, 20, 1);
    const regularFirst = gap("regular-a", 30, 40, 0, 0.1);
    const regularSecond = gap("regular-b", 40, 50, 0.1, 0.2);
    const tdxMergedId = `merged:${tdxFirst.id}:${tdxSecond.id}`;
    const regularMergedId =
      `merged:${regularFirst.id}:${regularSecond.id}`;
    let finishTdxMerged!: () => void;
    let regularMergedStarted = false;
    const repair = vi.fn(async (routeGap: TimelineRepairGap) => {
      if (
        routeGap.id === tdxFirst.id ||
        routeGap.id === regularFirst.id
      ) {
        throw noRoute(`${routeGap.id} failed`);
      }
      if (routeGap.id === tdxMergedId) {
        await new Promise<void>((resolve) => {
          finishTdxMerged = resolve;
        });
      }
      if (routeGap.id === regularMergedId) {
        regularMergedStarted = true;
      }
      return repaired(routeGap);
    });
    const processing = processTimeline(
      [
        leg({
          id: "tdx-group",
          mode: "bus",
          startTime: tdxFirst.startTime,
          endTime: tdxSecond.endTime,
          gaps: [tdxFirst, tdxSecond],
        }),
        leg({
          id: "regular-group",
          mode: "walking",
          startTime: regularFirst.startTime,
          endTime: regularSecond.endTime,
          gaps: [regularFirst, regularSecond],
        }),
      ],
      deps({ repair }),
    );

    await vi.waitFor(() => expect(finishTdxMerged).toBeTypeOf("function"));
    try {
      await vi.waitFor(() => expect(regularMergedStarted).toBe(true));
    } finally {
      finishTdxMerged();
      await processing;
    }
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

  it("reuses the first completed matching TDX route immediately", async () => {
    const first = taiwanGap("tdx-first", 0, 10);
    const second = taiwanGap("tdx-second", 20, 30);
    const third = taiwanGap("tdx-third", 40, 50);
    const reusable = taiwanGap("tdx-reusable", 60, 70);
    const sharedRoute = [
      { lat: 25.0478, lon: 121.5319 },
      { lat: 25.041, lon: 121.548 },
      { lat: 25.033, lon: 121.5654 },
    ];
    const repair = vi.fn(async (routeGap: TimelineRepairGap) => ({
      ...repaired(routeGap),
      points: sharedRoute,
      provenance: {
        ...repaired(routeGap).provenance,
        kind: "transit-route" as const,
        source: "tdx" as const,
        referenceDate: "2026-07-26",
      },
    }));

    const result = await processTimeline(
      [
        leg({
          mode: "bus",
          startTime: first.startTime,
          endTime: reusable.endTime,
          gaps: [first, second, third, reusable],
        }),
      ],
      deps({ repair }),
    );

    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair).toHaveBeenCalledWith(
      expect.objectContaining({ id: first.id }),
    );
    expect(result.segments.map(({ id }) => id)).toEqual([
      `${first.id}:repair`,
      `${second.id}:repair`,
      `${third.id}:repair`,
      `${reusable.id}:repair`,
    ]);
    expect(result.segments[3].points[0].time).toBe(reusable.startTime);
    expect(result.segments[3].points.at(-1)?.time).toBe(
      reusable.endTime,
    );
  });

  it("reuses the first completed route for nearby TDX endpoints", async () => {
    const gaps = [
      shiftedTaiwanGap("tdx-near-a", 0, 10, 0),
      shiftedTaiwanGap("tdx-near-b", 20, 30, 0.00003),
      shiftedTaiwanGap("tdx-near-c", 40, 50, -0.00004),
      shiftedTaiwanGap("tdx-near-reusable", 60, 70, 0.00005),
    ];
    const repair = vi.fn(async (routeGap: TimelineRepairGap) => ({
      ...repaired(routeGap),
      points: [
        { lat: 25.0478, lon: 121.5319 },
        { lat: 25.041, lon: 121.548 },
        { lat: 25.033, lon: 121.5654 },
      ],
      provenance: {
        ...repaired(routeGap).provenance,
        kind: "transit-route" as const,
        source: "tdx" as const,
        referenceDate: "2026-07-26",
      },
    }));

    await processTimeline(
      [
        leg({
          mode: "bus",
          startTime: gaps[0].startTime,
          endTime: gaps.at(-1)!.endTime,
          gaps,
        }),
      ],
      deps({ repair }),
    );

    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tdx-near-a" }),
    );
  });

  it("does not reuse TDX routes outside the endpoint tolerance", async () => {
    const first = taiwanGap("tdx-route-a", 0, 10, 0);
    const second = taiwanGap("tdx-route-b", 20, 30, 1);
    const repair = vi.fn(async (routeGap: TimelineRepairGap) => ({
      ...repaired(routeGap),
      provenance: {
        ...repaired(routeGap).provenance,
        kind: "transit-route" as const,
        source: "tdx" as const,
        referenceDate: "2026-07-26",
      },
    }));

    await processTimeline(
      [
        leg({
          mode: "bus",
          startTime: first.startTime,
          endTime: second.endTime,
          gaps: [first, second],
        }),
      ],
      deps({ repair }),
    );

    expect(repair).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a TDX route in the reverse direction", async () => {
    const forward = taiwanGap("tdx-forward", 0, 10);
    const reverse = reverseTdxGap(forward, "tdx-reverse", 20, 30);
    const repair = vi.fn(async (routeGap: TimelineRepairGap) => ({
      ...repaired(routeGap),
      provenance: {
        ...repaired(routeGap).provenance,
        kind: "transit-route" as const,
        source: "tdx" as const,
        referenceDate: "2026-07-26",
      },
    }));

    await processTimeline(
      [
        leg({
          mode: "bus",
          startTime: forward.startTime,
          endTime: reverse.endTime,
          gaps: [forward, reverse],
        }),
      ],
      deps({ repair }),
    );

    expect(repair).toHaveBeenCalledTimes(2);
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

  it("densifies a successfully queried route to at most 2 km", async () => {
    const routeGap = gap("densified-provider-route", 0, 60, 0, 0.1);
    const dependencies = deps();
    const result = await processTimeline(
      [
        leg({
          points: [routeGap.startPoint, routeGap.endPoint],
          gaps: [routeGap],
        }),
      ],
      dependencies,
    );

    expect(dependencies.repair).toHaveBeenCalledTimes(1);
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

function transitRepaired(
  routeGap: TimelineRepairGap,
  source: "tdx" | "transitous",
) {
  const route = repaired(routeGap);
  return {
    ...route,
    provenance: {
      ...route.provenance,
      kind: "transit-route" as const,
      source,
      referenceDate: "2026-07-26",
    },
    attempts: route.attempts.map((attempt) => ({
      ...attempt,
      source,
    })),
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

interface RoutingLegInput {
  id: string;
  mode: TransportMode;
  startMinute: number;
  startSecond?: number;
  endMinute: number;
  endSecond?: number;
  start: Omit<GeoPoint, "time">;
  end: Omit<GeoPoint, "time">;
}

function routingLeg(input: RoutingLegInput): TimelineLeg {
  const startPoint = {
    ...input.start,
    time: at(input.startMinute, input.startSecond),
  };
  const endPoint = {
    ...input.end,
    time: at(input.endMinute, input.endSecond),
  };
  const routeGap: TimelineRepairGap = {
    id: `${input.id}:gap`,
    mode: input.mode,
    startPoint,
    endPoint,
    startTime: startPoint.time,
    endTime: endPoint.time,
    distanceMeters: distanceMeters(startPoint, endPoint),
    elapsedMilliseconds:
      Date.parse(endPoint.time) - Date.parse(startPoint.time),
  };
  return leg({
    id: input.id,
    sourceSegmentId: `${input.id}:source`,
    mode: input.mode,
    startTime: startPoint.time,
    endTime: endPoint.time,
    points: [startPoint, endPoint],
    gaps: [routeGap],
  });
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

function taiwanGap(
  id: string,
  startMinute: number,
  endMinute: number,
  startIndex = 0,
): TimelineRepairGap {
  const coordinates = [
    { lat: 25.0478, lon: 121.5319 },
    { lat: 25.033, lon: 121.5654 },
    { lat: 25.0143, lon: 121.4637 },
  ];
  const startPoint = {
    ...coordinates[startIndex],
    time: at(startMinute),
  };
  const endPoint = {
    ...coordinates[startIndex + 1],
    time: at(endMinute),
  };
  return {
    id,
    mode: "bus",
    startPoint,
    endPoint,
    startTime: startPoint.time,
    endTime: endPoint.time,
    distanceMeters: distanceMeters(startPoint, endPoint),
    elapsedMilliseconds:
      Date.parse(endPoint.time) - Date.parse(startPoint.time),
  };
}

function shiftedTaiwanGap(
  id: string,
  startMinute: number,
  endMinute: number,
  offset: number,
): TimelineRepairGap {
  const routeGap = taiwanGap(id, startMinute, endMinute);
  const startPoint = {
    ...routeGap.startPoint,
    lat: routeGap.startPoint.lat + offset,
    lon: routeGap.startPoint.lon + offset,
  };
  const endPoint = {
    ...routeGap.endPoint,
    lat: routeGap.endPoint.lat + offset,
    lon: routeGap.endPoint.lon + offset,
  };
  return {
    ...routeGap,
    startPoint,
    endPoint,
    distanceMeters: distanceMeters(startPoint, endPoint),
  };
}

function reverseTdxGap(
  source: TimelineRepairGap,
  id: string,
  startMinute: number,
  endMinute: number,
): TimelineRepairGap {
  const startPoint = {
    ...source.endPoint,
    time: at(startMinute),
  };
  const endPoint = {
    ...source.startPoint,
    time: at(endMinute),
  };
  return {
    ...source,
    id,
    startPoint,
    endPoint,
    startTime: startPoint.time,
    endTime: endPoint.time,
    distanceMeters: distanceMeters(startPoint, endPoint),
    elapsedMilliseconds:
      Date.parse(endPoint.time) - Date.parse(startPoint.time),
  };
}

function latitudeForMeters(meters: number): number {
  return (meters / 6_371_008.8) * (180 / Math.PI);
}

function point(lat: number, minute: number) {
  return { lat, lon: 0, time: at(minute) };
}

function at(minute: number, second = 0): string {
  return new Date(
    Date.UTC(2026, 0, 1, 0, minute, second),
  ).toISOString();
}
