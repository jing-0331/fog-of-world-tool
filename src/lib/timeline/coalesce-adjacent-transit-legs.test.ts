import { describe, expect, it } from "vitest";

import type {
  GeoPoint,
  TransportMode,
} from "@/lib/domain/types";
import {
  GENERAL_ROUTE_MODES,
  PUBLIC_TRANSIT_MODES,
} from "@/lib/domain/types";
import { distanceMeters } from "@/lib/geo/distance";
import { modeFamily } from "@/lib/routing/mode-policy";
import type {
  TimelineLeg,
  TimelineRepairGap,
} from "@/lib/timeline/build-legs";
import { coalesceAdjacentTransitLegs } from "@/lib/timeline/coalesce-adjacent-transit-legs";

describe("coalesceAdjacentTransitLegs", () => {
  it("collapses multiple repair gaps inside one public-transit leg into one endpoint job", () => {
    const fragmented = transitLeg({
      id: "fragmented-train",
      mode: "train",
      startMinute: 0,
      endMinute: 30,
      start: coordinate(10, 10),
      end: coordinate(13, 13),
    });
    const first = fragmented.points[0];
    const middle = {
      ...coordinate(11, 11),
      time: at(10),
    };
    const last = fragmented.points.at(-1)!;
    fragmented.points = [first, middle, last];
    fragmented.recordedRuns = [[first, middle]];
    fragmented.gaps = [
      repairGap("fragmented-first", fragmented.mode, first, middle),
      repairGap("fragmented-second", fragmented.mode, middle, last),
    ];

    const result = coalesceAdjacentTransitLegs([fragmented]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      mode: "train",
      startTime: fragmented.startTime,
      endTime: fragmented.endTime,
      points: [first, last],
      recordedRuns: [],
      gaps: [
        expect.objectContaining({
          mode: "train",
          startPoint: first,
          endPoint: last,
          startTime: fragmented.startTime,
          endTime: fragmented.endTime,
        }),
      ],
    });
  });

  it("preserves separated repair gaps inside one public-transit leg", () => {
    const separated = transitLeg({
      id: "separated-bus",
      mode: "bus",
      startMinute: 0,
      endMinute: 30,
      start: coordinate(10, 10),
      end: coordinate(13, 13),
    });
    const first = separated.points[0];
    const firstEnd = {
      ...coordinate(11, 11),
      time: at(10),
    };
    const secondStart = {
      ...coordinate(12, 12),
      time: at(20),
    };
    const last = separated.points.at(-1)!;
    separated.points = [first, firstEnd, secondStart, last];
    separated.gaps = [
      repairGap("separated-first", separated.mode, first, firstEnd),
      repairGap("separated-second", separated.mode, secondStart, last),
    ];

    expect(coalesceAdjacentTransitLegs([separated])).toEqual([
      separated,
    ]);
  });

  it("coalesces two same-mode public-transit legs without comparing their intermediate endpoints", () => {
    const first = transitLeg({
      id: "train-a-b",
      mode: "train",
      startMinute: 0,
      endMinute: 10,
      start: coordinate(1, 1),
      end: coordinate(2, 2),
    });
    const second = transitLeg({
      id: "train-x-c",
      mode: "train",
      startMinute: 11,
      endMinute: 30,
      start: coordinate(40, 40),
      end: coordinate(41, 41),
    });

    const result = coalesceAdjacentTransitLegs([
      first,
      second,
    ]);
    const [merged] = result;

    expect(result).toHaveLength(1);
    expect(merged).toMatchObject({
      mode: "train",
      startTime: first.startTime,
      endTime: second.endTime,
      points: [first.points[0], second.points.at(-1)],
      recordedRuns: [],
      unmatched: false,
    });
    expect(merged.id).toContain(first.id);
    expect(merged.id).toContain(second.id);
    expect(merged.gaps).toEqual([
      expect.objectContaining({
        mode: "train",
        startPoint: first.points[0],
        endPoint: second.points.at(-1),
        startTime: first.startTime,
        endTime: second.endTime,
        distanceMeters: distanceMeters(
          first.points[0],
          second.points.at(-1)!,
        ),
        elapsedMilliseconds:
          Date.parse(second.endTime) - Date.parse(first.startTime),
      }),
    ]);
  });

  it("cumulatively coalesces a three-leg chain from the first start to the last end", () => {
    const first = transitLeg({
      id: "three-a-b",
      mode: "bus",
      startMinute: 0,
      endMinute: 10,
      start: coordinate(25, 121),
      end: coordinate(25.1, 121.1),
    });
    const second = transitLeg({
      id: "three-x-c",
      mode: "bus",
      startMinute: 11,
      endMinute: 20,
      start: coordinate(40, -74),
      end: coordinate(40.1, -73.9),
    });
    const third = transitLeg({
      id: "three-y-d",
      mode: "bus",
      startMinute: 22,
      endMinute: 30,
      start: coordinate(-33.8, 151.2),
      end: coordinate(-33.9, 151.3),
    });

    const result = coalesceAdjacentTransitLegs([
      first,
      second,
      third,
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startTime: first.startTime,
      endTime: third.endTime,
      points: [first.points[0], third.points.at(-1)],
      gaps: [
        expect.objectContaining({
          startPoint: first.points[0],
          endPoint: third.points.at(-1),
          startTime: first.startTime,
          endTime: third.endTime,
        }),
      ],
    });
  });

  it("cumulatively coalesces a four-leg chain after every intermediate merge", () => {
    const first = transitLeg({
      id: "four-a-b",
      mode: "ferry",
      startMinute: 0,
      endMinute: 10,
      start: coordinate(25, 121),
      end: coordinate(25.1, 121.1),
    });
    const second = transitLeg({
      id: "four-x-c",
      mode: "ferry",
      startMinute: 11,
      endMinute: 20,
      start: coordinate(35, 139),
      end: coordinate(35.1, 139.1),
    });
    const third = transitLeg({
      id: "four-y-d",
      mode: "ferry",
      startMinute: 22,
      endMinute: 30,
      start: coordinate(48, 2),
      end: coordinate(48.1, 2.1),
    });
    const fourth = transitLeg({
      id: "four-z-e",
      mode: "ferry",
      startMinute: 32,
      endMinute: 45,
      start: coordinate(-33, 151),
      end: coordinate(-33.1, 151.1),
    });

    const result = coalesceAdjacentTransitLegs([
      first,
      second,
      third,
      fourth,
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startTime: first.startTime,
      endTime: fourth.endTime,
      points: [first.points[0], fourth.points.at(-1)],
      gaps: [
        expect.objectContaining({
          startPoint: first.points[0],
          endPoint: fourth.points.at(-1),
          startTime: first.startTime,
          endTime: fourth.endTime,
        }),
      ],
    });
    expect(result[0].id).toContain(first.id);
    expect(result[0].id).toContain(fourth.id);
  });

  it("coalesces a 2:59 gap", () => {
    const first = transitLeg({
      id: "under-three-first",
      mode: "aerial-lift",
      startMinute: 0,
      endMinute: 10,
      start: coordinate(0, 0),
      end: coordinate(1, 1),
    });
    const second = transitLeg({
      id: "under-three-second",
      mode: "aerial-lift",
      startMinute: 12,
      startSecond: 59,
      endMinute: 20,
      start: coordinate(50, 50),
      end: coordinate(2, 2),
    });

    expect(
      coalesceAdjacentTransitLegs([first, second]),
    ).toHaveLength(1);
  });

  it("does not coalesce an exact 3:00 gap and still coalesces the following eligible pair", () => {
    const first = transitLeg({
      id: "exact-three-first",
      mode: "bus",
      startMinute: 0,
      endMinute: 10,
      start: coordinate(0, 0),
      end: coordinate(1, 1),
    });
    const second = transitLeg({
      id: "exact-three-second",
      mode: "bus",
      startMinute: 13,
      endMinute: 20,
      start: coordinate(50, 50),
      end: coordinate(2, 2),
    });
    const third = transitLeg({
      id: "exact-three-third",
      mode: "bus",
      startMinute: 22,
      endMinute: 30,
      start: coordinate(-50, -50),
      end: coordinate(3, 3),
    });

    const result = coalesceAdjacentTransitLegs([
      first,
      second,
      third,
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(first);
    expect(result[1].id).toContain(second.id);
    expect(result[1].id).toContain(third.id);
  });

  it("coalesces negative time gaps caused by overlapping legs", () => {
    const first = transitLeg({
      id: "overlap-first",
      mode: "funicular",
      startMinute: 0,
      endMinute: 10,
      start: coordinate(0, 0),
      end: coordinate(1, 1),
    });
    const second = transitLeg({
      id: "overlap-second",
      mode: "funicular",
      startMinute: 9,
      endMinute: 20,
      start: coordinate(50, 50),
      end: coordinate(2, 2),
    });

    expect(
      coalesceAdjacentTransitLegs([first, second]),
    ).toHaveLength(1);
  });

  it("breaks a chain when the mode changes and does not consume the later same-mode pair", () => {
    const first = transitLeg({
      id: "mode-break-bus",
      mode: "bus",
      startMinute: 0,
      endMinute: 10,
      start: coordinate(0, 0),
      end: coordinate(1, 1),
    });
    const second = transitLeg({
      id: "mode-break-train-a",
      mode: "train",
      startMinute: 11,
      endMinute: 20,
      start: coordinate(50, 50),
      end: coordinate(2, 2),
    });
    const third = transitLeg({
      id: "mode-break-train-b",
      mode: "train",
      startMinute: 22,
      endMinute: 30,
      start: coordinate(-50, -50),
      end: coordinate(3, 3),
    });

    const result = coalesceAdjacentTransitLegs([
      first,
      second,
      third,
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(first);
    expect(result[1].id).toContain(second.id);
    expect(result[1].id).toContain(third.id);
  });

  it.each(PUBLIC_TRANSIT_MODES)(
    "coalesces stable public-transit mode %s through the shared mode family",
    (mode) => {
      expect(modeFamily(mode)).toBe("public-transit");
      const first = transitLeg({
        id: `${mode}-first`,
        mode,
        startMinute: 0,
        endMinute: 10,
        start: coordinate(0, 0),
        end: coordinate(1, 1),
      });
      const second = transitLeg({
        id: `${mode}-second`,
        mode,
        startMinute: 12,
        startSecond: 59,
        endMinute: 20,
        start: coordinate(50, 50),
        end: coordinate(2, 2),
      });

      expect(
        coalesceAdjacentTransitLegs([first, second]),
      ).toHaveLength(1);
    },
  );

  it.each(GENERAL_ROUTE_MODES)(
    "does not coalesce OpenRouteService general mode %s",
    (mode) => {
      expect(modeFamily(mode)).toBe("general");
      const first = transitLeg({
        id: `${mode}-first`,
        mode,
        startMinute: 0,
        endMinute: 10,
        start: coordinate(0, 0),
        end: coordinate(1, 1),
      });
      const second = transitLeg({
        id: `${mode}-second`,
        mode,
        startMinute: 12,
        startSecond: 59,
        endMinute: 20,
        start: coordinate(50, 50),
        end: coordinate(2, 2),
      });

      expect(
        coalesceAdjacentTransitLegs([first, second]),
      ).toEqual([first, second]);
    },
  );

  it("does not coalesce the independent flight mode", () => {
    const first = transitLeg({
      id: "flight-first",
      mode: "flying",
      startMinute: 0,
      endMinute: 10,
      start: coordinate(0, 0),
      end: coordinate(1, 1),
    });
    const second = transitLeg({
      id: "flight-second",
      mode: "flying",
      startMinute: 11,
      endMinute: 20,
      start: coordinate(50, 50),
      end: coordinate(2, 2),
    });

    expect(
      coalesceAdjacentTransitLegs([first, second]),
    ).toEqual([first, second]);
  });
});

interface TransitLegInput {
  id: string;
  mode: TransportMode;
  startMinute: number;
  startSecond?: number;
  endMinute: number;
  endSecond?: number;
  start: Omit<GeoPoint, "time">;
  end: Omit<GeoPoint, "time">;
}

function transitLeg(input: TransitLegInput): TimelineLeg {
  const startPoint = {
    ...input.start,
    time: at(input.startMinute, input.startSecond),
  };
  const endPoint = {
    ...input.end,
    time: at(input.endMinute, input.endSecond),
  };
  const gap: TimelineRepairGap = {
    id: `${input.id}:original-gap`,
    mode: input.mode,
    startPoint,
    endPoint,
    startTime: startPoint.time,
    endTime: endPoint.time,
    distanceMeters: distanceMeters(startPoint, endPoint),
    elapsedMilliseconds:
      Date.parse(endPoint.time) - Date.parse(startPoint.time),
  };

  return {
    id: input.id,
    sourceSegmentId: `${input.id}:source`,
    mode: input.mode,
    startTime: startPoint.time,
    endTime: endPoint.time,
    points: [startPoint, endPoint],
    recordedRuns: [[startPoint, endPoint]],
    gaps: [gap],
    classification: "route",
    unmatched: false,
  };
}

function coordinate(
  lat: number,
  lon: number,
): Omit<GeoPoint, "time"> {
  return { lat, lon };
}

function at(minute: number, second = 0): string {
  return new Date(
    Date.UTC(2026, 0, 1, 8, minute, second),
  ).toISOString();
}

function repairGap(
  id: string,
  mode: TransportMode,
  startPoint: GeoPoint,
  endPoint: GeoPoint,
): TimelineRepairGap {
  return {
    id,
    mode,
    startPoint,
    endPoint,
    startTime: startPoint.time!,
    endTime: endPoint.time!,
    distanceMeters: distanceMeters(startPoint, endPoint),
    elapsedMilliseconds:
      Date.parse(endPoint.time!) - Date.parse(startPoint.time!),
  };
}
