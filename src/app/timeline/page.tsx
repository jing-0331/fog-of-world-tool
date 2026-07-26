"use client";

import { useEffect, useState } from "react";
import { z } from "zod";

import { DateRangeSelector } from "@/components/timeline/date-range-selector";
import { DownloadCard } from "@/components/download-card";
import { ProgressPanel } from "@/components/progress-panel";
import {
  TimelineUploader,
  type TimelineWorkerLike,
} from "@/components/timeline/timeline-uploader";
import {
  UnresolvedReview,
  type UnresolvedReviewItem,
} from "@/components/timeline/unresolved-review";
import {
  createCorrectionStore,
  type CorrectionStore,
} from "@/lib/client/correction-store";
import {
  buildRouteCacheKey,
  createRouteCache,
} from "@/lib/client/route-cache";
import type { TransportMode } from "@/lib/domain/types";
import { createGpxDownload } from "@/lib/gpx/download";
import { routePolicy } from "@/lib/routing/mode-policy";
import type {
  RepairRouteResult,
} from "@/lib/routing/repair-route";
import { buildTimelineLegs } from "@/lib/timeline/build-legs";
import {
  processTimeline,
  type ProcessTimelineResult,
  type TimelineProcessingDependencies,
  type TimelineProgress,
} from "@/lib/timeline/process-timeline";
import {
  selectTimelineDateRange,
  type TimelineDateSelection,
} from "@/lib/timeline/date-range";
import type { TimelineParseResult } from "@/lib/timeline/schema";
import { ProviderError } from "@/lib/server/provider-error";

