import { describe, expect, it } from "vitest";

import { distanceMeters } from "@/lib/geo/distance";
import type { TimelineLeg } from "@/lib/timeline/build-legs";
import {
  prepareTimelineLegs,
} from "@/lib/timeline/prepare-timeline-legs";

describe("prepareTimelineLegs", () => {
  it("preserves leg values behind a replaceable preprocessing seam", () => {
    const legs: TimelineLeg[] = [
      {
        id: "leg-1",
        sourceSegmentId: "segment-1",
        mode: "bus",
        startTime: "2026-01-01T00:00:00.000Z",
        endTime: "2026-01-01T00:10:00.000Z",
        points: [],
        recordedRuns: [],
        gaps: [],
        classification: "route",
        unmatched: false,
      },
    ];

    const prepared = prepareTimelineLegs(legs);

    expect(prepared).toEqual(legs);
    expect(prepared).not.toBe(legs);
  });

  it("coalesces adjacent same-mode public-transit legs before routing", () => {
    const first = busLeg(
      "bus-a-b",
      0,
      10,
      { lat: 1, lon: 1 },
      { lat: 2, lon: 2 },
    );
    const second = busLeg(
      "bus-x-c",
      11,
      30,
      { lat: 40, lon: 40 },
      { lat: 41, lon: 41 },
    );

    const prepared = prepareTimelineLegs([first, second]);

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      startTime: first.startTime,
      endTime: second.endTime,
      points: [first.points[0], second.points.at(-1)],
      gaps: [
        expect.objectContaining({
          startPoint: first.points[0],
          endPoint: second.points.at(-1),
        }),
      ],
    });
  });
});

function busLeg(
  id: string,
  startMinute: number,
  endMinute: number,
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
): TimelineLeg {
  const startPoint = { ...start, time: at(startMinute) };
  const endPoint = { ...end, time: at(endMinute) };
  return {
    id,
    sourceSegmentId: `${id}:source`,
    mode: "bus",
    startTime: startPoint.time,
    endTime: endPoint.time,
    points: [startPoint, endPoint],
    recordedRuns: [],
    gaps: [
      {
        id: `${id}:gap`,
        mode: "bus",
        startPoint,
        endPoint,
        startTime: startPoint.time,
        endTime: endPoint.time,
        distanceMeters: distanceMeters(startPoint, endPoint),
        elapsedMilliseconds:
          Date.parse(endPoint.time) - Date.parse(startPoint.time),
      },
    ],
    classification: "route",
    unmatched: false,
  };
}

function at(minute: number): string {
  return new Date(Date.UTC(2026, 0, 1, 8, minute)).toISOString();
}
