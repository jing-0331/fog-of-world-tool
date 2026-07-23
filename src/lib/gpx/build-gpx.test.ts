import { describe, expect, it } from "vitest";

import type { RouteSegment } from "@/lib/domain/types";
import { buildGpx } from "@/lib/gpx/build-gpx";
import { gpxFilename } from "@/lib/gpx/download";

const segments: RouteSegment[] = [
  {
    id: "segment<&1",
    name: "A & <B>",
    mode: "flying",
    points: [
      {
        lat: 0,
        lon: 0,
        time: "2026-07-23T08:00:00+08:00",
        elevationMeters: 10,
      },
      { lat: 0, lon: 0.01, time: "2026-07-23T08:10:00+08:00" },
    ],
    provenance: {
      kind: "actual-track",
      source: "opensky",
      referenceDate: "2026-07-23",
      approximate: false,
      explanation: "Provider says \"actual\" & verified",
      userOverride: true,
      originalMode: "unknown",
      correctedMode: "flying",
    },
  },
  {
    id: "segment-2",
    name: "Recorded leg",
    mode: "walking",
    points: [
      { lat: 1, lon: 1, time: "2026-07-23T01:00:00Z" },
      { lat: 1, lon: 1.01, time: "2026-07-23T01:10:00Z" },
    ],
    provenance: {
      kind: "recorded-timeline",
      source: "google-timeline",
      referenceDate: null,
      approximate: false,
      explanation: "Recorded",
    },
  },
];

describe("buildGpx", () => {
  it("builds GPX 1.1 with the application extension namespace", () => {
    const xml = buildGpx({
      name: "Synthetic routes",
      segments,
      report: { unresolvedCount: 2, excludedCount: 1, skippedFlightCount: 3 },
    });

    expect(xml).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(xml).toContain(
      'xmlns:fowt="urn:fog-of-world-tool:extensions:v1"',
    );
    expect(xml.match(/<trkseg>/g)).toHaveLength(2);
  });

  it("escapes XML text and attributes", () => {
    const xml = buildGpx({ name: "A & B", segments });

    expect(xml).toContain("A &amp; B");
    expect(xml).toContain('id="segment&lt;&amp;1"');
    expect(xml).toContain(
      "Provider says &quot;actual&quot; &amp; verified",
    );
    expect(xml).not.toContain("<name>A & <B></name>");
  });

  it("writes per-route provenance and report counts", () => {
    const xml = buildGpx({
      name: "Synthetic routes",
      segments,
      report: { unresolvedCount: 2, excludedCount: 1, skippedFlightCount: 3 },
    });

    expect(xml).toContain("<fowt:kind>actual-track</fowt:kind>");
    expect(xml).toContain("<fowt:source>opensky</fowt:source>");
    expect(xml).toContain(
      "<fowt:referenceDate>2026-07-23</fowt:referenceDate>",
    );
    expect(xml).toContain("<fowt:approximate>false</fowt:approximate>");
    expect(xml).toContain("<fowt:userOverride>true</fowt:userOverride>");
    expect(xml).toContain("<fowt:unresolvedCount>2</fowt:unresolvedCount>");
  });

  it("normalizes emitted times to UTC and omits unknown elevation", () => {
    const xml = buildGpx({ name: "Synthetic routes", segments });

    expect(xml).toContain("<time>2026-07-23T00:00:00.000Z</time>");
    expect(xml.match(/<ele>/g)).toHaveLength(1);
  });
});

describe("gpxFilename", () => {
  it("uses the exact flight and Timeline filename formats", () => {
    const date = new Date("2026-07-23T12:00:00Z");

    expect(gpxFilename("flight", date)).toBe("FlightRoute260723.gpx");
    expect(gpxFilename("timeline", date)).toBe("TimelineRoute260723.gpx");
  });
});
