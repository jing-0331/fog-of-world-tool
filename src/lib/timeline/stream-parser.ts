import {
  JSONParser,
  Tokenizer,
  TokenType,
} from "@streamparser/json";

import { parseCoordinate } from "@/lib/timeline/parse-coordinate";
import {
  type NormalizedSemanticSegment,
  type RawSemanticSegment,
  type TimelineParseResult,
  rawSemanticSegmentSchema,
} from "@/lib/timeline/schema";

const PROGRESS_STEP = 0.02;
const VALID_TIME = /^\d{4}-\d{2}-\d{2}T/;

export type TimelineParseErrorCode = "malformed_json" | "unsupported_schema";

export class TimelineParseError extends Error {
  constructor(
    public readonly code: TimelineParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TimelineParseError";
  }
}

interface ParseTimelineOptions {
  totalBytes: number;
  onProgress?: (progress: number) => void;
}

export async function parseTimelineChunks(
  chunks: AsyncIterable<Uint8Array>,
  options: ParseTimelineOptions,
): Promise<TimelineParseResult> {
  const segments: NormalizedSemanticSegment[] = [];
  const invalid = { coordinates: 0, missingTime: 0, segments: 0 };
  const dates: string[] = [];
  const schemaDetector = createSchemaDetector();
  const parser = new JSONParser({
    paths: ["$.semanticSegments.*"],
    keepStack: false,
    stringBufferSize: 64 * 1024,
  });
  let segmentIndex = 0;
  let processedBytes = 0;
  let lastProgress = -1;

  parser.onValue = ({ value }) => {
    const parsed = rawSemanticSegmentSchema.safeParse(value);
    if (!parsed.success) {
      invalid.segments += 1;
      return;
    }

    const normalized = normalizeSegment(parsed.data, segmentIndex, invalid);
    segmentIndex += 1;
    if (normalized === null) {
      return;
    }

    segments.push(normalized);
    dates.push(localDate(normalized.startTime), localDate(normalized.endTime));
  };

  const reportProgress = (value: number, force = false) => {
    const bounded = Math.max(0, Math.min(1, value));
    if (
      options.onProgress &&
      (force ||
        lastProgress < 0 ||
        bounded - lastProgress >= PROGRESS_STEP)
    ) {
      lastProgress = bounded;
      options.onProgress(bounded);
    }
  };

  reportProgress(0, true);

  try {
    for await (const chunk of chunks) {
      schemaDetector.write(chunk);
      parser.write(chunk);
      processedBytes += chunk.byteLength;
      reportProgress(
        options.totalBytes > 0 ? processedBytes / options.totalBytes : 0,
      );
    }
    schemaDetector.end();
    if (!parser.isEnded) {
      parser.end();
    }
  } catch {
    throw new TimelineParseError(
      "malformed_json",
      "無法解析這個 JSON 檔案，請確認檔案完整且格式正確。",
    );
  }

  if (!schemaDetector.hasSemanticSegments) {
    throw new TimelineParseError(
      "unsupported_schema",
      "找不到 semanticSegments；目前僅支援新版 Google Timeline 匯出格式。",
    );
  }

  reportProgress(1, true);

  const sortedDates = dates.filter(Boolean).sort();
  return {
    segments,
    dateRange:
      sortedDates.length > 0
        ? {
            min: sortedDates[0],
            max: sortedDates[sortedDates.length - 1],
          }
        : null,
    invalid,
  };
}

