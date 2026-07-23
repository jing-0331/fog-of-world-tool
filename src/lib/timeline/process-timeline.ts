import type {
  GeoPoint,
  ProcessingReport,
  RouteSegment,
  TransportMode,
} from "@/lib/domain/types";
import { densifyPoints, interpolateRouteTimes } from "@/lib/geo/densify";
import { buildGpx } from "@/lib/gpx/build-gpx";
import { validateGpx } from "@/lib/gpx/validate-gpx";
import type {
  CachedRoute,
  StoredCorrection,
} from "@/lib/client/route-cache";
import type { RepairRouteResult } from "@/lib/routing/repair-route";
import { routePolicy } from "@/lib/routing/mode-policy";
import { asProviderError } from "@/lib/server/provider-error";
import type {
  TimelineLeg,
  TimelineRepairGap,
} from "@/lib/timeline/build-legs";
import { detectFlight } from "@/lib/timeline/detect-flight";
import {
  createProcessingReport,
  reportHasPartialResults,
} from "@/lib/timeline/report";

export interface TimelineProcessingDependencies {
  getCorrection: (
    gap: TimelineRepairGap,
  ) => Promise<StoredCorrection | null>;
  getCachedRoute: (
    gap: TimelineRepairGap,
    mode: TransportMode,
  ) => Promise<CachedRoute | null>;
  putCachedRoute: (
    gap: TimelineRepairGap,
    mode: TransportMode,
    route: CachedRoute,
  ) => Promise<void>;
  repair: (
    request: TimelineRepairGap & {
      mode: TransportMode;
      signal?: AbortSignal;
    },
  ) => Promise<RepairRouteResult>;
}

export type TimelineProgressStage =
  | "classification"
  | "repair"
  | "gpx"
  | "validation";

export interface TimelineProgress {
  stage: TimelineProgressStage;
  current: number;
  total: number;
  message: string;
}

interface ProcessTimelineOptions {
  signal?: AbortSignal;
  onProgress?: (progress: TimelineProgress) => void;
  invalidData?: ProcessingReport["invalidData"];
  name?: string;
}

export interface ProcessTimelineResult {
  segments: RouteSegment[];
  report: ProcessingReport;
  gpx: string | null;
  downloadable: boolean;
  partial: boolean;
  warning: string | null;
  canceled: boolean;
}

