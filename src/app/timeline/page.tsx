"use client";

import { useEffect, useRef, useState } from "react";

import { DownloadCard } from "@/components/download-card";
import { ProgressPanel } from "@/components/progress-panel";
import { DateRangeSelector } from "@/components/timeline/date-range-selector";
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
import type { RepairRouteResult } from "@/lib/routing/repair-route";
import { buildTimelineLegs } from "@/lib/timeline/build-legs";
import {
  selectTimelineDateRange,
  type TimelineDateSelection,
} from "@/lib/timeline/date-range";
import {
  startTimelineProcessing,
  type ProcessTimelineResult,
  type TimelineProcessingDependencies,
  type TimelineProcessingSession,
  type TimelineProgress,
} from "@/lib/timeline/process-timeline";
import type { TimelineParseResult } from "@/lib/timeline/schema";

const ROUTE_ALGORITHM_VERSION = "timeline-route-v1";
const REVIEW_SUCCESS_MESSAGE =
  "路段查詢成功，已加入輸出路線。";
const REVIEW_SUCCESS_DELAY_MS = 800;

export interface TimelineWorkflowServices {
  dependencies: TimelineProcessingDependencies;
  correctionStore: CorrectionStore;
  close: () => void | Promise<void>;
}

interface TimelineWorkflowProps {
  workerFactory?: () => TimelineWorkerLike;
  services?: TimelineWorkflowServices;
  startProcessingFn?: typeof startTimelineProcessing;
  createDownloadFn?: typeof createGpxDownload;
}

