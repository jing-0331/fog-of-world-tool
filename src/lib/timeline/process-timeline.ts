import type {
  GeoPoint,
  ProcessingReport,
  RouteSegment,
  TransportMode,
} from "@/lib/domain/types";
import { densifyPoints, interpolateRouteTimes } from "@/lib/geo/densify";
import { distanceMeters } from "@/lib/geo/distance";
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

export interface TimelineProgress {
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

export const TIMELINE_CONTIGUOUS_TIME_TOLERANCE_MS = 60_000;
export const TIMELINE_CONTIGUOUS_ENDPOINT_TOLERANCE_METERS = 100;

interface ProcessedGap {
  leg: TimelineLeg;
  gap: TimelineRepairGap;
  effectiveMode: TransportMode | null;
  groupable: boolean;
  repairFailed: boolean;
  segmentId?: string;
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
  const processedGaps: ProcessedGap[] = [];
  const completedGapIds = new Set<string>();
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
  const reportProgress = (message: string) => {
    options.onProgress?.({
      current: completedGapIds.size,
      total: gaps.length,
      message,
    });
  };
  reportProgress(`已完成 0/${gaps.length}`);

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
    let effectiveMode = defaultRepairMode(leg.mode, gap.distanceMeters);
    let groupable = false;
    let providerRepairStarted = false;
    let providerRepairCompleted = false;
    reportProgress(`正在處理路段 ${index + 1}/${gaps.length}`);

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
        processedGaps.push({
          leg,
          gap,
          effectiveMode: null,
          groupable: false,
          repairFailed: false,
        });
        completedGapIds.add(gap.id);
        reportProgress(`已完成 ${completedGapIds.size}/${gaps.length}`);
        continue;
      }

      effectiveMode =
        correction?.action === "reroute" && correction.correctedMode
          ? correction.correctedMode
          : defaultRepairMode(leg.mode, gap.distanceMeters);
      groupable = correction === null;
      if (routePolicy(effectiveMode) === null) {
        report.unresolved.push({
          segmentId: gap.id,
          message: `交通方式 ${effectiveMode} 沒有可安全自動選擇的路線來源。`,
        });
        processedGaps.push({
          leg,
          gap,
          effectiveMode,
          groupable: false,
          repairFailed: false,
        });
        reportProgress(
          `路段 ${index + 1} 需要人工確認；已完成 ${completedGapIds.size}/${gaps.length}`,
        );
        continue;
      }

      const savedRoute =
        correction?.action === "reroute"
          ? correction.normalizedRoute
          : undefined;
      const cached =
        savedRoute ?? (await dependencies.getCachedRoute(gap, effectiveMode));
      if (options.signal?.aborted) {
        return canceledResult(report);
      }
      let route: CachedRoute | RepairRouteResult;
      let attempts: RepairRouteResult["attempts"] = [];
      if (cached) {
        route = cached;
      } else {
        providerRepairStarted = true;
        const repaired = await dependencies.repair({
          ...gap,
          mode: effectiveMode,
          signal: options.signal,
        });
        providerRepairCompleted = true;
        route = repaired;
        attempts = repaired.attempts;
      }
      if (options.signal?.aborted) {
        return canceledResult(report);
      }
      if (!savedRoute && cached === null) {
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
      report.providerAttempts.push(
        ...attempts.map((attempt) => ({
          ...attempt,
          segmentId: gap.id,
        })),
      );
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
      processedGaps.push({
        leg,
        gap,
        effectiveMode,
        groupable,
        repairFailed: false,
        segmentId: segment.id,
      });
      completedGapIds.add(gap.id);
      reportProgress(`已完成 ${completedGapIds.size}/${gaps.length}`);
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        return canceledResult(report);
      }

