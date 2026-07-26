"use client";

import { useState } from "react";

import { UnresolvedCard } from "@/components/timeline/unresolved-card";
import type {
  RepairAttempt,
  TransportMode,
} from "@/lib/domain/types";
import {
  reviewModeSelection,
  reviewRegion,
} from "@/lib/routing/review-mode-catalog";
import type { TimelineRepairGap } from "@/lib/timeline/build-legs";
import type { ReviewDecision } from "@/lib/timeline/route-job";

export interface UnresolvedReviewItem {
  gap: TimelineRepairGap;
  originalMode: TransportMode;
  attempts: RepairAttempt[];
  warning?: "probable-flight";
}

interface UnresolvedReviewProps {
  items: UnresolvedReviewItem[];
  submitReview: (decision: ReviewDecision) => Promise<void>;
  successMessage?: string | null;
}

export function UnresolvedReview({
  items,
  submitReview,
  successMessage = null,
}: UnresolvedReviewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selection, setSelection] = useState<{
    gapId: string;
    mode: TransportMode;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{
    gapId: string;
    message: string;
  } | null>(null);

  if (items.length === 0) {
    return null;
  }

  const safeIndex = Math.min(currentIndex, items.length - 1);
  const item = items[safeIndex];
  const region = reviewRegion(item.gap.startPoint, item.gap.endPoint);
  const mode = reviewModeSelection(
    region,
    selection?.gapId === item.gap.id
      ? selection.mode
      : item.originalMode,
  );
  const error =
    failure?.gapId === item.gap.id ? failure.message : null;
  const interactionPending = pending || successMessage !== null;

  const handleRetry = async () => {
    setPending(true);
    setFailure(null);
    try {
      await submitReview({
        gapId: item.gap.id,
        action: "reroute",
        mode,
      });
    } catch (retryError) {
      setFailure({
        gapId: item.gap.id,
        message:
          retryError instanceof Error
          ? retryError.message
          : "重新查詢路線失敗。",
      });
    } finally {
      setPending(false);
    }
  };

  const handleExclude = async () => {
    setPending(true);
    setFailure(null);
    try {
      await submitReview({
        gapId: item.gap.id,
        action: "exclude",
      });
    } catch (storeError) {
      setFailure({
        gapId: item.gap.id,
        message:
          storeError instanceof Error
            ? storeError.message
            : "儲存決定失敗。",
      });
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
              disabled={interactionPending}
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
              disabled={interactionPending}
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
        pending={interactionPending}
        error={error}
        successMessage={successMessage}
        onModeChange={(nextMode) => {
          setSelection({ gapId: item.gap.id, mode: nextMode });
          setFailure(null);
        }}
        onRetry={handleRetry}
        onExclude={handleExclude}
        onSkip={() => {
          setFailure(null);
          if (items.length > 1) {
            setCurrentIndex((safeIndex + 1) % items.length);
          }
        }}
      />
    </section>
  );
}
