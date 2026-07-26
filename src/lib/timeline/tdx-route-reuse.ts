import type { CachedRoute } from "@/lib/client/route-cache";
import type { GeoPoint, TransportMode } from "@/lib/domain/types";
import { distanceMeters } from "@/lib/geo/distance";
import type { TimelineRepairGap } from "@/lib/timeline/build-legs";

const ENDPOINT_TOLERANCE_METERS = 100;

interface TdxRouteReuseGroup {
  mode: TransportMode;
  startPoint: GeoPoint;
  endPoint: GeoPoint;
  route: CachedRoute;
}

export function createTdxRouteReuse() {
  const groups: TdxRouteReuseGroup[] = [];

  return {
    get(
      gap: TimelineRepairGap,
      mode: TransportMode,
    ): CachedRoute | null {
      const group = findGroup(groups, gap, mode);
      return group?.route ?? null;
    },
    record(
      gap: TimelineRepairGap,
      mode: TransportMode,
      route: CachedRoute,
    ): void {
      if (findGroup(groups, gap, mode) === undefined) {
        createGroup(groups, gap, mode, route);
      }
    },
  };
}

function findGroup(
  groups: TdxRouteReuseGroup[],
  gap: TimelineRepairGap,
  mode: TransportMode,
): TdxRouteReuseGroup | undefined {
  let closest: TdxRouteReuseGroup | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const group of groups) {
    if (
      group.mode !== mode ||
      distanceMeters(group.startPoint, gap.startPoint) >
        ENDPOINT_TOLERANCE_METERS ||
      distanceMeters(group.endPoint, gap.endPoint) >
        ENDPOINT_TOLERANCE_METERS
    ) {
      continue;
    }
    const distance = endpointDistance(group, gap);
    if (distance < closestDistance) {
      closest = group;
      closestDistance = distance;
    }
  }
  return closest;
}

function createGroup(
  groups: TdxRouteReuseGroup[],
  gap: TimelineRepairGap,
  mode: TransportMode,
  route: CachedRoute,
): TdxRouteReuseGroup {
  const group = {
    mode,
    startPoint: gap.startPoint,
    endPoint: gap.endPoint,
    route,
  };
  groups.push(group);
  return group;
}

function endpointDistance(
  group: TdxRouteReuseGroup,
  gap: TimelineRepairGap,
): number {
  return (
    distanceMeters(group.startPoint, gap.startPoint) +
    distanceMeters(group.endPoint, gap.endPoint)
  );
}
