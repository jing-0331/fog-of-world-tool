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
import { prepareTimelineLegs } from "@/lib/timeline/prepare-timeline-legs";
import {
  createProcessingReport,
  reportHasPartialResults,
} from "@/lib/timeline/report";
import {
  createRouteScheduler,
  type RouteScheduler,
} from "@/lib/timeline/route-scheduler";
import type {
  AutomaticLane,
  PersistedReviewDecision,
  ReviewDecision,
  ReviewQueueItem,
  RoutingJob,
} from "@/lib/timeline/route-job";
import { createTdxRouteReuse } from "@/lib/timeline/tdx-route-reuse";

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
  persistReviewDecision?: (
    decision: PersistedReviewDecision,
  ) => Promise<void>;
}

export interface TimelineProgress {
  current: number;
  total: number;
  message: string;
}

export interface ProcessTimelineOptions {
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

export type TimelineProcessingEvent =
  | {
      type: "route-succeeded";
      gapId: string;
      lane: AutomaticLane;
    }
  | { type: "review-enqueued"; item: ReviewQueueItem }
  | { type: "review-removed"; gapId: string }
  | { type: "progress"; progress: TimelineProgress };

export interface TimelineProcessingSession {
  automaticDone: Promise<ProcessTimelineResult>;
  finished: Promise<ProcessTimelineResult>;
  submitReview(decision: ReviewDecision): Promise<void>;
  subscribe(
    listener: (event: TimelineProcessingEvent) => void,
  ): () => void;
  cancel(): void;
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

interface PreparedGap {
  index: number;
  leg: TimelineLeg;
  gap: TimelineRepairGap;
  correction: StoredCorrection | null;
  effectiveMode: TransportMode;
  cachedRoute: CachedRoute | null;
  preparationError?: unknown;
  lane: AutomaticLane;
}

interface TimelineProcessingHooks {
  onProgress?(progress: TimelineProgress): void;
  onRouteSucceeded?(gapId: string, lane: AutomaticLane): void;
  onReviewEnqueued?(item: ReviewQueueItem): void;
  onReviewRemoved?(gapId: string): void;
}

interface TimelineProcessingRuntime {
  scheduler: RouteScheduler;
  tdxRouteReuse: ReturnType<typeof createTdxRouteReuse>;
  hooks?: TimelineProcessingHooks;
}

export function startTimelineProcessing(
  legs: TimelineLeg[],
  dependencies: TimelineProcessingDependencies,
  options: ProcessTimelineOptions = {},
): TimelineProcessingSession {
  const listeners = new Set<
    (event: TimelineProcessingEvent) => void
  >();
  const reviews = new Map<string, ReviewQueueItem>();
  const corrections = new Map<string, StoredCorrection>();
  const controller = new AbortController();
  let automaticResult: ProcessTimelineResult | null = null;
  let activeManualJobs = 0;
  let canceled = false;
  let needsFinalRerun = false;
  let finishing = false;
  let resolveFinished!: (result: ProcessTimelineResult) => void;
  let rejectFinished!: (reason?: unknown) => void;
  const finished = new Promise<ProcessTimelineResult>(
    (resolve, reject) => {
      resolveFinished = resolve;
      rejectFinished = reject;
    },
  );

  const emit = (event: TimelineProcessingEvent) => {
    listeners.forEach((listener) => listener(event));
  };
  const removeReview = (gapId: string) => {
    if (reviews.delete(gapId)) {
      emit({ type: "review-removed", gapId });
    }
  };
  const hooks: TimelineProcessingHooks = {
    onProgress(progress) {
      emit({ type: "progress", progress });
    },
    onRouteSucceeded(gapId, lane) {
      emit({ type: "route-succeeded", gapId, lane });
    },
    onReviewEnqueued(item) {
      if (!reviews.has(item.gap.id)) {
        reviews.set(item.gap.id, item);
        emit({ type: "review-enqueued", item });
      }
    },
    onReviewRemoved: removeReview,
  };
  const sessionDependencies: TimelineProcessingDependencies = {
    ...dependencies,
    async getCorrection(gap) {
      return (
        corrections.get(gap.id) ??
        (await dependencies.getCorrection(gap))
      );
    },
  };
  const runtime = createTimelineProcessingRuntime(
    sessionDependencies,
    hooks,
  );
  const processingOptions: ProcessTimelineOptions = {
    ...options,
    signal: controller.signal,
  };

  const canceledSessionResult = (): ProcessTimelineResult => {
    const base =
      automaticResult ??
      canceledResult(
        createProcessingReport({ invalidData: options.invalidData }),
      );
    return {
      ...base,
      gpx: null,
      downloadable: false,
      canceled: true,
    };
  };
  const finishIfReady = () => {
    if (
      finishing ||
      automaticResult === null ||
      activeManualJobs > 0
    ) {
      return;
    }
    if (canceled) {
      finishing = true;
      resolveFinished(canceledSessionResult());
      return;
    }
    if (reviews.size > 0) {
      return;
    }
    finishing = true;
    if (!needsFinalRerun) {
      resolveFinished(automaticResult);
      return;
    }
    void runTimelineProcessing(
      legs,
      sessionDependencies,
      processingOptions,
      runtime,
    ).then(resolveFinished, rejectFinished);
  };

  const automaticDone = runTimelineProcessing(
    legs,
    sessionDependencies,
    processingOptions,
    runtime,
  ).then(
    (result) => {
      automaticResult = result;
      finishIfReady();
      return result;
    },
    (error) => {
      rejectFinished(error);
      throw error;
    },
  );

  const cancel = () => {
    if (canceled) {
      return;
    }
    canceled = true;
    const reason = new DOMException(
      "The operation was aborted.",
      "AbortError",
    );
    controller.abort(reason);
    runtime.scheduler.cancel(reason);
    finishIfReady();
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) {
    cancel();
  }

  return {
    automaticDone,
    finished,

    async submitReview(decision) {
      if (canceled) {
        throw new DOMException(
          "The operation was aborted.",
          "AbortError",
        );
      }
      const item = reviews.get(decision.gapId);
      if (!item) {
        throw new Error(`找不到待人工確認路段：${decision.gapId}`);
      }

      activeManualJobs += 1;
      try {
        if (decision.action === "exclude") {
          const persisted: PersistedReviewDecision = {
            gapId: item.gap.id,
            action: "exclude",
            originalMode: item.originalMode,
          };
          await dependencies.persistReviewDecision?.(persisted);
          corrections.set(item.gap.id, {
            gapId: item.gap.id,
            action: "exclude",
            originalMode: item.originalMode,
            updatedAt: new Date().toISOString(),
          });
          needsFinalRerun = true;
          removeReview(item.gap.id);
          return;
        }

        const scheduled = await runtime.scheduler.enqueue(
          {
            gap: item.gap,
            originalMode: item.originalMode,
            mode: decision.mode,
          },
          "manual",
        );
        const normalizedRoute: CachedRoute = {
          points: scheduled.result.points,
          provenance: {
            ...scheduled.result.provenance,
            originalMode: item.originalMode,
            correctedMode: decision.mode,
            userOverride: true,
          },
        };
        await dependencies.putCachedRoute(
          item.gap,
          decision.mode,
          normalizedRoute,
        );
        await dependencies.persistReviewDecision?.({
          gapId: item.gap.id,
          action: "reroute",
          originalMode: item.originalMode,
          correctedMode: decision.mode,
          normalizedRoute,
        });
        corrections.set(item.gap.id, {
          gapId: item.gap.id,
          action: "reroute",
          originalMode: item.originalMode,
          correctedMode: decision.mode,
          normalizedRoute,
          finalSource: normalizedRoute.provenance.source,
          userOverride: true,
          updatedAt: new Date().toISOString(),
        });
        needsFinalRerun = true;
        emit({
          type: "route-succeeded",
          gapId: item.gap.id,
          lane: scheduled.lane,
        });
        removeReview(item.gap.id);
      } finally {
        activeManualJobs -= 1;
        finishIfReady();
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    cancel,
  };
}

async function runTimelineProcessing(
  legs: TimelineLeg[],
  dependencies: TimelineProcessingDependencies,
  options: ProcessTimelineOptions = {},
  existingRuntime?: TimelineProcessingRuntime,
): Promise<ProcessTimelineResult> {
  const preparedLegs = prepareTimelineLegs(legs);
  const report = createProcessingReport({
    invalidData: options.invalidData,
  });
  const segments: RouteSegment[] = [];
  const processedGaps: ProcessedGap[] = [];
  const completedGapIds = new Set<string>();
  const pendingProviderJobs = new Map<string, AutomaticLane>();
  const runtime =
    existingRuntime ??
    createTimelineProcessingRuntime(dependencies);
  const { scheduler, tdxRouteReuse, hooks } = runtime;
  const gaps = preparedLegs
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
    const progress = {
      current: completedGapIds.size,
      total: gaps.length,
      message,
    };
    options.onProgress?.(progress);
    hooks?.onProgress?.(progress);
  };
  reportProgress(`已完成 0/${gaps.length}`);
  options.signal?.addEventListener(
    "abort",
    () => scheduler.cancel(options.signal?.reason),
    { once: true },
  );

  for (const leg of [...preparedLegs].sort(compareLegs)) {
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

  const preparedGaps = await Promise.all(
    gaps.map(({ leg, gap }, index) =>
      prepareGap(index, leg, gap, dependencies),
    ),
  );
  if (options.signal?.aborted) {
    return canceledResult(report);
  }

  const processGap = async ({
    index,
    leg,
    gap,
    correction,
    effectiveMode,
    cachedRoute,
    preparationError,
    lane,
  }: PreparedGap): Promise<"completed" | "canceled"> => {
    if (options.signal?.aborted) {
      return "canceled";
    }
    let groupable = false;
    let providerRepairStarted = false;
    let providerRepairCompleted = false;
    reportProgress(
      lane === "tdx"
        ? `正在處理 TDX 路段；已完成 ${completedGapIds.size}/${gaps.length}`
        : `正在處理一般路段；已完成 ${completedGapIds.size}/${gaps.length}`,
    );

    try {
      if (preparationError !== undefined) {
        throw preparationError;
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
        return "completed";
      }

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
          `有路段需要人工確認；已完成 ${completedGapIds.size}/${gaps.length}`,
        );
        return "completed";
      }

      const savedRoute =
        correction?.action === "reroute"
          ? correction.normalizedRoute
          : undefined;
      const latestCachedRoute =
        cachedRoute ??
        (lane === "tdx"
          ? tdxRouteReuse.get(gap, effectiveMode)
          : null);
      let route: CachedRoute | RepairRouteResult;
      let attempts: RepairRouteResult["attempts"] = [];
      if (latestCachedRoute) {
        route = latestCachedRoute;
      } else {
        providerRepairStarted = true;
        pendingProviderJobs.set(gap.id, lane);
        try {
          const scheduled = await scheduler.enqueue(
            {
              gap,
              originalMode: leg.mode,
              mode: effectiveMode,
            },
            "automatic",
          );
          const repaired = scheduled.result;
          providerRepairCompleted = true;
          route = repaired;
          attempts = repaired.attempts;
        } finally {
          pendingProviderJobs.delete(gap.id);
        }
      }
      if (options.signal?.aborted) {
        return "canceled";
      }
      if (!savedRoute && latestCachedRoute === null) {
        const routeToCache = {
          points: route.points,
          provenance: route.provenance,
        };
        await dependencies.putCachedRoute(gap, effectiveMode, routeToCache);
        if (lane === "tdx" && route.provenance.source === "tdx") {
          tdxRouteReuse.record(gap, effectiveMode, routeToCache);
        }
      }
      if (options.signal?.aborted) {
        return "canceled";
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
        points: normalizePoints(
          latestCachedRoute
            ? pointsWithoutTimes(route.points)
            : route.points,
          gap.startTime,
          gap.endTime,
        ),
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
      if (providerRepairCompleted) {
        hooks?.onRouteSucceeded?.(gap.id, lane);
      }
      processedGaps.push({
        leg,
        gap,
        effectiveMode,
        groupable,
        repairFailed: false,
        segmentId: segment.id,
      });
      completedGapIds.add(gap.id);
      reportProgress(
        progressMessage(
          pendingProviderJobs,
          completedGapIds.size,
          gaps.length,
        ),
      );
      return "completed";
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        return "canceled";
      }

      const providerError = asProviderError(error);
      const policy = routePolicy(
        effectiveMode,
        gap.startPoint,
        gap.endPoint,
      );
      const failedAttempt = policy
        ? {
            source: policy.provider,
            status: "failed" as const,
            code: providerError.code,
            message: providerError.message,
            retryable: providerError.retryable,
          }
        : null;
      if (policy && failedAttempt) {
        report.providerAttempts.push({
          segmentId: gap.id,
          ...failedAttempt,
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
      if (policy && failedAttempt) {
        hooks?.onReviewEnqueued?.({
          gap,
          originalMode: leg.mode,
          attemptedMode: effectiveMode,
          lane: policy.provider,
          attempts: [failedAttempt],
          ...(flight === "probable"
            ? { warning: "probable-flight" as const }
            : {}),
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
        `有路段需要人工確認；已完成 ${completedGapIds.size}/${gaps.length}`,
      );
      return "completed";
    }
  };

  const automaticResults = await Promise.all(
    preparedGaps.map(processGap),
  );
  if (automaticResults.includes("canceled")) {
    return canceledResult(report);
  }
  processedGaps.sort(
    (left, right) =>
      left.gap.startTime.localeCompare(right.gap.startTime) ||
      left.gap.id.localeCompare(right.gap.id),
  );

  const mergedRetry = await retryContiguousGapGroups(
    processedGaps,
    segments,
    report,
    dependencies,
    scheduler,
    (resolvedGapIds) => {
      resolvedGapIds.forEach((gapId) => {
        completedGapIds.add(gapId);
        hooks?.onReviewRemoved?.(gapId);
      });
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
        segment.points[0]?.time ??
          preparedLegs[0]?.startTime ??
          new Date(0).toISOString(),
        segment.points.at(-1)?.time ??
          preparedLegs[0]?.endTime ??
          new Date(0).toISOString(),
      ),
    }))
    .sort(compareSegments);
  if (normalizedSegments.length === 0) {
    return completeResult(normalizedSegments, report, null, false);
  }

  reportProgress("建立 GPX。");
  const gpx = buildGpx({
    name: options.name ?? "Fog of World Timeline",
    segments: normalizedSegments,
    report: {
      unresolvedCount: report.unresolved.length,
      excludedCount: report.userExcluded.length,
      skippedFlightCount: report.skippedFlights.length,
    },
  });
  reportProgress("驗證 GPX。");
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

function createTimelineProcessingRuntime(
  dependencies: TimelineProcessingDependencies,
  hooks?: TimelineProcessingHooks,
): TimelineProcessingRuntime {
  const tdxRouteReuse = createTdxRouteReuse();
  const adapterFor = (id: AutomaticLane) => ({
    id,
    async route(job: RoutingJob, signal?: AbortSignal) {
      if (id === "tdx") {
        const reused = tdxRouteReuse.get(job.gap, job.mode);
        if (reused) {
          return { ...reused, attempts: [] };
        }
      }
      const repaired = await dependencies.repair({
        ...job.gap,
        mode: job.mode,
        signal,
      });
      if (id === "tdx" && repaired.provenance.source === "tdx") {
        tdxRouteReuse.record(job.gap, job.mode, {
          points: repaired.points,
          provenance: repaired.provenance,
        });
      }
      return repaired;
    },
  });
  const scheduler = createRouteScheduler({
    adapters: {
      openrouteservice: adapterFor("openrouteservice"),
      transitous: adapterFor("transitous"),
      tdx: adapterFor("tdx"),
    },
    selectLane(job) {
      return (
        routePolicy(
          job.mode,
          job.gap.startPoint,
          job.gap.endPoint,
        )?.provider ?? null
      );
    },
  });
  return { scheduler, tdxRouteReuse, hooks };
}

async function prepareGap(
  index: number,
  leg: TimelineLeg,
  gap: TimelineRepairGap,
  dependencies: TimelineProcessingDependencies,
): Promise<PreparedGap> {
  let correction: StoredCorrection | null = null;
  let effectiveMode = defaultRepairMode(leg.mode, gap.distanceMeters);

  try {
    correction = await dependencies.getCorrection(gap);
    effectiveMode =
      correction?.action === "reroute" && correction.correctedMode
        ? correction.correctedMode
        : effectiveMode;

    if (
      correction?.action === "exclude" ||
      routePolicy(effectiveMode) === null
    ) {
      return {
        index,
        leg,
        gap,
        correction,
        effectiveMode,
      cachedRoute: null,
      lane: "openrouteservice",
      };
    }

    const savedRoute =
      correction?.action === "reroute"
        ? correction.normalizedRoute
        : undefined;
    const cachedRoute =
      savedRoute ?? (await dependencies.getCachedRoute(gap, effectiveMode));
    const selectedPolicy = routePolicy(
      effectiveMode,
      gap.startPoint,
      gap.endPoint,
    );
    return {
      index,
      leg,
      gap,
      correction,
      effectiveMode,
      cachedRoute,
      lane: selectedPolicy?.provider ?? "openrouteservice",
    };
  } catch (preparationError) {
    return {
      index,
      leg,
      gap,
      correction,
      effectiveMode,
      cachedRoute: null,
      preparationError,
      lane: "openrouteservice",
    };
  }
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
  scheduler: ReturnType<typeof createRouteScheduler>,
  onResolved: (gapIds: string[]) => void,
  signal?: AbortSignal,
): Promise<"completed" | "canceled"> {
  const retryGroups = contiguousGapGroups(processedGaps).filter(
    (group) =>
      group.length >= 2 &&
      group.some((item) => item.repairFailed),
  );
  const retryGroup = async (
    group: ProcessedGap[],
  ): Promise<"completed" | "canceled"> => {
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
        const scheduled = await scheduler.enqueue(
          {
            gap: mergedGap,
            originalMode: mode,
            mode,
          },
          "automatic",
        );
        route = scheduled.result;
        attempts = scheduled.result.attempts;
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
          cached ? pointsWithoutTimes(route.points) : route.points,
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
    return "completed";
  };
  const results = await Promise.all(retryGroups.map(retryGroup));
  return results.includes("canceled")
    ? "canceled"
    : "completed";
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

function pointsWithoutTimes(points: GeoPoint[]): GeoPoint[] {
  return points.map((point) => {
    const geometry = { ...point };
    delete geometry.time;
    return geometry;
  });
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

function progressMessage(
  pendingProviderJobs: Map<string, AutomaticLane>,
  completed: number,
  total: number,
): string {
  const activeLane = [...pendingProviderJobs.values()].at(-1);
  if (activeLane === undefined) {
    return `已完成 ${completed}/${total}`;
  }
  return activeLane === "tdx"
    ? `正在處理 TDX 路段；已完成 ${completed}/${total}`
    : `正在處理一般路段；已完成 ${completed}/${total}`;
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
