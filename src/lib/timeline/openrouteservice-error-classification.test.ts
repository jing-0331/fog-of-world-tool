import { afterEach, describe, expect, it, vi } from "vitest";

import { distanceMeters } from "@/lib/geo/distance";
import { createOpenRouteServiceClient } from "@/lib/providers/openrouteservice/client";
import {
  processTimeline,
  type TimelineProcessingDependencies,
} from "@/lib/timeline/process-timeline";
import type {
  TimelineLeg,
  TimelineRepairGap,
} from "@/lib/timeline/build-legs";

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenRouteService processing errors", () => {
  it.each([
    {
      providerResult: "http" as const,
      status: 429,
      expectedAttempts: 3,
      expectedCode: "rate_limited",
      expectedMessage: "Provider rate limit reached.",
    },
    {
      providerResult: "http" as const,
      status: 403,
      expectedAttempts: 1,
      expectedCode: "auth",
      expectedMessage: "Provider authentication failed.",
    },
    {
      providerResult: "network" as const,
      status: null,
      expectedAttempts: 3,
      expectedCode: "network",
      expectedMessage: "Provider network request failed.",
    },
    {
      providerResult: "http" as const,
      status: 503,
      expectedAttempts: 3,
      expectedCode: "provider_unavailable",
      expectedMessage: "Provider is unavailable.",
    },
  ])(
    "keeps $expectedCode distinct in the processing report",
    async ({
      providerResult,
      status,
      expectedAttempts,
      expectedCode,
      expectedMessage,
    }) => {
      vi.useFakeTimers();
      const fetchFn =
        providerResult === "network"
          ? vi
              .fn<typeof fetch>()
              .mockRejectedValue(new TypeError("synthetic network failure"))
          : vi.fn<typeof fetch>().mockImplementation(async () =>
              new Response(null, {
                status: status!,
                headers: { "Retry-After": "0" },
              }),
            );
      const requestLimiter = {
        acquire: vi.fn().mockResolvedValue(undefined),
      };
      const client = createOpenRouteServiceClient({
        apiKey: "synthetic-ors-key",
        fetchFn,
        requestLimiter,
      });
      const routeGap = syntheticDrivingGap();
      const processing = processTimeline(
        [syntheticDrivingLeg(routeGap)],
        dependencies({
          repair: vi.fn(async (request) => {
            await client.route({
              profile: "driving-car",
              startPoint: request.startPoint,
              endPoint: request.endPoint,
              signal: request.signal,
            });
            throw new Error("Synthetic failing route unexpectedly succeeded.");
          }),
        }),
      );

      await vi.runAllTimersAsync();
      const result = await processing;

      expect(fetchFn).toHaveBeenCalledTimes(expectedAttempts);
      expect(requestLimiter.acquire).toHaveBeenCalledTimes(expectedAttempts);
      expect(result.report.providerAttempts).toEqual([
        expect.objectContaining({
          segmentId: routeGap.id,
          source: "openrouteservice",
          status: "failed",
          code: expectedCode,
          message: expectedMessage,
        }),
      ]);
      expect(result.report.unresolved).toEqual([
        expect.objectContaining({
          segmentId: routeGap.id,
          message: expect.stringContaining(expectedMessage),
        }),
      ]);
    },
  );
});

function dependencies(
  overrides: Partial<TimelineProcessingDependencies> = {},
): TimelineProcessingDependencies {
  return {
    getCorrection: vi.fn().mockResolvedValue(null),
    getCachedRoute: vi.fn().mockResolvedValue(null),
    putCachedRoute: vi.fn().mockResolvedValue(undefined),
    repair: vi.fn(),
    ...overrides,
  };
}

function syntheticDrivingGap(): TimelineRepairGap {
  const startPoint = {
    lat: 0,
    lon: 0,
    time: "2026-01-01T00:00:00Z",
  };
  const endPoint = {
    lat: 0.001,
    lon: 0.001,
    time: "2026-01-01T00:10:00Z",
  };
  return {
    id: "synthetic-driving-gap",
    mode: "driving",
    startPoint,
    endPoint,
    startTime: startPoint.time,
    endTime: endPoint.time,
    distanceMeters: distanceMeters(startPoint, endPoint),
    elapsedMilliseconds:
      Date.parse(endPoint.time) - Date.parse(startPoint.time),
  };
}

function syntheticDrivingLeg(gap: TimelineRepairGap): TimelineLeg {
  return {
    id: "synthetic-driving-leg",
    sourceSegmentId: "synthetic-segment",
    mode: "driving",
    startTime: gap.startTime,
    endTime: gap.endTime,
    points: [gap.startPoint, gap.endPoint],
    recordedRuns: [],
    gaps: [gap],
    classification: "route",
    unmatched: false,
  };
}
