import { describe, expect, it } from "vitest";

import type { RouteSegment } from "@/lib/domain/types";
import { buildGpx } from "@/lib/gpx/build-gpx";
import { validateGpx } from "@/lib/gpx/validate-gpx";

function segment(
  points: RouteSegment["points"],
  id = "synthetic-segment",
): RouteSegment {
  return {
    id,
    name: "Synthetic",
    mode: "walking",
    points,
    provenance: {
      kind: "recorded-timeline",
      source: "google-timeline",
      referenceDate: null,
      approximate: false,
      explanation: "Synthetic fixture",
    },
  };
}

describe("validateGpx", () => {
  it("accepts valid provenance-rich GPX", () => {
    const xml = buildGpx({
      name: "Valid",
      segments: [
        segment([
          { lat: 0, lon: 0, time: "2026-01-01T00:00:00Z" },
          { lat: 0, lon: 0.01, time: "2026-01-01T00:01:00Z" },
        ]),
      ],
    });

    expect(validateGpx(xml)).toEqual({ valid: true, errors: [] });
  });

  it.each([
    {
      name: "invalid latitude",
      point: '<trkpt lat="91" lon="0"><time>2026-01-01T00:00:00Z</time></trkpt>',
      error: "latitude",
    },
    {
      name: "invalid longitude",
      point: '<trkpt lat="0" lon="181"><time>2026-01-01T00:00:00Z</time></trkpt>',
      error: "longitude",
    },
    {
      name: "invalid time",
      point: '<trkpt lat="0" lon="0"><time>not-a-time</time></trkpt>',
      error: "time",
    },
  ])("rejects $name", ({ point, error }) => {
    const result = validateGpx(gpxWithSegments(`<trkseg>${point}</trkseg>`));

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(new RegExp(error, "i"));
  });

  it("rejects an empty track segment and an output with no segments", () => {
    expect(validateGpx(gpxWithSegments("<trkseg></trkseg>")).valid).toBe(false);
    expect(validateGpx(gpxWithSegments("")).valid).toBe(false);
  });

  it("rejects adjacent points over 2 km in one segment", () => {
    const result = validateGpx(
      gpxWithSegments(`
        <trkseg>
          <trkpt lat="0" lon="0"/>
          <trkpt lat="0" lon="0.03"/>
        </trkseg>`),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/2,?000/);
  });

  it("does not distance-check gaps between separate segments", () => {
    const result = validateGpx(
      gpxWithSegments(`
        <trkseg>
          <trkpt lat="0" lon="0"/>
          <trkpt lat="0" lon="0.01"/>
        </trkseg>
        <trkseg>
          <trkpt lat="40" lon="40"/>
          <trkpt lat="40" lon="40.01"/>
        </trkseg>`),
    );

    expect(result).toEqual({ valid: true, errors: [] });
  });
});

function gpxWithSegments(trackSegments: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <gpx version="1.1" creator="test"
      xmlns="http://www.topografix.com/GPX/1/1"
      xmlns:fowt="urn:fog-of-world-tool:extensions:v1">
      <trk>${trackSegments}</trk>
    </gpx>`;
}
