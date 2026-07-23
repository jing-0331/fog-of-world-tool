import type {
  NormalizedSemanticSegment,
  TimelineParseResult,
} from "@/lib/timeline/schema";

export interface TimelineDateSelection {
  startDate: string;
  endDate: string;
}

export class TimelineDateRangeError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "TimelineDateRangeError";
  }
}

export function discoverTimelineDateRange(
  segments: NormalizedSemanticSegment[],
): NonNullable<TimelineParseResult["dateRange"]> | null {
  const dates = segments
    .flatMap((segment) => [
      embeddedLocalDate(segment.startTime),
      embeddedLocalDate(segment.endTime),
    ])
    .sort();

  return dates.length > 0
    ? { min: dates[0], max: dates[dates.length - 1] }
    : null;
}

export function selectTimelineDateRange(
  segments: NormalizedSemanticSegment[],
  selection: TimelineDateSelection,
): NormalizedSemanticSegment[] {
  const available = discoverTimelineDateRange(segments);
  if (available === null) {
    throw new TimelineDateRangeError("時間軸沒有可選擇的日期。");
  }
  if (selection.startDate > selection.endDate) {
    throw new TimelineDateRangeError("開始日期不得晚於結束日期。");
  }
  if (
    selection.startDate < available.min ||
    selection.endDate > available.max
  ) {
    throw new TimelineDateRangeError(
      `日期必須介於 ${available.min} 與 ${available.max} 之間。`,
    );
  }

  return segments.filter((segment) => {
    const segmentStart = embeddedLocalDate(segment.startTime);
    const segmentEnd = embeddedLocalDate(segment.endTime);
    return (
      segmentEnd >= selection.startDate &&
      segmentStart <= selection.endDate
    );
  });
}

export function embeddedLocalDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}
