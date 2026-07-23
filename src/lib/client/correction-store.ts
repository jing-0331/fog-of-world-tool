import type {
  CachedRoute,
  StoredCorrection,
} from "@/lib/client/route-cache";
import {
  createRouteCache,
} from "@/lib/client/route-cache";
import type {
  GeoPoint,
  RouteProvenance,
  RouteSource,
  TransportMode,
} from "@/lib/domain/types";

export const TIMELINE_SCHEMA_VERSION = "semantic-segments-v1";

export interface SavedCorrection {
  segmentId: string;
  schemaVersion: string;
  action: "exclude" | "reroute";
  originalMode: TransportMode;
  correctedMode?: TransportMode;
  normalizedRoute?: CachedRoute;
  finalSource?: RouteSource;
  userOverride: boolean;
  updatedAt: string;
}

interface RouteCacheCorrectionPort {
  getCorrection(gapId: string): Promise<StoredCorrection | null>;
  putCorrection(correction: StoredCorrection): Promise<void>;
}

interface SaveExclusionInput {
  segmentId: string;
  originalMode: TransportMode;
}

interface SaveRerouteInput {
  segmentId: string;
  originalMode: TransportMode;
  correctedMode: TransportMode;
  normalizedRoute: CachedRoute;
}

export interface CorrectionStore {
  get(segmentId: string): Promise<SavedCorrection | null>;
  saveExclusion(input: SaveExclusionInput): Promise<void>;
  saveReroute(input: SaveRerouteInput): Promise<void>;
}

export function createCorrectionStore({
  routeCache = createRouteCache(),
  schemaVersion = TIMELINE_SCHEMA_VERSION,
}: {
  routeCache?: RouteCacheCorrectionPort;
  schemaVersion?: string;
} = {}): CorrectionStore {
  return {
    async get(segmentId) {
      const stored = await routeCache.getCorrection(
        storageKey(schemaVersion, segmentId),
      );
      if (
        !stored ||
        stored.originalSegmentId !== segmentId ||
        stored.schemaVersion !== schemaVersion ||
        !stored.originalMode
      ) {
        return null;
      }
      return {
        segmentId,
        schemaVersion,
        action: stored.action,
        originalMode: stored.originalMode,
        ...(stored.correctedMode
          ? { correctedMode: stored.correctedMode }
          : {}),
        ...(stored.normalizedRoute
          ? { normalizedRoute: stored.normalizedRoute }
          : {}),
        ...(stored.finalSource ? { finalSource: stored.finalSource } : {}),
        userOverride: stored.userOverride ?? true,
        updatedAt: stored.updatedAt,
      };
    },

    async saveExclusion(input) {
      await routeCache.putCorrection({
        gapId: storageKey(schemaVersion, input.segmentId),
        originalSegmentId: input.segmentId,
        schemaVersion,
        action: "exclude",
        originalMode: input.originalMode,
        userOverride: true,
        updatedAt: new Date().toISOString(),
      });
    },

    async saveReroute(input) {
      const normalizedRoute = normalizeRoute(input.normalizedRoute);
      await routeCache.putCorrection({
        gapId: storageKey(schemaVersion, input.segmentId),
        originalSegmentId: input.segmentId,
        schemaVersion,
        action: "reroute",
        originalMode: input.originalMode,
        correctedMode: input.correctedMode,
        normalizedRoute,
        finalSource: normalizedRoute.provenance.source,
        userOverride: true,
        updatedAt: new Date().toISOString(),
      });
    },
  };
}

function storageKey(schemaVersion: string, segmentId: string): string {
  return `${schemaVersion}|${segmentId}`;
}

function normalizeRoute(route: CachedRoute): CachedRoute {
  return {
    points: route.points.map(normalizePoint),
    provenance: normalizeProvenance(route.provenance),
  };
}

function normalizePoint(point: GeoPoint): GeoPoint {
  return {
    lat: point.lat,
    lon: point.lon,
    ...(point.time === undefined ? {} : { time: point.time }),
    ...(point.elevationMeters === undefined
      ? {}
      : { elevationMeters: point.elevationMeters }),
  };
}

function normalizeProvenance(
  provenance: RouteProvenance,
): RouteProvenance {
  return {
    kind: provenance.kind,
    source: provenance.source,
    referenceDate: provenance.referenceDate,
    approximate: provenance.approximate,
    explanation: provenance.explanation,
    ...(provenance.originalMode === undefined
      ? {}
      : { originalMode: provenance.originalMode }),
    ...(provenance.correctedMode === undefined
      ? {}
      : { correctedMode: provenance.correctedMode }),
    ...(provenance.userOverride === undefined
      ? {}
      : { userOverride: provenance.userOverride }),
  };
}
