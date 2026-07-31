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

  for (const originalLeg of legs) {
    const leg =
      modeFamily(originalLeg.mode) === "public-transit" &&
      hasMultipleContiguousGaps(originalLeg)
        ? mergeLegs(originalLeg, originalLeg)
        : originalLeg;
    const current = coalesced.at(-1);
    if (current && canCoalesce(current, leg)) {
      coalesced[coalesced.length - 1] = mergeLegs(current, leg);
    } else {
      coalesced.push(leg);
    }
  }

  return coalesced;
}

function hasMultipleContiguousGaps(leg: TimelineLeg): boolean {
  return (
    leg.gaps.length > 1 &&
    leg.gaps.every(
      (gap) =>
        legContainsPoint(leg, gap.startPoint) &&
        legContainsPoint(leg, gap.endPoint),
    ) &&
    leg.gaps.slice(1).every((gap, index) => {
      const previous = leg.gaps[index];
      return (
        gap.startTime === previous.endTime &&
        distanceMeters(previous.endPoint, gap.startPoint) <= 1e-6
      );
    })
  );
}

function legContainsPoint(
  leg: TimelineLeg,
  candidate: TimelineRepairGap["startPoint"],
): boolean {
  return leg.points.some(
    (point) =>
      point.time === candidate.time &&
      distanceMeters(point, candidate) <= 1e-6,
  );
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
