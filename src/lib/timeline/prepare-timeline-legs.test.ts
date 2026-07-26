import { describe, expect, it } from "vitest";

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
});
