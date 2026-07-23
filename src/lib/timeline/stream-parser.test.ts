import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseTimelineChunks } from "@/lib/timeline/stream-parser";

const fixture = readFileSync(
  join(
    process.cwd(),
    "src/test/fixtures/timeline/new-format-sanitized.json",
  ),
);

describe("parseTimelineChunks", () => {
  it("retains only normalized semantic segments from small byte chunks", async () => {
    const result = await parseTimelineChunks(chunks(fixture, 7), {
      totalBytes: fixture.byteLength,
    });
    const serialized = JSON.stringify(result);

    expect(result.segments).toHaveLength(12);
    expect(serialized).not.toContain("wifiScan");
    expect(serialized).not.toContain("userLocationProfile");
    expect(serialized).not.toContain("must-not-be-retained");
  });

  it("computes the local date range across every segment, not array endpoints", async () => {
    const result = await parseTimelineChunks(chunks(fixture, 11), {
      totalBytes: fixture.byteLength,
    });

    expect(result.dateRange).toEqual({
      min: "2026-01-01",
      max: "2026-01-03",
    });
  });

  it("preserves supported activity types and normalized path points", async () => {
    const result = await parseTimelineChunks(chunks(fixture, 13), {
      totalBytes: fixture.byteLength,
    });

    expect(result.segments.map((segment) => segment.activity?.type)).toEqual(
      expect.arrayContaining([
        "WALKING",
        "RUNNING",
        "CYCLING",
        "MOTORCYCLING",
        "IN_PASSENGER_VEHICLE",
        "IN_TRAIN",
        "IN_SUBWAY",
        "IN_BUS",
        "IN_TRAM",
        "IN_FERRY",
        "FLYING",
      ]),
    );
    expect(result.segments[0].timelinePath[0]).toMatchObject({
      lat: 1,
      lon: 2,
      time: "2026-01-03T08:00:00+09:00",
    });
  });

  it("reports invalid coordinates and missing times with counts", async () => {
    const input = new TextEncoder().encode(
      JSON.stringify({
        semanticSegments: [
          {
            startTime: "2026-01-01T00:00:00Z",
            timelinePath: [
              { point: "91°, 0°", time: "2026-01-01T00:00:00Z" },
              { point: "0°, 0°" },
            ],
          },
        ],
      }),
    );

    const result = await parseTimelineChunks(chunks(input, 3), {
      totalBytes: input.byteLength,
    });

    expect(result.invalid).toEqual({
      coordinates: 1,
      missingTime: 2,
      segments: 1,
    });
  });

  it("rejects malformed JSON with a classified error", async () => {
    const input = new TextEncoder().encode('{"semanticSegments": [}');

    await expect(
      parseTimelineChunks(chunks(input, 2), { totalBytes: input.byteLength }),
    ).rejects.toMatchObject({ code: "malformed_json" });
  });

  it("rejects unsupported top-level schemas", async () => {
    const input = new TextEncoder().encode(
      JSON.stringify({ locations: [{ latitudeE7: 1 }] }),
    );

    await expect(
      parseTimelineChunks(chunks(input, 4), { totalBytes: input.byteLength }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "unsupported_schema",
      }),
    );
  });

  it("reports monotonic progress in batches", async () => {
    const progress: number[] = [];

    await parseTimelineChunks(chunks(fixture, 17), {
      totalBytes: fixture.byteLength,
      onProgress: (value) => progress.push(value),
    });

    expect(progress[0]).toBeGreaterThanOrEqual(0);
    expect(progress.at(-1)).toBe(1);
    expect(
      progress.every((value, index) => index === 0 || value >= progress[index - 1]),
    ).toBe(true);
    expect(progress.length).toBeLessThan(fixture.byteLength / 17);
  });
});

async function* chunks(
  bytes: Uint8Array,
  size: number,
): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    yield bytes.slice(offset, offset + size);
  }
}