export async function processTimeline(
  legs: TimelineLeg[],
  dependencies: TimelineProcessingDependencies,
  options: ProcessTimelineOptions = {},
): Promise<ProcessTimelineResult> {
  const report = createProcessingReport({
    invalidData: options.invalidData,
  });
  const segments: RouteSegment[] = [];
  const gaps = legs
    .flatMap((leg) => leg.gaps.map((gap) => ({ leg, gap })))
    .sort(
      (left, right) =>
        left.gap.startTime.localeCompare(right.gap.startTime) ||
        left.gap.id.localeCompare(right.gap.id),
    );

  if (options.signal?.aborted) {
    return canceledResult(report);
  }
  options.onProgress?.({
    stage: "classification",
    current: legs.length,
    total: legs.length,
    message: `已分類 ${legs.length} 個時間軸路段。`,
  });

  for (const leg of [...legs].sort(compareLegs)) {
    if (leg.classification === "explicit-flight") {
      report.skippedFlights.push({
        segmentId: leg.id,
        message: "Google Timeline 明確標示為飛行，已切開軌跡且未繪製直線。",
        source: "google-timeline",
      });
      continue;
    }

    leg.recordedRuns.forEach((run, index) => {
      const segment = recordedSegment(leg, run, index);
      segments.push(segment);
      report.automaticSuccess.push({
        segmentId: segment.id,
        message: "保留 Google Timeline 實際記錄點。",
        source: "google-timeline",
      });
    });
  }

  for (let index = 0; index < gaps.length; index += 1) {
    if (options.signal?.aborted) {
      return canceledResult(report);
    }
    const { leg, gap } = gaps[index];
    options.onProgress?.({
      stage: "repair",
      current: index + 1,
      total: gaps.length,
      message: `修補路段 ${index + 1}/${gaps.length}`,
    });

    try {
      const correction = await dependencies.getCorrection(gap);
      if (options.signal?.aborted) {
        return canceledResult(report);
      }
      if (correction?.action === "exclude") {
        report.userExcluded.push({
          segmentId: gap.id,
          message: "使用者已確認此路段不存在。",
          source: "user",
        });
        continue;
      }

      const effectiveMode =
        correction?.action === "reroute" && correction.correctedMode
          ? correction.correctedMode
          : leg.mode;
      if (routePolicy(effectiveMode) === null) {
        report.unresolved.push({
          segmentId: gap.id,
          message: `交通方式 ${effectiveMode} 沒有可安全自動選擇的路線來源。`,
        });
        continue;
      }

      const cached = await dependencies.getCachedRoute(gap, effectiveMode);
      if (options.signal?.aborted) {
        return canceledResult(report);
      }
      let route: CachedRoute | RepairRouteResult;
      let attempts: RepairRouteResult["attempts"] = [];
      if (cached) {
        route = cached;
      } else {
        const repaired = await dependencies.repair({
          ...gap,
          mode: effectiveMode,
          signal: options.signal,
        });
        route = repaired;
        attempts = repaired.attempts;
      }
      if (options.signal?.aborted) {
        return canceledResult(report);
      }
      if (cached === null) {
        await dependencies.putCachedRoute(gap, effectiveMode, {
          points: route.points,
          provenance: route.provenance,
        });
      }

      const userCorrected =
        correction?.action === "reroute" &&
        correction.correctedMode !== undefined;
      const provenance = userCorrected
        ? {
            ...route.provenance,
            originalMode: leg.mode,
            correctedMode: effectiveMode,
            userOverride: true,
          }
        : route.provenance;
      const segment: RouteSegment = {
        id: `${gap.id}:repair`,
        name: `時間軸修補 ${index + 1}`,
        mode: effectiveMode,
        points: normalizePoints(route.points, gap.startTime, gap.endTime),
        provenance,
      };
      segments.push(segment);
      report.providerAttempts.push(...attempts);
      const target = userCorrected
        ? report.userCorrectedSuccess
        : report.automaticSuccess;
      target.push({
        segmentId: segment.id,
        message: userCorrected
          ? "依使用者修正的交通方式完成路線修補。"
          : "已自動修補時間軸缺口。",
        source: segment.provenance.source,
      });
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        return canceledResult(report);
      }

      const providerError = asProviderError(error);
      const policy = routePolicy(leg.mode);
      if (policy) {
        report.providerAttempts.push({
          source: policy.provider,
          status: "failed",
          code: providerError.code,
          message: providerError.message,
          retryable: providerError.retryable,
        });
      }
      const flight = detectFlight({
        mode: leg.mode,
        distanceMeters: gap.distanceMeters,
        elapsedMilliseconds: gap.elapsedMilliseconds,
        landOrTransitRoutingFailed: true,
      });
      if (flight === "probable") {
        report.skippedFlights.push({
          segmentId: gap.id,
          message:
            "高距離與速度且地面／運輸查詢失敗，可能是飛行；已切開軌跡供人工確認。",
        });
      } else {
        report.unresolved.push({
          segmentId: gap.id,
          message: `所有可用路線來源均失敗：${providerError.message}`,
        });
      }
    }
  }

  const normalizedSegments = segments
    .map((segment) => ({
      ...segment,
      points: normalizePoints(
        segment.points,
        segment.points[0]?.time ?? legs[0]?.startTime ?? new Date(0).toISOString(),
        segment.points.at(-1)?.time ??
          legs[0]?.endTime ??
          new Date(0).toISOString(),
      ),
    }))
    .sort(compareSegments);
  if (normalizedSegments.length === 0) {
    return completeResult(normalizedSegments, report, null, false);
  }

  options.onProgress?.({
    stage: "gpx",
    current: 1,
    total: 1,
    message: "建立 GPX。",
  });
  const gpx = buildGpx({
    name: options.name ?? "Fog of World Timeline",
    segments: normalizedSegments,
    report: {
      unresolvedCount: report.unresolved.length,
      excludedCount: report.userExcluded.length,
      skippedFlightCount: report.skippedFlights.length,
    },
  });
  options.onProgress?.({
    stage: "validation",
    current: 1,
    total: 1,
    message: "驗證 GPX。",
  });
  const validation = validateGpx(gpx);
  if (!validation.valid) {
    validation.errors.forEach((message, index) => {
      report.invalidData.push({
        segmentId: `gpx-validation-${index}`,
        message,
      });
    });
    return completeResult(normalizedSegments, report, null, false);
  }

  return completeResult(normalizedSegments, report, gpx, true);
}

function recordedSegment(
  leg: TimelineLeg,
  points: GeoPoint[],
  index: number,
): RouteSegment {
  return {
    id: `${leg.id}:recorded:${index}`,
    name: `Google Timeline 記錄 ${index + 1}`,
    mode: leg.mode,
    points: normalizePoints(points, leg.startTime, leg.endTime),
    provenance: {
      kind: "recorded-timeline",
      source: "google-timeline",
      referenceDate: leg.startTime.slice(0, 10),
      approximate: false,
      explanation: "Google Timeline 匯出檔中的實際記錄點。",
      originalMode: leg.mode,
    },
  };
}

function normalizePoints(
  points: GeoPoint[],
  startTime: string,
  endTime: string,
): GeoPoint[] {
  return densifyPoints(
    interpolateRouteTimes(points, startTime, endTime),
    { maxDistanceMeters: 2_000 },
  );
}

function compareLegs(left: TimelineLeg, right: TimelineLeg): number {
  return (
    left.startTime.localeCompare(right.startTime) ||
    left.id.localeCompare(right.id)
  );
}

function compareSegments(left: RouteSegment, right: RouteSegment): number {
  return (
    (left.points[0]?.time ?? "").localeCompare(
      right.points[0]?.time ?? "",
    ) || left.id.localeCompare(right.id)
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function canceledResult(report: ProcessingReport): ProcessTimelineResult {
  return {
    segments: [],
    report,
    gpx: null,
    downloadable: false,
    partial: false,
    warning: null,
    canceled: true,
  };
}

function completeResult(
  segments: RouteSegment[],
  report: ProcessingReport,
  gpx: string | null,
  downloadable: boolean,
): ProcessTimelineResult {
  const partial = reportHasPartialResults(report);
  return {
    segments,
    report,
    gpx,
    downloadable,
    partial,
    warning:
      partial && downloadable
        ? "部分路段未能加入 GPX；下載前請查看處理報告。"
        : null,
    canceled: false,
  };
}