export function TimelineWorkflow({
  workerFactory,
  services,
  startProcessingFn = startTimelineProcessing,
  createDownloadFn = createGpxDownload,
}: TimelineWorkflowProps) {
  const [activeServices] = useState<TimelineWorkflowServices>(
    () => services ?? createTimelineWorkflowServices(),
  );
  const [parseResult, setParseResult] =
    useState<TimelineParseResult | null>(null);
  const [selection, setSelection] =
    useState<TimelineDateSelection | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<TimelineProgress | null>(
    null,
  );
  const [reviewItems, setReviewItems] = useState<
    UnresolvedReviewItem[]
  >([]);
  const [reviewSuccess, setReviewSuccess] = useState<{
    gapId: string;
    message: string;
  } | null>(null);
  const [download, setDownload] = useState<{
    url: string;
    filename: string;
    size: number;
  } | null>(null);
  const activeSessionRef = useRef<TimelineProcessingSession | null>(
    null,
  );
  const reviewIdsRef = useRef(new Set<string>());
  const successfulReviewIdsRef = useRef(new Set<string>());
  const removalTimersRef = useRef(
    new Set<ReturnType<typeof setTimeout>>(),
  );

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
      activeSessionRef.current?.cancel();
      for (const timer of removalTimersRef.current) {
        clearTimeout(timer);
      }
      removalTimersRef.current.clear();
    },
    [],
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

  const clearRemovalTimers = () => {
    for (const timer of removalTimersRef.current) {
      clearTimeout(timer);
    }
    removalTimersRef.current.clear();
  };

  const resetActiveProcessing = () => {
    activeSessionRef.current?.cancel();
    activeSessionRef.current = null;
    clearRemovalTimers();
    reviewIdsRef.current.clear();
    successfulReviewIdsRef.current.clear();
    setProcessing(false);
    setReviewItems([]);
    setReviewSuccess(null);
  };

  const runProcessing = () => {
    if (!parseResult || !selection || activeSessionRef.current) {
      return;
    }
    const selectedSegments = selectTimelineDateRange(
      parseResult.segments,
      selection,
    );
    const legs = buildTimelineLegs(selectedSegments);
    const total = legs.reduce(
      (sum, leg) => sum + leg.gaps.length,
      0,
    );
    const invalidData = parserInvalidItems(parseResult);

    clearDownload();
    clearRemovalTimers();
    reviewIdsRef.current = new Set();
    successfulReviewIdsRef.current = new Set();
    setReviewItems([]);
    setReviewSuccess(null);
    setProgress({
      current: 0,
      total,
      message: `已完成 0/${total}`,
    });
    setProcessing(true);

    const updateProgress = (next: TimelineProgress) => {
      setProgress((current) => mergeProgress(current, next));
    };

    let session: TimelineProcessingSession;
    try {
      session = startProcessingFn(legs, activeServices.dependencies, {
        onProgress: updateProgress,
        invalidData,
        name: "Google Timeline 路線",
      });
    } catch {
      setProcessing(false);
      return;
    }
    activeSessionRef.current = session;

    let finishedResult: ProcessTimelineResult | null = null;
    let finalized = false;
    let unsubscribe = () => {};

    const finalizeIfReady = () => {
      if (
        finalized ||
        finishedResult === null ||
        activeSessionRef.current !== session ||
        reviewIdsRef.current.size > 0
      ) {
        return;
      }
      finalized = true;
      unsubscribe();
      activeSessionRef.current = null;
      setProcessing(false);
      setReviewSuccess(null);
      if (
        !finishedResult.canceled &&
        finishedResult.downloadable &&
        finishedResult.gpx
      ) {
        setDownload(
          createDownloadFn(finishedResult.gpx, "timeline"),
        );
      }
    };

    const removeReview = (gapId: string) => {
      if (!reviewIdsRef.current.delete(gapId)) {
        return;
      }
      setReviewItems((current) =>
        current.filter((item) => item.gap.id !== gapId),
      );
      setReviewSuccess((current) =>
        current?.gapId === gapId ? null : current,
      );
      setProgress((current) => {
        if (!current) {
          return current;
        }
        const completed = Math.min(
          current.total,
          current.current + 1,
        );
        return {
          ...current,
          current: completed,
          message: replaceProgressCount(
            current.message,
            completed,
            current.total,
          ),
        };
      });
      finalizeIfReady();
    };

    unsubscribe = session.subscribe((event) => {
      if (activeSessionRef.current !== session) {
        return;
      }
      if (event.type === "progress") {
        updateProgress(event.progress);
        return;
      }
      if (event.type === "review-enqueued") {
        const gapId = event.item.gap.id;
        if (reviewIdsRef.current.has(gapId)) {
          return;
        }
        reviewIdsRef.current.add(gapId);
        setReviewItems((current) => [...current, event.item]);
        return;
      }
      if (event.type === "route-succeeded") {
        if (reviewIdsRef.current.has(event.gapId)) {
          successfulReviewIdsRef.current.add(event.gapId);
          setReviewSuccess({
            gapId: event.gapId,
            message: REVIEW_SUCCESS_MESSAGE,
          });
        }
        return;
      }
      if (successfulReviewIdsRef.current.delete(event.gapId)) {
        const timer = setTimeout(() => {
          removalTimersRef.current.delete(timer);
          removeReview(event.gapId);
        }, REVIEW_SUCCESS_DELAY_MS);
        removalTimersRef.current.add(timer);
        return;
      }
      removeReview(event.gapId);
    });

    void session.automaticDone.catch(() => undefined);
    void session.finished.then(
      (result) => {
        finishedResult = result;
        finalizeIfReady();
      },
      () => {
        if (activeSessionRef.current === session) {
          unsubscribe();
          activeSessionRef.current = null;
          setProcessing(false);
        }
      },
    );
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
          resetActiveProcessing();
          clearDownload();
          setParseResult(parsed);
          setSelection(null);
          setProgress(null);
        }}
        onReset={() => {
          resetActiveProcessing();
          clearDownload();
          setParseResult(null);
          setSelection(null);
          setProgress(null);
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
          onClick={runProcessing}
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
              onClick={() => activeSessionRef.current?.cancel()}
            >
              取消處理
            </button>
          ) : null}
        </div>
      ) : null}

      {reviewItems.length > 0 ? (
        <div className="workflow-panel">
          <UnresolvedReview
            items={reviewItems}
            submitReview={(decision) => {
              const session = activeSessionRef.current;
              return session
                ? session.submitReview(decision)
                : Promise.reject(
                    new Error("時間軸處理工作已結束。"),
                  );
            }}
            successMessage={reviewSuccess?.message}
          />
        </div>
      ) : null}

      {download ? <DownloadCard {...download} /> : null}
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
        await routeCache.putRoute(
          buildRouteCacheKey(input),
          route,
        );
      }
    },
    repair: (gap) => requestRepair(gap, gap.mode, gap.signal),
    async persistReviewDecision(decision) {
      if (decision.action === "exclude") {
        await correctionStore.saveExclusion({
          segmentId: decision.gapId,
          originalMode: decision.originalMode,
        });
        return;
      }
      await correctionStore.saveReroute({
        segmentId: decision.gapId,
        originalMode: decision.originalMode,
        correctedMode: decision.correctedMode,
        normalizedRoute: decision.normalizedRoute,
      });
    },
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

async function requestRepair(
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
  const body = (await response.json()) as {
    data?: RepairRouteResult;
    error?: { message: string };
  };
  if (!response.ok || !body.data) {
    throw new Error(
      body.error?.message ?? "所有路線來源皆失敗。",
    );
  }
  return body.data;
}

function parserInvalidItems(parsed: TimelineParseResult) {
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

function mergeProgress(
  current: TimelineProgress | null,
  next: TimelineProgress,
): TimelineProgress {
  const completed = Math.max(current?.current ?? 0, next.current);
  return {
    ...next,
    current: completed,
    message: replaceProgressCount(
      next.message,
      completed,
      next.total,
    ),
  };
}

function replaceProgressCount(
  message: string,
  current: number,
  total: number,
): string {
  const count = `已完成 ${current}/${total}`;
  return /已完成 \d+\/\d+/.test(message)
    ? message.replace(/已完成 \d+\/\d+/, count)
    : count;
}
