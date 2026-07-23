"use client";

import { useMemo, useState } from "react";

import { UnresolvedCard } from "@/components/timeline/unresolved-card";
import type { CorrectionStore } from "@/lib/client/correction-store";
import type {
  RepairAttempt,
  TransportMode,
} from "@/lib/domain/types";
import type { RepairRouteResult } from "@/lib/routing/repair-route";
import type { TimelineRepairGap } from "@/lib/timeline/build-legs";

export interface UnresolvedReviewItem {
  gap: TimelineRepairGap;
  originalMode: TransportMode;
  startLocation?: string;
  endLocation?: string;
  attempts: RepairAttempt[];
  warning?: "probable-flight" | "position-anomaly";
}

export type ReviewDecision =
  | {
      action: "exclude";
      segmentId: string;
    }
  | {
      action: "reroute";
      segmentId: string;
      originalMode: TransportMode;
      correctedMode: TransportMode;
      route: RepairRouteResult;
    };

interface UnresolvedReviewProps {
  processing: boolean;
  items: UnresolvedReviewItem[];
  correctionStore: CorrectionStore;
  retry: (
    item: UnresolvedReviewItem,
    mode: TransportMode,
  ) => Promise<RepairRouteResult>;
  onDecision?: (decision: ReviewDecision) => void;
}

export function UnresolvedReview({
  processing,
  items,
  correctionStore,
  retry,
  onDecision,
}: UnresolvedReviewProps) {
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedMode, setSelectedMode] = useState<TransportMode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unresolvedItems = useMemo(
    () => items.filter((item) => !resolvedIds.has(item.gap.id)),
    [items, resolvedIds],
  );

  if (processing) {
    return null;
  }
  if (unresolvedItems.length === 0) {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="font-semibold text-emerald-900">待人工確認路段</h2>
        <p className="mt-2 text-sm text-emerald-800">
          所有待確認路段都已處理。
        </p>
      </section>
    );
  }

  const safeIndex = Math.min(currentIndex, unresolvedItems.length - 1);
  const item = unresolvedItems[safeIndex];
  const mode = selectedMode ?? item.originalMode;

  const resolveCurrent = () => {
    setResolvedIds((current) => new Set(current).add(item.gap.id));
    setCurrentIndex(0);
    setSelectedMode(null);
    setError(null);
  };

  const handleRetry = async () => {
    setPending(true);
    setError(null);
    try {
      const route = await retry(item, mode);
      const correctedRoute: RepairRouteResult = {
        ...route,
        provenance: {
          ...route.provenance,
          originalMode: item.originalMode,
          correctedMode: mode,
          userOverride: true,
        },
      };
      await correctionStore.saveReroute({
        segmentId: item.gap.id,
        originalMode: item.originalMode,
        correctedMode: mode,
        normalizedRoute: {
          points: correctedRoute.points,
          provenance: correctedRoute.provenance,
        },
      });
      onDecision?.({
        action: "reroute",
        segmentId: item.gap.id,
        originalMode: item.originalMode,
        correctedMode: mode,
        route: correctedRoute,
      });
      resolveCurrent();
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "重新查詢路線失敗。",
      );
    } finally {
      setPending(false);
    }
  };

  const handleExclude = async () => {
    setPending(true);
    setError(null);
    try {
      await correctionStore.saveExclusion({
        segmentId: item.gap.id,
        originalMode: item.originalMode,
      });
      onDecision?.({ action: "exclude", segmentId: item.gap.id });
      resolveCurrent();
    } catch (storeError) {
      setError(
        storeError instanceof Error ? storeError.message : "儲存決定失敗。",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="grid gap-4" aria-label="待人工確認路段">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">
            待人工確認路段
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {safeIndex + 1} / {unresolvedItems.length}
          </p>
        </div>
        {unresolvedItems.length > 1 ? (
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-full border border-slate-300 px-3 py-1 text-sm"
              onClick={() =>
                setCurrentIndex(
                  (safeIndex - 1 + unresolvedItems.length) %
                    unresolvedItems.length,
                )
              }
            >
              上一段
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-300 px-3 py-1 text-sm"
              onClick={() =>
                setCurrentIndex((safeIndex + 1) % unresolvedItems.length)
              }
            >
              下一段
            </button>
          </div>
        ) : null}
      </div>

      <UnresolvedCard
        key={item.gap.id}
        item={item}
        selectedMode={mode}
        pending={pending}
        error={error}
        onModeChange={(nextMode) => {
          setSelectedMode(nextMode);
          setError(null);
        }}
        onRetry={handleRetry}
        onExclude={handleExclude}
        onSkip={() => {
          setError(null);
          setSelectedMode(null);
          if (unresolvedItems.length > 1) {
            setCurrentIndex((safeIndex + 1) % unresolvedItems.length);
          }
        }}
      />
    </section>
  );
}