      const providerError = asProviderError(error);
      const policy = routePolicy(
        effectiveMode,
        gap.startPoint,
        gap.endPoint,
      );
      if (policy) {
        report.providerAttempts.push({
          segmentId: gap.id,
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
      processedGaps.push({
        leg,
        gap,
        effectiveMode,
        groupable:
          groupable && providerRepairStarted && !providerRepairCompleted,
        repairFailed: providerRepairStarted && !providerRepairCompleted,
      });
      reportProgress(
        `路段 ${index + 1} 需要人工確認；已完成 ${completedGapIds.size}/${gaps.length}`,
      );
    }
  }

  const mergedRetry = await retryContiguousGapGroups(
    processedGaps,
    segments,
    report,
    dependencies,
    (resolvedGapIds) => {
      resolvedGapIds.forEach((gapId) => completedGapIds.add(gapId));
      reportProgress(`已完成 ${completedGapIds.size}/${gaps.length}`);
    },
    options.signal,
  );
  if (mergedRetry === "canceled") {
    return canceledResult(report);
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
    current: completedGapIds.size,
    total: gaps.length,
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
    current: completedGapIds.size,
    total: gaps.length,
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

function defaultRepairMode(
  mode: TransportMode,
  gapDistanceMeters: number,
): TransportMode {
  if (mode !== "unknown") {
    return mode;
  }
  if (gapDistanceMeters < 2_000) {
    return "walking";
  }
  if (gapDistanceMeters <= 5_000) {
    return "motorcycling";
  }
  return "driving";
}

async function retryContiguousGapGroups(
  processedGaps: ProcessedGap[],
  segments: RouteSegment[],
  report: ProcessingReport,
  dependencies: TimelineProcessingDependencies,
  onResolved: (gapIds: string[]) => void,
  signal?: AbortSignal,
): Promise<"completed" | "canceled"> {
  for (const group of contiguousGapGroups(processedGaps)) {
    if (
      group.length < 2 ||
      !group.some((item) => item.repairFailed)
    ) {
      continue;
    }
    if (signal?.aborted) {
      return "canceled";
    }

    const first = group[0];
    const last = group.at(-1)!;
    const mode = first.effectiveMode!;
    const mergedGap: TimelineRepairGap = {
      id: `merged:${first.gap.id}:${last.gap.id}`,
      mode,
      startPoint: first.gap.startPoint,
      endPoint: last.gap.endPoint,
      startTime: first.gap.startTime,
      endTime: last.gap.endTime,
      distanceMeters: distanceMeters(
        first.gap.startPoint,
        last.gap.endPoint,
      ),
      elapsedMilliseconds: Math.max(
        0,
        Date.parse(last.gap.endTime) - Date.parse(first.gap.startTime),
      ),
    };

    try {
      const cached = await dependencies.getCachedRoute(mergedGap, mode);
      if (signal?.aborted) {
        return "canceled";
      }

      let route: CachedRoute | RepairRouteResult;
      let attempts: RepairRouteResult["attempts"] = [];
      if (cached) {
        route = cached;
      } else {
        const repaired = await dependencies.repair({
          ...mergedGap,
          signal,
        });
        route = repaired;
        attempts = repaired.attempts;
      }
      if (signal?.aborted) {
        return "canceled";
      }
      if (cached === null) {
        await dependencies.putCachedRoute(mergedGap, mode, {
          points: route.points,
          provenance: route.provenance,
        });
      }
      if (signal?.aborted) {
        return "canceled";
      }

      const replacedSegmentIds = new Set(
        group.flatMap((item) =>
          item.segmentId === undefined ? [] : [item.segmentId],
        ),
      );
      removeSegments(segments, replacedSegmentIds);
      report.automaticSuccess = report.automaticSuccess.filter(
        (item) => !replacedSegmentIds.has(item.segmentId),
      );
      report.userCorrectedSuccess = report.userCorrectedSuccess.filter(
        (item) => !replacedSegmentIds.has(item.segmentId),
      );

      const groupedGapIds = new Set(group.map((item) => item.gap.id));
      report.unresolved = report.unresolved.filter(
        (item) => !groupedGapIds.has(item.segmentId),
      );
      report.skippedFlights = report.skippedFlights.filter(
        (item) => !groupedGapIds.has(item.segmentId),
      );
      report.providerAttempts.push(
        ...attempts.map((attempt) => ({
          ...attempt,
          segmentId: mergedGap.id,
        })),
      );

      const mergedSegment: RouteSegment = {
        id: `${mergedGap.id}:repair`,
        name: "合併修補路徑",
        mode,
        points: normalizePoints(
          route.points,
          mergedGap.startTime,
          mergedGap.endTime,
        ),
        provenance: route.provenance,
      };
      segments.push(mergedSegment);
      report.automaticSuccess.push({
        segmentId: mergedSegment.id,
        message: "已使用整組端點完成合併修補。",
        source: mergedSegment.provenance.source,
      });
      onResolved(group.map((item) => item.gap.id));
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return "canceled";
      }
      const providerError = asProviderError(error);
      const policy = routePolicy(
        mode,
        mergedGap.startPoint,
        mergedGap.endPoint,
      );
      if (policy) {
        report.providerAttempts.push({
          segmentId: mergedGap.id,
          source: policy.provider,
          status: "failed",
          code: providerError.code,
          message: providerError.message,
          retryable: providerError.retryable,
        });
      }
    }
  }
  return "completed";
}

function contiguousGapGroups(
  processedGaps: ProcessedGap[],
): ProcessedGap[][] {
  const groups: ProcessedGap[][] = [];
  let current: ProcessedGap[] = [];

  const flush = () => {
    if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  };

  for (const item of processedGaps) {
    if (!item.groupable || item.effectiveMode === null) {
      flush();
      continue;
    }
    const previous = current.at(-1);
    if (
      previous === undefined ||
      (previous.effectiveMode === item.effectiveMode &&
        gapsAreContiguous(previous.gap, item.gap))
    ) {
      current.push(item);
    } else {
      flush();
      current.push(item);
    }
  }
  flush();
  return groups;
}

function gapsAreContiguous(
  previous: TimelineRepairGap,
  next: TimelineRepairGap,
): boolean {
  const timeDelta = Math.abs(
    Date.parse(next.startTime) - Date.parse(previous.endTime),
  );
  return (
    Number.isFinite(timeDelta) &&
    timeDelta <= TIMELINE_CONTIGUOUS_TIME_TOLERANCE_MS &&
    distanceMeters(previous.endPoint, next.startPoint) <=
      TIMELINE_CONTIGUOUS_ENDPOINT_TOLERANCE_METERS + 1e-6
  );
}

function removeSegments(
  segments: RouteSegment[],
  segmentIds: Set<string>,
): void {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segmentIds.has(segments[index].id)) {
      segments.splice(index, 1);
    }
  }
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