export async function parseTimelineFile(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<TimelineParseResult> {
  const reader = file.stream().getReader();

  async function* fileChunks(): AsyncGenerator<Uint8Array> {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  return parseTimelineChunks(fileChunks(), {
    totalBytes: file.size,
    onProgress,
  });
}

function normalizeSegment(
  raw: RawSemanticSegment,
  index: number,
  invalid: TimelineParseResult["invalid"],
): NormalizedSemanticSegment | null {
  const startTime = validTime(raw.startTime) ? raw.startTime : null;
  const endTime = validTime(raw.endTime) ? raw.endTime : null;

  if (startTime === null) {
    invalid.missingTime += 1;
  }
  if (endTime === null) {
    invalid.missingTime += 1;
  }

  const timelinePath =
    raw.timelinePath?.flatMap((entry) => {
      const coordinateSource = entry.point ?? entry.latLng;
      const point = parseCoordinate(coordinateSource);
      const time = validTime(entry.time) ? entry.time : null;

      if (coordinateSource !== undefined && point === null) {
        invalid.coordinates += 1;
      }
      if (time === null) {
        invalid.missingTime += 1;
      }

      return point && time ? [{ ...point, time }] : [];
    }) ?? [];

  if (startTime === null || endTime === null) {
    invalid.segments += 1;
    return null;
  }

  const activityStart = parseOptionalCoordinate(
    raw.activity?.start,
    invalid,
  );
  const activityEnd = parseOptionalCoordinate(raw.activity?.end, invalid);
  const visitPoint = parseOptionalCoordinate(
    raw.visit?.topCandidate?.placeLocation,
    invalid,
  );
  const activityType = raw.activity?.topCandidate?.type;
  const visitType = raw.visit?.topCandidate?.semanticType;

  return {
    id: `${startTime}:${endTime}:${index}`,
    startTime,
    endTime,
    ...(activityType
      ? {
          activity: {
            type: activityType,
            ...(raw.activity?.topCandidate?.probability === undefined
              ? {}
              : { probability: raw.activity.topCandidate.probability }),
            ...(activityStart ? { startPoint: activityStart } : {}),
            ...(activityEnd ? { endPoint: activityEnd } : {}),
          },
        }
      : {}),
    ...(raw.visit
      ? {
          visit: {
            ...(visitType ? { type: visitType } : {}),
            ...(raw.visit.topCandidate?.probability === undefined
              ? {}
              : { probability: raw.visit.topCandidate.probability }),
            ...(visitPoint ? { point: visitPoint } : {}),
          },
        }
      : {}),
    timelinePath,
  };
}

function parseOptionalCoordinate(
  value: unknown,
  invalid: TimelineParseResult["invalid"],
) {
  if (value === undefined) {
    return undefined;
  }
  const point = parseCoordinate(value);
  if (point === null) {
    invalid.coordinates += 1;
    return undefined;
  }
  return point;
}

function validTime(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    VALID_TIME.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function localDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function createSchemaDetector() {
  let objectDepth = 0;
  let arrayDepth = 0;
  let candidateKey: string | null = null;
  let hasSemanticSegments = false;
  const tokenizer = new Tokenizer({ stringBufferSize: 64 * 1024 });

  tokenizer.onToken = ({ token, value }) => {
    if (
      token === TokenType.STRING &&
      objectDepth === 1 &&
      arrayDepth === 0
    ) {
      candidateKey = typeof value === "string" ? value : null;
      return;
    }
    if (
      token === TokenType.COLON &&
      objectDepth === 1 &&
      arrayDepth === 0 &&
      candidateKey === "semanticSegments"
    ) {
      hasSemanticSegments = true;
    }
    if (token === TokenType.LEFT_BRACE) {
      objectDepth += 1;
    } else if (token === TokenType.RIGHT_BRACE) {
      objectDepth -= 1;
    } else if (token === TokenType.LEFT_BRACKET) {
      arrayDepth += 1;
    } else if (token === TokenType.RIGHT_BRACKET) {
      arrayDepth -= 1;
    }
    if (token === TokenType.COMMA || token === TokenType.RIGHT_BRACE) {
      candidateKey = null;
    }
  };

  return {
    write(chunk: Uint8Array) {
      tokenizer.write(chunk);
    },
    end() {
      if (!tokenizer.isEnded) {
        tokenizer.end();
      }
    },
    get hasSemanticSegments() {
      return hasSemanticSegments;
    },
  };
}
