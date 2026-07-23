import { afterEach, describe, expect, it } from "vitest";

import {
  buildRouteCacheKey,
  createRouteCache,
} from "@/lib/client/route-cache";

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

describe("route cache keys", () => {
  const base = {
    startPoint: { lat: 25.123456, lon: 121.654321 },
    endPoint: { lat: 25.223456, lon: 121.754321 },
    mode: "bus" as const,
    provider: "transitous" as const,
    algorithmVersion: "route-v1",
    referenceDate: "2026-07-23",
  };

  it("includes rounded endpoints, mode, provider, algorithm, and transit month", () => {
    const key = buildRouteCacheKey(base);

    expect(key).toContain("25.12346,121.65432");
    expect(key).toContain("25.22346,121.75432");
    expect(key).toContain("bus");
    expect(key).toContain("transitous");
    expect(key).toContain("route-v1");
    expect(key).toContain("2026-07");
  });

  it.each([
    { mode: "train" as const },
    { provider: "openrouteservice" as const },
    { algorithmVersion: "route-v2" },
    { endPoint: { lat: 26, lon: 122 } },
    { referenceDate: "2026-08-01" },
  ])("changes when a key dimension changes", (change) => {
    expect(buildRouteCacheKey({ ...base, ...change })).not.toBe(
      buildRouteCacheKey(base),
    );
  });
});

describe("route cache stores", () => {
  it("clears repaired routes without deleting user corrections", async () => {
    const databaseName = `fog-route-test-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const cache = createRouteCache({ databaseName });
    const key = buildRouteCacheKey({
      startPoint: { lat: 0, lon: 0 },
      endPoint: { lat: 1, lon: 1 },
      mode: "walking",
      provider: "openrouteservice",
      algorithmVersion: "route-v1",
      referenceDate: null,
    });
    await cache.putRoute(key, {
      points: [
        { lat: 0, lon: 0 },
        { lat: 1, lon: 1 },
      ],
      provenance: {
        kind: "ground-route",
        source: "openrouteservice",
        referenceDate: null,
        approximate: true,
        explanation: "synthetic",
      },
    });
    await cache.putCorrection({
      gapId: "gap-1",
      action: "exclude",
      updatedAt: "2026-07-23T00:00:00Z",
    });

    expect(await cache.getRoute(key)).not.toBeNull();
    expect(await cache.getCorrection("gap-1")).not.toBeNull();

    await cache.clearRoutes();

    expect(await cache.getRoute(key)).toBeNull();
    expect(await cache.getCorrection("gap-1")).toMatchObject({
      action: "exclude",
    });
    cache.close();
  });
});
