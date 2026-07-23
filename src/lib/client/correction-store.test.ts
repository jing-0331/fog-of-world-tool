import { afterEach, describe, expect, it } from "vitest";

import {
  createCorrectionStore,
  TIMELINE_SCHEMA_VERSION,
} from "@/lib/client/correction-store";
import { createRouteCache } from "@/lib/client/route-cache";

const databaseNames: string[] = [];

afterEach(async () => {
  await Promise.all(
    databaseNames.splice(0).map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        }),
    ),
  );
});

describe("correction store", () => {
  it("keys corrections by deterministic segment ID and parser/schema version", async () => {
    const { first, second, close } = stores();

    await first.saveExclusion({
      segmentId: "stable-gap",
      originalMode: "driving",
    });

    expect(await first.get("stable-gap")).toMatchObject({
      segmentId: "stable-gap",
      schemaVersion: TIMELINE_SCHEMA_VERSION,
      action: "exclude",
    });
    expect(await second.get("stable-gap")).toBeNull();
    await close();
  });

  it("stores only the normalized reroute decision and result", async () => {
    const { first, close } = stores();
    const marker = "raw-upload-must-never-be-stored";

    await first.saveReroute({
      segmentId: "stable-gap",
      originalMode: "driving",
      correctedMode: "bus",
      normalizedRoute: {
        points: [
          { lat: 25, lon: 121.5, time: "2026-01-01T00:00:00Z" },
          { lat: 25.1, lon: 121.6, time: "2026-01-01T01:00:00Z" },
        ],
        provenance: {
          kind: "transit-route",
          source: "transitous",
          referenceDate: "2026-07-23",
          approximate: true,
          explanation: "合成路線",
        },
      },
      rawJson: marker,
    } as Parameters<typeof first.saveReroute>[0] & { rawJson: string });

    const saved = await first.get("stable-gap");
    expect(saved).toMatchObject({
      action: "reroute",
      originalMode: "driving",
      correctedMode: "bus",
      finalSource: "transitous",
      userOverride: true,
    });
    expect(JSON.stringify(saved)).not.toContain(marker);
    await close();
  });
});

function stores() {
  const databaseName = `fog-correction-test-${crypto.randomUUID()}`;
  databaseNames.push(databaseName);
  const routeCache = createRouteCache({ databaseName });
  const first = createCorrectionStore({ routeCache });
  const second = createCorrectionStore({
    routeCache,
    schemaVersion: "semantic-segments-v2",
  });
  return {
    first,
    second,
    async close() {
      await routeCache.close();
    },
  };
}
