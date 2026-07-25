"use client";

import { useState } from "react";

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
  attempts: RepairAttempt[];
  warning?: "probable-flight";
}

interface UnresolvedReviewProps {
  items: UnresolvedReviewItem[];
  correctionStore: CorrectionStore;
  retry: (
    item: UnresolvedReviewItem,
    mode: TransportMode,
  ) => Promise<RepairRouteResult>;
  onResolved: (segmentId: string) => void;
}

export function UnresolvedReview({
  items,
  correctionStore,
  retry,
  onResolved,
}: UnresolvedReviewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedMode, setSelectedMode] = useState<TransportMode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) {
    return null;
  }

  const safeIndex = Math.min(currentIndex, items.length - 1);
  const item = items[safeIndex];
  const mode = selectedMode ?? item.originalMode;

  const resolveCurrent = () => {
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
      onResolved(item.gap.id);
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
      onResolved(item.gap.id);
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
            {safeIndex + 1} / {items.length}
          </p>
        </div>
        {items.length > 1 ? (
          <div className="flex gap-2">
            <button
              type="button"
              className="secondary-button compact-button rounded-full border border-slate-300 px-3 py-1 text-sm"
              onClick={() =>
                setCurrentIndex(
                  (safeIndex - 1 + items.length) %
                    items.length,
                )
              }
            >
              上一段
            </button>
            <button
              type="button"
              className="secondary-button compact-button rounded-full border border-slate-300 px-3 py-1 text-sm"
              onClick={() =>
                setCurrentIndex((safeIndex + 1) % items.length)
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
          if (items.length > 1) {
            setCurrentIndex((safeIndex + 1) % items.length);
          }
        }}
      />
    </section>
  );
}
