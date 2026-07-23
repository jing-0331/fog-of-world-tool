import { describe, expect, it } from "vitest";

import {
  discoverTimelineDateRange,
  selectTimelineDateRange,
  TimelineDateRangeError,
} from "@/lib/timeline/date-range";
import type { NormalizedSemanticSegment } from "@/lib/timeline/schema";

const segments = [
  segment("late", "2026-03-03T00:30:00+14:00", "2026-03-03T01:00:00+14:00"),
  segment("early", "2026-03-01T23:30:00-10:00", "2026-03-02T00:30:00-10:00"),
  segment("middle", "2026-03-02T12:00:00+08:00", "2026-03-02T13:00:00+08:00"),
];

describe("Timeline local date ranges", () => {
  it("discovers the range from embedded local dates, not computer timezone or array order", () => {
    expect(discoverTimelineDateRange(segments)).toEqual({
      min: "2026-03-01",
      max: "2026-03-03",
    });
  });

  it("selects dates inclusively", () => {
    expect(
      selectTimelineDateRange(segments, {
        startDate: "2026-03-02",
        endDate: "2026-03-03",
      }).map(({ id }) => id),
    ).toEqual(["late", "early", "middle"]);
  });

  it.each([
    ["2026-02-28", "2026-03-02"],
    ["2026-03-02", "2026-03-04"],
    ["2026-03-03", "2026-03-02"],
  ])("rejects invalid or out-of-range selections", (startDate, endDate) => {
    expect(() =>
      selectTimelineDateRange(segments, { startDate, endDate }),
    ).toThrow(TimelineDateRangeError);
  });
});

function segment(
  id: string,
  startTime: string,
  endTime: string,
): NormalizedSemanticSegment {
  return { id, startTime, endTime, timelinePath: [] };
}
