import { describe, expect, it } from "vitest";

import { buildTimelineLegs } from "@/lib/timeline/build-legs";
import { detectFlight } from "@/lib/timeline/detect-flight";
import type { NormalizedSemanticSegment } from "@/lib/timeline/schema";

describe("buildTimelineLegs", () => {
  it("sorts, deduplicates, and attaches recorded points by activity time overlap", () => {
    const activity = activitySegment({
      id: "walk",
      startTime: at(0),
      endTime: at(30),
      type: "WALKING",
      startPoint: { lat: 0, lon: 0 },
      endPoint: { lat: 0.01, lon: 0.01 },
    });
    const path = pathSegment("path", [
      { lat: 0.005, lon: 0.005, time: at(20) },
      { lat: 0, lon: 0, time: at(5) },
      { lat: 0, lon: 0, time: at(5) },
      { lat: 5, lon: 5, time: at(40) },
    ]);

    const legs = buildTimelineLegs([activity, path]);

    expect(legs[0].points.map(({ time }) => time)).toEqual([at(5), at(20)]);
    expect(legs[0].mode).toBe("walking");
    expect(legs[0].probability).toBe(0.9);
  });

  it("uses activity endpoints when fewer than two recorded points overlap", () => {
    const legs = buildTimelineLegs([
      activitySegment({
        id: "drive",
        startTime: at(0),
        endTime: at(10),
        type: "IN_PASSENGER_VEHICLE",
        startPoint: { lat: 0, lon: 0 },
        endPoint: { lat: 0.005, lon: 0.005 },
      }),
    ]);

    expect(legs[0].points).toEqual([
      { lat: 0, lon: 0, time: at(0) },
      { lat: 0.005, lon: 0.005, time: at(10) },
    ]);
  });

  it("keeps pairs at or below 2 km recorded and makes longer pairs repair gaps", () => {
    const path = pathSegment("gapped", [
      { lat: 0, lon: 0, time: at(0) },
      { lat: 0.005, lon: 0, time: at(5) },
      { lat: 1, lon: 0, time: at(10) },
      { lat: 1.005, lon: 0, time: at(15) },
    ]);

    const [leg] = buildTimelineLegs([path]);

    expect(leg.gaps).toHaveLength(1);
    expect(leg.gaps[0]).toMatchObject({
      startPoint: { lat: 0.005, lon: 0 },
      endPoint: { lat: 1, lon: 0 },
      mode: "unknown",
    });
    expect(leg.recordedRuns).toEqual([
      [
        { lat: 0, lon: 0, time: at(0) },
        { lat: 0.005, lon: 0, time: at(5) },
      ],
      [
        { lat: 1, lon: 0, time: at(10) },
        { lat: 1.005, lon: 0, time: at(15) },
      ],
    ]);
  });

  it("splits explicit flights without creating a direct recorded line", () => {
    const [leg] = buildTimelineLegs([
      activitySegment({
        id: "flight",
        startTime: at(0),
        endTime: at(60),
        type: "FLYING",
        startPoint: { lat: 0, lon: 0 },
        endPoint: { lat: 20, lon: 20 },
      }),
    ]);

    expect(leg.classification).toBe("explicit-flight");
    expect(leg.recordedRuns).toEqual([]);
    expect(leg.gaps).toEqual([]);
  });

  it("creates legs from timeline paths that match no activity", () => {
    const [leg] = buildTimelineLegs([
      pathSegment("orphan", [
        { lat: 0, lon: 0, time: at(0) },
        { lat: 0.005, lon: 0.005, time: at(5) },
      ]),
    ]);

    expect(leg.unmatched).toBe(true);
    expect(leg.mode).toBe("unknown");
    expect(leg.recordedRuns).toHaveLength(1);
  });

  it("builds deterministic IDs from time and rounded endpoints", () => {
    const input = [
      pathSegment("stable", [
        { lat: 1.12345671, lon: 2.12345671, time: at(0) },
        { lat: 1.12355671, lon: 2.12355671, time: at(5) },
      ]),
    ];

    expect(buildTimelineLegs(input)[0].id).toBe(
      buildTimelineLegs(structuredClone(input))[0].id,
    );
  });
});

describe("detectFlight", () => {
  it("always recognizes the explicit flying mode", () => {
    expect(
      detectFlight({
        mode: "flying",
        distanceMeters: 10_000,
        elapsedMilliseconds: 3_600_000,
        landOrTransitRoutingFailed: false,
      }),
    ).toBe("explicit");
  });

  it("does not infer a flight from distance and speed alone", () => {
    expect(
      detectFlight({
        mode: "unknown",
        distanceMeters: 500_000,
        elapsedMilliseconds: 3_600_000,
        landOrTransitRoutingFailed: false,
      }),
    ).toBe("none");
  });

  it("marks probable flying only after land/transit routing fails at high distance and speed", () => {
    expect(
      detectFlight({
        mode: "unknown",
        distanceMeters: 500_000,
        elapsedMilliseconds: 3_600_000,
        landOrTransitRoutingFailed: true,
      }),
    ).toBe("probable");
  });
});

function activitySegment(input: {
  id: string;
  startTime: string;
  endTime: string;
  type: string;
  startPoint: { lat: number; lon: number };
  endPoint: { lat: number; lon: number };
}): NormalizedSemanticSegment {
  return {
    id: input.id,
    startTime: input.startTime,
    endTime: input.endTime,
    activity: {
      type: input.type,
      probability: 0.9,
      startPoint: input.startPoint,
      endPoint: input.endPoint,
    },
    timelinePath: [],
  };
}

function pathSegment(
  id: string,
  timelinePath: NormalizedSemanticSegment["timelinePath"],
): NormalizedSemanticSegment {
  return {
    id,
    startTime: timelinePath[0].time,
    endTime: timelinePath.at(-1)!.time,
    timelinePath,
  };
}

function at(minutes: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString();
}
