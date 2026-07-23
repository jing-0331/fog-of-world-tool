import { type DBSchema, openDB } from "idb";

import type {
  GeoPoint,
  RouteProvenance,
  RouteSource,
  TransportMode,
} from "@/lib/domain/types";

const DEFAULT_DATABASE_NAME = "fog-of-world-routes";

export interface RouteCacheKeyInput {
  startPoint: GeoPoint;
  endPoint: GeoPoint;
  mode: TransportMode;
  provider: Extract<RouteSource, "openrouteservice" | "transitous">;
  algorithmVersion: string;
  referenceDate: string | null;
}

export interface CachedRoute {
  points: GeoPoint[];
  provenance: RouteProvenance;
}

export interface StoredCorrection {
  gapId: string;
  action: "exclude" | "reroute";
  originalSegmentId?: string;
  schemaVersion?: string;
  originalMode?: TransportMode;
  correctedMode?: TransportMode;
  normalizedRoute?: CachedRoute;
  finalSource?: RouteSource;
  userOverride?: boolean;
  updatedAt: string;
}

interface RouteCacheDatabase extends DBSchema {
  routes: {
    key: string;
    value: {
      key: string;
      route: CachedRoute;
    };
  };
  corrections: {
    key: string;
    value: StoredCorrection;
  };
}

export function buildRouteCacheKey(input: RouteCacheKeyInput): string {
  const monthBucket =
    input.provider === "transitous"
      ? (input.referenceDate?.slice(0, 7) ?? "current")
      : "static";
  return [
    rounded(input.startPoint),
    rounded(input.endPoint),
    input.mode,
    input.provider,
    input.algorithmVersion,
    monthBucket,
  ].join("|");
}

export function createRouteCache({
  databaseName = DEFAULT_DATABASE_NAME,
}: { databaseName?: string } = {}) {
  const database = openDB<RouteCacheDatabase>(databaseName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("routes")) {
        db.createObjectStore("routes", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("corrections")) {
        db.createObjectStore("corrections", { keyPath: "gapId" });
      }
    },
  });

  return {
    async getRoute(key: string): Promise<CachedRoute | null> {
      return (await (await database).get("routes", key))?.route ?? null;
    },
    async putRoute(key: string, route: CachedRoute): Promise<void> {
      await (await database).put("routes", { key, route });
    },
    async clearRoutes(): Promise<void> {
      await (await database).clear("routes");
    },
    async getCorrection(gapId: string): Promise<StoredCorrection | null> {
      return (await (await database).get("corrections", gapId)) ?? null;
    },
    async putCorrection(correction: StoredCorrection): Promise<void> {
      await (await database).put("corrections", correction);
    },
    async clearCorrections(): Promise<void> {
      await (await database).clear("corrections");
    },
    async close(): Promise<void> {
      (await database).close();
    },
  };
}

function rounded(point: GeoPoint): string {
  return `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
}