const ROUTE_ALGORITHM_VERSION = "timeline-route-v1";
const providerErrorCodeSchema = z.enum([
  "no_data",
  "rate_limited",
  "auth",
  "quota",
  "network",
  "provider_unavailable",
]);
const transportModeSchema = z.enum([
  "walking",
  "running",
  "cycling",
  "motorcycling",
  "driving",
  "train",
  "subway",
  "bus",
  "tram",
  "ferry",
  "flying",
  "unknown",
]);
const routeSourceSchema = z.enum([
  "google-timeline",
  "opensky",
  "aerodatabox",
  "flight-plan-database",
  "openrouteservice",
  "tdx",
  "transitous",
  "local-calculation",
  "user",
]);
const repairErrorSchema = z.object({
  error: z.object({
    code: providerErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
});
const repairSuccessSchema = z.object({
  data: z.object({
    points: z
      .array(
        z.object({
          lat: z.number().min(-90).max(90),
          lon: z.number().min(-180).max(180),
          time: z.string().optional(),
          elevationMeters: z.number().optional(),
        }),
      )
      .min(2),
    provenance: z.object({
      kind: z.enum([
        "recorded-timeline",
        "actual-track",
        "filed-plan",
        "simulated-plan",
        "direct-line",
        "ground-route",
        "transit-route",
      ]),
      source: routeSourceSchema,
      referenceDate: z.string().nullable(),
      approximate: z.boolean(),
      explanation: z.string().min(1),
      originalMode: transportModeSchema.optional(),
      correctedMode: transportModeSchema.optional(),
      userOverride: z.boolean().optional(),
    }),
    attempts: z.array(
      z.object({
        source: routeSourceSchema,
        status: z.enum(["success", "failed", "skipped"]),
        code: providerErrorCodeSchema.optional(),
        message: z.string().min(1),
        retryable: z.boolean(),
      }),
    ),
  }),
});

export interface TimelineWorkflowServices {
  dependencies: TimelineProcessingDependencies;
  correctionStore: CorrectionStore;
  close: () => void | Promise<void>;
}

interface TimelineWorkflowProps {
  workerFactory?: () => TimelineWorkerLike;
  services?: TimelineWorkflowServices;
  processFn?: typeof processTimeline;
  createDownloadFn?: typeof createGpxDownload;
}

export function TimelineWorkflow({
  workerFactory,
  services,
  processFn = processTimeline,
  createDownloadFn = createGpxDownload,
}: TimelineWorkflowProps) {
  const [activeServices] = useState<TimelineWorkflowServices>(
    () => services ?? createTimelineWorkflowServices(),
  );
  const [parseResult, setParseResult] = useState<TimelineParseResult | null>(
    null,
  );
  const [selection, setSelection] = useState<TimelineDateSelection | null>(
    null,
  );
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<TimelineProgress | null>(null);
  const [reviewItems, setReviewItems] = useState<UnresolvedReviewItem[]>([]);
  const [download, setDownload] = useState<{
    url: string;
    filename: string;
    size: number;
  } | null>(null);
  const [controller, setController] = useState<AbortController | null>(null);

  useEffect(
    () => () => {
      if (download && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(download.url);
      }
    },
    [download],
  );
  useEffect(
    () => () => {
      if (!services) {
        void activeServices.close();
      }
    },
    [activeServices, services],
  );

  const clearDownload = () => {
    if (download && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(download.url);
    }
    setDownload(null);
  };

  const runProcessing = async (finalizing = false) => {
    if (!parseResult || !selection) {
      return;
    }
    const selectedSegments = selectTimelineDateRange(
      parseResult.segments,
      selection,
    );
    const legs = buildTimelineLegs(selectedSegments);
    const total = legs.reduce((sum, leg) => sum + leg.gaps.length, 0);
    const invalidData = parserInvalidItems(parseResult);
    clearDownload();
    if (finalizing) {
      setProgress((current) => ({
        current: current?.total ?? total,
        total: current?.total ?? total,
        message: "所有路段已完成，正在建立 GPX。",
      }));
    } else {
      setReviewItems([]);
      setProgress({
        current: 0,
        total,
        message: `已完成 0/${total}`,
      });
    }
    setProcessing(true);
    const nextController = new AbortController();
    setController(nextController);

    try {
      const nextResult = await processFn(legs, activeServices.dependencies, {
        signal: nextController.signal,
        ...(finalizing ? {} : { onProgress: setProgress }),
        invalidData,
        name: "Google Timeline 路線",
      });
      const nextReviewItems = buildReviewItems(legs, nextResult);
      setReviewItems(nextReviewItems);
      if (
        nextReviewItems.length === 0 &&
        nextResult.downloadable &&
        nextResult.gpx
      ) {
        setDownload(createDownloadFn(nextResult.gpx, "timeline"));
      }
    } finally {
      setProcessing(false);
      setController(null);
    }
  };

  const handleReviewResolved = (segmentId: string) => {
    const remainingItems = reviewItems.filter(
      (item) => item.gap.id !== segmentId,
    );
    setReviewItems(remainingItems);
    setProgress((current) =>
      current
        ? {
            ...current,
            current: Math.min(current.total, current.current + 1),
            message: `已完成 ${Math.min(
              current.total,
              current.current + 1,
            )}/${current.total}`,
          }
        : current,
    );
    if (remainingItems.length === 0) {
      void runProcessing(true);
    }
  };

  return (
    <main className="workflow-shell">
      <header className="workflow-heading">
        <p className="eyebrow">Google Timeline GPX</p>
        <h1>上傳你的 Google 時間軸</h1>
        <p>
          JSON 只在此瀏覽器分頁內解析；記錄點優先，補齊路線會清楚標示為近似。
        </p>
      </header>

      <TimelineUploader
        workerFactory={workerFactory}
        onParsed={(parsed) => {
          clearDownload();
          setParseResult(parsed);
          setSelection(null);
          setProgress(null);
          setReviewItems([]);
        }}
        onReset={() => {
          clearDownload();
          setParseResult(null);
          setSelection(null);
          setProgress(null);
          setReviewItems([]);
        }}
      />

      {parseResult?.dateRange ? (
        <DateRangeSelector
          key={`${parseResult.dateRange.min}:${parseResult.dateRange.max}`}
          available={parseResult.dateRange}
          onChange={setSelection}
        />
      ) : null}

      {selection && !processing && reviewItems.length === 0 && !download ? (
        <button
          type="button"
          className="primary-button export-button"
          onClick={() => void runProcessing()}
        >
          開始產生 GPX
        </button>
      ) : null}

      {progress ? (
        <div className="workflow-action-stack">
          <ProgressPanel
            title="處理 Google 時間軸"
            message={progress.message}
            current={progress.current}
            total={progress.total}
            busy={processing}
          />
          {processing ? (
            <button
              type="button"
              className="danger-button"
              onClick={() => controller?.abort()}
            >
              取消處理
            </button>
          ) : null}
        </div>
      ) : null}

      {!processing && reviewItems.length > 0 ? (
        <div className="workflow-panel">
          <UnresolvedReview
            items={reviewItems}
            correctionStore={activeServices.correctionStore}
            retry={(item, mode) =>
              requestRepair(item.gap, mode)
            }
            onResolved={handleReviewResolved}
          />
        </div>
      ) : null}

      {download ? (
        <DownloadCard {...download} />
      ) : null}
    </main>
  );
}

export default function TimelinePage() {
  return <TimelineWorkflow />;
}

export function createTimelineWorkflowServices(): TimelineWorkflowServices {
  const routeCache = createRouteCache();
  const correctionStore = createCorrectionStore({ routeCache });

  const dependencies: TimelineProcessingDependencies = {
    async getCorrection(gap) {
      const saved = await correctionStore.get(gap.id);
      return saved
        ? {
            gapId: gap.id,
            action: saved.action,
            originalMode: saved.originalMode,
            correctedMode: saved.correctedMode,
            normalizedRoute: saved.normalizedRoute,
            updatedAt: saved.updatedAt,
          }
        : null;
    },
    async getCachedRoute(gap, mode) {
      const input = cacheKeyInput(gap, mode);
      return input
        ? routeCache.getRoute(buildRouteCacheKey(input))
        : null;
    },
    async putCachedRoute(gap, mode, route) {
      const input = cacheKeyInput(
        gap,
        mode,
        route.provenance.referenceDate,
      );
      if (input) {
        await routeCache.putRoute(buildRouteCacheKey(input), route);
      }
    },
    repair: (gap) => requestRepair(gap, gap.mode, gap.signal),
  };

  return {
    dependencies,
    correctionStore,
    close: () => routeCache.close(),
  };
}

function cacheKeyInput(
  gap: {
    startPoint: { lat: number; lon: number };
    endPoint: { lat: number; lon: number };
  },
  mode: TransportMode,
  referenceDate?: string | null,
) {
  const policy = routePolicy(mode, gap.startPoint, gap.endPoint);
  if (!policy) {
    return null;
  }
  return {
    startPoint: gap.startPoint,
    endPoint: gap.endPoint,
    mode,
    provider: policy.provider,
    algorithmVersion: ROUTE_ALGORITHM_VERSION,
    referenceDate:
      policy.provider === "tdx" || policy.provider === "transitous"
        ? (referenceDate ?? new Date().toISOString().slice(0, 10))
        : null,
  };
}

export async function requestRepair(
  gap: {
    id: string;
    startPoint: { lat: number; lon: number };
    endPoint: { lat: number; lon: number };
    startTime: string;
    endTime: string;
  },
  mode: TransportMode,
  signal?: AbortSignal,
): Promise<RepairRouteResult> {
  const response = await fetch("/api/routes/repair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...gap, mode }),
    signal,
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw unavailableRepairError(response);
  }

  if (!response.ok) {
    const parsed = repairErrorSchema.safeParse(body);
    if (parsed.success) {
      throw new ProviderError({
        ...parsed.data.error,
        status: response.status,
      });
    }
    throw unavailableRepairError(response);
  }

  const parsed = repairSuccessSchema.safeParse(body);
  if (!parsed.success) {
    throw unavailableRepairError(response);
  }
  return parsed.data.data;
}

function unavailableRepairError(response: Response): ProviderError {
  return new ProviderError({
    code: "provider_unavailable",
    message: "Provider is unavailable.",
    retryable: response.ok || response.status >= 500,
    status: response.status,
  });
}

function parserInvalidItems(
  parsed: TimelineParseResult,
) {
  const items = [];
  if (parsed.invalid.coordinates > 0) {
    items.push({
      segmentId: "parser-invalid-coordinates",
      message: `${parsed.invalid.coordinates} 個座標無效，已略過。`,
    });
  }
  if (parsed.invalid.missingTime > 0) {
    items.push({
      segmentId: "parser-missing-times",
      message: `${parsed.invalid.missingTime} 個時間欄位缺漏，已略過。`,
    });
  }
  if (parsed.invalid.segments > 0) {
    items.push({
      segmentId: "parser-invalid-segments",
      message: `${parsed.invalid.segments} 個語意路段無法使用，已略過。`,
    });
  }
  return items;
}

function buildReviewItems(
  legs: ReturnType<typeof buildTimelineLegs>,
  result: ProcessTimelineResult,
): UnresolvedReviewItem[] {
  const unresolvedIds = new Set(
    result.report.unresolved.map((item) => item.segmentId),
  );
  const probableIds = new Set(
    result.report.skippedFlights
      .filter((item) => item.message.includes("可能"))
      .map((item) => item.segmentId),
  );

  return legs.flatMap((leg) =>
    leg.gaps
      .filter(
        (gap) =>
          unresolvedIds.has(gap.id) || probableIds.has(gap.id),
      )
      .map((gap) => ({
        gap,
        originalMode: leg.mode,
        attempts: result.report.providerAttempts.filter(
          (attempt) => attempt.segmentId === gap.id,
        ),
        ...(probableIds.has(gap.id)
          ? { warning: "probable-flight" as const }
          : {}),
      })),
  );
}
