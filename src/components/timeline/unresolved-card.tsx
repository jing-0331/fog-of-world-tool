"use client";

import type { TransportMode } from "@/lib/domain/types";
import {
  routeSourceLabel,
  transportModeLabel,
} from "@/lib/domain/provenance";
import { TransportModeSelect } from "@/components/timeline/transport-mode-select";
import type { UnresolvedReviewItem } from "@/components/timeline/unresolved-review";

interface UnresolvedCardProps {
  item: UnresolvedReviewItem;
  selectedMode: TransportMode;
  pending: boolean;
  error: string | null;
  onModeChange: (mode: TransportMode) => void;
  onRetry: () => void;
  onExclude: () => void;
  onSkip: () => void;
}

export function UnresolvedCard({
  item,
  selectedMode,
  pending,
  error,
  onModeChange,
  onRetry,
  onExclude,
  onSkip,
}: UnresolvedCardProps) {
  const { gap } = item;
  return (
    <article className="grid gap-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
        <p>
          <span className="font-semibold">開始：</span>
          {formatLocalTime(gap.startTime)} ·{" "}
          <span>{item.startLocation ?? coordinateLabel(gap.startPoint)}</span>
        </p>
        <p>
          <span className="font-semibold">結束：</span>
          {formatLocalTime(gap.endTime)} ·{" "}
          <span>{item.endLocation ?? coordinateLabel(gap.endPoint)}</span>
        </p>
        <p>
          <span className="font-semibold">直線距離：</span>
          {formatDistance(gap.distanceMeters)}
        </p>
        <p>
          <span className="font-semibold">經過時間：</span>
          {formatElapsed(gap.elapsedMilliseconds)}
        </p>
      </div>

      <p className="text-sm font-medium text-slate-800">
        原始 Google 交通方式：{transportModeLabel(item.originalMode)}
      </p>

      {item.attempts.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            已嘗試來源與原因
          </h3>
          <ul className="mt-2 grid gap-1 text-sm text-slate-700">
            {item.attempts.map((attempt, index) => (
              <li key={`${attempt.source}-${index}`}>
                {routeSourceLabel(attempt.source)}：{attempt.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {item.warning ? (
        <p
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
          role="status"
        >
          {item.warning === "probable-flight"
            ? "可能是飛行或位置異常，請確認後再選擇交通方式。"
            : "可能是位置異常，請確認這段移動是否真的存在。"}
        </p>
      ) : null}

      <TransportModeSelect
        value={selectedMode}
        onChange={onModeChange}
        disabled={pending}
      />
      {error ? (
        <p className="text-sm font-medium text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="primary-button compact-button text-sm disabled:opacity-50"
          disabled={pending}
          onClick={onRetry}
        >
          {pending ? "查詢中…" : "重新查詢"}
        </button>
        <button
          type="button"
          className="danger-button compact-button text-sm disabled:opacity-50"
          disabled={pending}
          onClick={onExclude}
        >
          此路段不存在
        </button>
        <button
          type="button"
          className="secondary-button compact-button text-sm disabled:opacity-50"
          disabled={pending}
          onClick={onSkip}
        >
          暫時略過
        </button>
      </div>
    </article>
  );
}

function formatLocalTime(timestamp: string): string {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      timestamp,
    );
  return match ? `${match[1]} ${match[2]} (${match[3]})` : timestamp;
}

function coordinateLabel(point: { lat: number; lon: number }): string {
  return `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
}

function formatDistance(meters: number): string {
  return meters >= 1_000
    ? `${(meters / 1_000).toFixed(1)} 公里`
    : `${Math.round(meters)} 公尺`;
}

function formatElapsed(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return [
    hours > 0 ? `${hours} 小時` : "",
    minutes > 0 || hours === 0 ? `${minutes} 分鐘` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
