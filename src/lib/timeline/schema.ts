import { z } from "zod";

import type { GeoPoint } from "@/lib/domain/types";

const activitySchema = z
  .object({
    start: z.unknown().optional(),
    end: z.unknown().optional(),
    topCandidate: z
      .object({
        type: z.string().optional(),
        probability: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const visitSchema = z
  .object({
    topCandidate: z
      .object({
        semanticType: z.string().optional(),
        probability: z.number().optional(),
        placeLocation: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const timelinePathPointSchema = z
  .object({
    point: z.unknown().optional(),
    latLng: z.unknown().optional(),
    time: z.string().optional(),
  })
  .passthrough();

export const rawSemanticSegmentSchema = z
  .object({
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    activity: activitySchema.optional(),
    visit: visitSchema.optional(),
    timelinePath: z.array(timelinePathPointSchema).optional(),
  })
  .passthrough();

export type RawSemanticSegment = z.infer<typeof rawSemanticSegmentSchema>;

export interface NormalizedTimelinePathPoint extends GeoPoint {
  time: string;
}

export interface NormalizedSemanticSegment {
  id: string;
  startTime: string;
  endTime: string;
  activity?: {
    type: string;
    probability?: number;
    startPoint?: GeoPoint;
    endPoint?: GeoPoint;
  };
  visit?: {
    type?: string;
    probability?: number;
    point?: GeoPoint;
  };
  timelinePath: NormalizedTimelinePathPoint[];
}

export interface TimelineParseResult {
  segments: NormalizedSemanticSegment[];
  dateRange: {
    min: string;
    max: string;
  } | null;
  invalid: {
    coordinates: number;
    missingTime: number;
    segments: number;
  };
}
