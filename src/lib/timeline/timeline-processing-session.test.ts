import { describe, expect, it, vi } from "vitest";

import { ProviderError } from "@/lib/server/provider-error";
import type {
  TimelineLeg,
  TimelineRepairGap,
} from "@/lib/timeline/build-legs";
import {
  startTimelineProcessing,
  type TimelineProcessingDependencies,
  type TimelineProcessingEvent,
} from "@/lib/timeline/process-timeline";

describe("startTimelineProcessing", () => {
  it("emits failures from all three lanes and completes automatic work while reviews remain", async () => {
    const events: TimelineProcessingEvent[] = [];
    const session = startTimelineProcessing(
      [
        leg("ors", "walking", foreignGap("ors")),
        leg("transitous", "bus", foreignGap("transitous")),
        leg("tdx", "bus", taiwanGap("tdx")),
      ],
      dependencies({
        repair: vi.fn(async () => {
          throw noRoute("查無路線");
        }),
      }),
    );
    session.subscribe((event) => events.push(event));

    const automatic = await session.automaticDone;
    let finished = false;
    void session.finished.then(() => {
      finished = true;
    });
    await Promise.resolve();

    expect(automatic.report.unresolved).toHaveLength(3);
    expect(
      events
        .filter(
          (
            event,
          ): event is Extract<
            TimelineProcessingEvent,
            { type: "review-enqueued" }
          > => event.type === "review-enqueued",
        )
        .map(({ item }) => [item.gap.id, item.lane]),
    ).toEqual(
      expect.arrayContaining([
        ["ors", "openrouteservice"],
        ["transitous", "transitous"],
        ["tdx", "tdx"],
      ]),
    );
    expect(finished).toBe(false);

    session.cancel();
    await expect(session.finished).resolves.toMatchObject({
      canceled: true,
      downloadable: false,
    });
  });

  it("reclassifies a manual answer, persists it, then removes the review item", async () => {
    const order: string[] = [];
    const repair = vi.fn(async (gap: TimelineRepairGap & { mode: string }) => {
      if (gap.mode === "bus") {
        throw noRoute("Transitous 查無路線");
      }
      order.push(`provider:${gap.mode}`);
      return repaired(gap, "openrouteservice");
    });
    const session = startTimelineProcessing(
      [leg("foreign-bus", "bus", foreignGap("foreign-bus"))],
      dependencies({
        repair,
        async persistReviewDecision(decision) {
          order.push(`persist:${decision.action}`);
        },
      }),
    );
    let reviewId = "";
    session.subscribe((event) => {
      if (event.type === "review-enqueued") {
        reviewId = event.item.gap.id;
      }
      if (
        event.type === "route-succeeded" ||
        event.type === "review-removed"
      ) {
        order.push(`event:${event.type}`);
      }
    });

    const automatic = await session.automaticDone;
    expect(automatic.report.unresolved).toHaveLength(1);
    expect(reviewId).toBe("foreign-bus");

    await session.submitReview({
      gapId: reviewId,
      action: "reroute",
      mode: "walking",
    });
    const finished = await session.finished;

    expect(repair.mock.calls.map(([request]) => request.mode)).toEqual([
      "bus",
      "walking",
    ]);
    expect(order).toEqual([
      "provider:walking",
      "persist:reroute",
      "event:route-succeeded",
      "event:review-removed",
    ]);
    expect(finished.report.unresolved).toEqual([]);
    expect(finished.segments).toEqual([
      expect.objectContaining({
        id: "foreign-bus:repair",
        mode: "walking",
        provenance: expect.objectContaining({
          originalMode: "bus",
          correctedMode: "walking",
          userOverride: true,
        }),
      }),
    ]);
    expect(finished.downloadable).toBe(true);
  });

  it("finishes after an exclusion is persisted and removed", async () => {
    const persisted = vi.fn().mockResolvedValue(undefined);
    const session = startTimelineProcessing(
      [leg("excluded", "walking", foreignGap("excluded"))],
      dependencies({
        repair: vi.fn(async () => {
          throw noRoute("查無路線");
        }),
        persistReviewDecision: persisted,
      }),
    );
    await session.automaticDone;

    await session.submitReview({
      gapId: "excluded",
      action: "exclude",
    });
    const finished = await session.finished;

    expect(persisted).toHaveBeenCalledWith(
      expect.objectContaining({
        gapId: "excluded",
        action: "exclude",
        originalMode: "walking",
      }),
    );
    expect(finished.report.unresolved).toEqual([]);
    expect(finished.report.userExcluded).toEqual([
      expect.objectContaining({ segmentId: "excluded" }),
    ]);
  });
});

function dependencies(
  overrides: Partial<TimelineProcessingDependencies> = {},
): TimelineProcessingDependencies {
  return {
    getCorrection: vi.fn().mockResolvedValue(null),
    getCachedRoute: vi.fn().mockResolvedValue(null),
    putCachedRoute: vi.fn().mockResolvedValue(undefined),
    repair: vi.fn(async (gap) => repaired(gap, "openrouteservice")),
    ...overrides,
  };
}

function leg(
  id: string,
  mode: TimelineLeg["mode"],
  repairGap: TimelineRepairGap,
): TimelineLeg {
  return {
    id: `${id}-leg`,
    sourceSegmentId: id,
    mode,
    startTime: repairGap.startTime,
    endTime: repairGap.endTime,
    points: [repairGap.startPoint, repairGap.endPoint],
    recordedRuns: [],
    gaps: [{ ...repairGap, mode }],
    classification: "route",
    unmatched: false,
  };
}

function foreignGap(id: string): TimelineRepairGap {
  return {
    id,
    mode: "bus",
    startPoint: { lat: 35.68, lon: 139.76 },
    endPoint: { lat: 35.69, lon: 139.77 },
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: "2026-01-01T00:10:00.000Z",
    distanceMeters: 1_000,
    elapsedMilliseconds: 600_000,
  };
}

function taiwanGap(id: string): TimelineRepairGap {
  return {
    ...foreignGap(id),
    startPoint: { lat: 25.03, lon: 121.56 },
    endPoint: { lat: 25.04, lon: 121.57 },
  };
}

function repaired(
  gap: TimelineRepairGap,
  source: "openrouteservice" | "transitous" | "tdx",
) {
  return {
    points: [gap.startPoint, gap.endPoint],
    provenance: {
      kind:
        source === "openrouteservice"
          ? ("ground-route" as const)
          : ("transit-route" as const),
      source,
      referenceDate:
        source === "openrouteservice" ? null : "2026-01-01",
      approximate: true,
      explanation: "測試路線",
    },
    attempts: [],
  };
}

function noRoute(message: string): ProviderError {
  return new ProviderError({
    code: "no_data",
    message,
    retryable: false,
  });
}
