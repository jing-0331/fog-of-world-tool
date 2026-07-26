import type { TimelineLeg } from "@/lib/timeline/build-legs";

export function prepareTimelineLegs(
  legs: readonly TimelineLeg[],
): TimelineLeg[] {
  return [...legs];
}
