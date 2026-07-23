import type { GeoPoint, TransportMode } from "@/lib/domain/types";
import { distanceMeters } from "@/lib/geo/distance";
import { activityMode } from "@/lib/timeline/activity-mode";
import type {
  NormalizedSemanticSegment,
  NormalizedTimelinePathPoint,
} from "@/lib/timeline/schema";

const MAX_RECORDED_DISTANCE_METERS = 2_000;

export interface TimelineRepairGap {
  id: string;
  mode: TransportMode;
  startPoint: GeoPoint;
  endPoint: GeoPoint;
  startTime: string;
  endTime: string;
  distanceMeters: number;
  elapsedMilliseconds: number;
}

export interface TimelineLeg {
  id: string;
  sourceSegmentId: string;
  mode: TransportMode;
  startTime: string;
  endTime: string;
  probability?: number;
  points: GeoPoint[];
  recordedRuns: GeoPoint[][];
  gaps: TimelineRepairGap[];
  classification: "route" | "explicit-flight";
  unmatched: boolean;
}

interface IndexedPathPoint extends NormalizedTimelinePathPoint {
  pathId: string;
  sourceSegmentId: string;
}

export function buildTimelineLegs(
  segments: NormalizedSemanticSegment[],
): TimelineLeg[] {
  const allPathPoints = segments.flatMap((segment) =>
    segment.timelinePath.map((point, index) => ({
      ...point,
      pathId: `${segment.id}:${index}`,
      sourceSegmentId: segment.id,
    })),
  );
  const usedPathIds = new Set<string>();
  const legs: TimelineLeg[] = [];

  for (const segment of segments) {
    if (!segment.activity) {
      continue;
    }

    const overlapping = deduplicatePoints(
      allPathPoints.filter(
        (point) =>
          point.time >= segment.startTime && point.time <= segment.endTime,
      ),
    );
    for (const point of allPathPoints) {
      if (
        point.time >= segment.startTime &&
        point.time <= segment.endTime
      ) {
        usedPathIds.add(point.pathId);
      }
    }

    const endpointPoints = activityEndpointPoints(segment);
    const points =
      overlapping.length >= 2
        ? overlapping.map(stripPathMetadata)
        : endpointPoints;
    if (points.length < 2) {
      continue;
    }

    legs.push(
      createLeg({
        sourceSegmentId: segment.id,
        mode: activityMode(segment.activity.type),
        startTime: segment.startTime,
        endTime: segment.endTime,
        points,
        probability: segment.activity.probability,
        unmatched: false,
      }),
    );
  }

  for (const segment of segments) {
    const unmatched = deduplicatePoints(
      allPathPoints.filter(
        (point) =>
          point.sourceSegmentId === segment.id &&
          !usedPathIds.has(point.pathId),
      ),
    ).map(stripPathMetadata);
    if (unmatched.length < 2) {
      continue;
    }

    legs.push(
      createLeg({
        sourceSegmentId: segment.id,
        mode: "unknown",
        startTime: unmatched[0].time!,
        endTime: unmatched.at(-1)!.time!,
        points: unmatched,
        unmatched: true,
      }),
    );
  }

  return legs.sort(
    (left, right) =>
      left.startTime.localeCompare(right.startTime) ||
      left.id.localeCompare(right.id),
  );
}

function createLeg(input: {
  sourceSegmentId: string;
  mode: TransportMode;
  startTime: string;
  endTime: string;
  points: GeoPoint[];
  probability?: number;
  unmatched: boolean;
}): TimelineLeg {
  const points = deduplicateGeoPoints(input.points);
  const id = deterministicId(
    input.startTime,
    input.endTime,
    points[0],
    points.at(-1)!,
  );

  if (input.mode === "flying") {
    return {
      id,
      sourceSegmentId: input.sourceSegmentId,
      mode: input.mode,
      startTime: input.startTime,
      endTime: input.endTime,
      ...(input.probability === undefined
        ? {}
        : { probability: input.probability }),
      points,
      recordedRuns: [],
      gaps: [],
      classification: "explicit-flight",
      unmatched: input.unmatched,
    };
  }

  const recordedRuns: GeoPoint[][] = [];
  const gaps: TimelineRepairGap[] = [];
  let currentRun = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const startPoint = points[index - 1];
    const endPoint = points[index];
    const gapDistance = distanceMeters(startPoint, endPoint);

    if (gapDistance <= MAX_RECORDED_DISTANCE_METERS) {
      currentRun.push(endPoint);
      continue;
    }

    if (currentRun.length >= 2) {
      recordedRuns.push(currentRun);
    }
    gaps.push({
      id: `${id}:gap:${index - 1}`,
      mode: input.mode,
      startPoint,
      endPoint,
      startTime: startPoint.time ?? input.startTime,
      endTime: endPoint.time ?? input.endTime,
      distanceMeters: gapDistance,
      elapsedMilliseconds: Math.max(
        0,
        Date.parse(endPoint.time ?? input.endTime) -
          Date.parse(startPoint.time ?? input.startTime),
      ),
    });
    currentRun = [endPoint];
  }

  if (currentRun.length >= 2) {
    recordedRuns.push(currentRun);
  }

  return {
    id,
    sourceSegmentId: input.sourceSegmentId,
    mode: input.mode,
    startTime: input.startTime,
    endTime: input.endTime,
    ...(input.probability === undefined
      ? {}
      : { probability: input.probability }),
    points,
    recordedRuns,
    gaps,
    classification: "route",
    unmatched: input.unmatched,
  };
}

function activityEndpointPoints(
  segment: NormalizedSemanticSegment,
): GeoPoint[] {
  const start = segment.activity?.startPoint;
  const end = segment.activity?.endPoint;
  return start && end
    ? [
        { ...start, time: segment.startTime },
        { ...end, time: segment.endTime },
      ]
    : [];
}

function deduplicatePoints<T extends NormalizedTimelinePathPoint>(
  points: T[],
): T[] {
  const seen = new Set<string>();
  return [...points]
    .sort((left, right) => left.time.localeCompare(right.time))
    .filter((point) => {
      const key = `${point.time}:${point.lat.toFixed(7)}:${point.lon.toFixed(7)}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function deduplicateGeoPoints(points: GeoPoint[]): GeoPoint[] {
  const seen = new Set<string>();
  return [...points]
    .sort((left, right) => (left.time ?? "").localeCompare(right.time ?? ""))
    .filter((point) => {
      const key = `${point.time ?? ""}:${point.lat.toFixed(7)}:${point.lon.toFixed(7)}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function stripPathMetadata(point: IndexedPathPoint): GeoPoint {
  return { lat: point.lat, lon: point.lon, time: point.time };
}

function deterministicId(
  startTime: string,
  endTime: string,
  start: GeoPoint,
  end: GeoPoint,
): string {
  return [
    startTime,
    endTime,
    roundedPoint(start),
    roundedPoint(end),
  ].join("|");
}

function roundedPoint(point: GeoPoint): string {
  return `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
}
