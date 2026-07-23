"use client";

import { useState } from "react";

import type { TimelineDateSelection } from "@/lib/timeline/date-range";

interface DateRangeSelectorProps {
  available: { min: string; max: string };
  onChange: (selection: TimelineDateSelection | null) => void;
}

type SelectionMode = "all" | "custom" | null;

export function DateRangeSelector({
  available,
  onChange,
}: DateRangeSelectorProps) {
  const [mode, setMode] = useState<SelectionMode>(null);
  const [startDate, setStartDate] = useState(available.min);
  const [endDate, setEndDate] = useState(available.max);

  const updateCustom = (start: string, end: string) => {
    if (
      start >= available.min &&
      end <= available.max &&
      start <= end
    ) {
      onChange({ startDate: start, endDate: end });
    } else {
      onChange(null);
    }
  };

  return (
    <section className="workflow-panel grid gap-4">
      <div>
        <h2 className="text-xl font-semibold">選擇匯出日期</h2>
        <p className="mt-1 text-sm text-slate-600">
          檔案日期範圍：{available.min} ～ {available.max}
        </p>
      </div>
      <fieldset className="grid gap-3">
        <legend className="sr-only">時間範圍</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="timeline-date-mode"
            checked={mode === "all"}
            onChange={() => {
              setMode("all");
              onChange({
                startDate: available.min,
                endDate: available.max,
              });
            }}
          />
          全部時間
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="timeline-date-mode"
            checked={mode === "custom"}
            onChange={() => {
              setMode("custom");
              updateCustom(startDate, endDate);
            }}
          />
          選取區間
        </label>
      </fieldset>

      {mode === "custom" ? (
        <div className="form-grid">
          <label>
            開始日期
            <input
              type="date"
              aria-label="開始日期"
              min={available.min}
              max={available.max}
              value={startDate}
              onChange={(event) => {
                const next = event.target.value;
                setStartDate(next);
                updateCustom(next, endDate);
              }}
            />
          </label>
          <label>
            結束日期
            <input
              type="date"
              aria-label="結束日期"
              min={available.min}
              max={available.max}
              value={endDate}
              onChange={(event) => {
                const next = event.target.value;
                setEndDate(next);
                updateCustom(startDate, next);
              }}
            />
          </label>
        </div>
      ) : null}
    </section>
  );
}
