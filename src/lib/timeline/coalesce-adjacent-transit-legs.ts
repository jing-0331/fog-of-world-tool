import { distanceMeters } from "@/lib/geo/distance";
import { modeFamily } from "@/lib/routing/mode-policy";
import type {
  TimelineLeg,
  TimelineRepairGap,
} from "@/lib/timeline/build-legs";

const TRANSIT_COALESCE_INTERVAL_MILLISECONDS = 180_000;

export function coalesceAdjacentTransitLegs(
  legs: readonly TimelineLeg[],
): TimelineLeg[] {
  const coalesced: TimelineLeg[] = [];

  for (const leg of legs) {
    const current = coalesced.at(-1);
    if (current && canCoalesce(current, leg)) {
      coalesced[coalesced.length - 1] = mergeLegs(current, leg);
    } else {
      coalesced.push(leg);
    }
  }

  return coalesced;
}

function canCoalesce(
  current: TimelineLeg,
  next: TimelineLeg,
): boolean {
  return (
    current.mode === next.mode &&
    modeFamily(current.mode) === "public-transit" &&
    Date.parse(next.startTime) - Date.parse(current.endTime) <
      TRANSIT_COALESCE_INTERVAL_MILLISECONDS
  );
}

function mergeLegs(
  first: TimelineLeg,
  last: TimelineLeg,
): TimelineLeg {
  const startPoint = first.points[0];
  const endPoint = last.points.at(-1)!;
  const id = `coalesced:${first.id}:${last.id}`;
  const gap: TimelineRepairGap = {
    id: `${id}:gap`,
    mode: first.mode,
    startPoint,
    endPoint,
    startTime: first.startTime,
    endTime: last.endTime,
    distanceMeters: distanceMeters(startPoint, endPoint),
    elapsedMilliseconds: Math.max(
      0,
      Date.parse(last.endTime) - Date.parse(first.startTime),
    ),
  };

  return {
    ...first,
    id,
    endTime: last.endTime,
    points: [startPoint, endPoint],
    recordedRuns: [],
    gaps: [gap],
    unmatched: first.unmatched || last.unmatched,
  };
}
