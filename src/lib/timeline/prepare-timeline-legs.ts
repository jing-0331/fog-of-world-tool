import type { TimelineLeg } from "@/lib/timeline/build-legs";
import { coalesceAdjacentTransitLegs } from "@/lib/timeline/coalesce-adjacent-transit-legs";

export function prepareTimelineLegs(
  legs: readonly TimelineLeg[],
): TimelineLeg[] {
  return coalesceAdjacentTransitLegs(legs);
}
