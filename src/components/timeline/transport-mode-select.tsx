"use client";

import type { TransportMode } from "@/lib/domain/types";
import {
  reviewModeOptions,
  reviewModeSelection,
  type ReviewRegion,
} from "@/lib/routing/review-mode-catalog";

interface TransportModeSelectProps {
  region: ReviewRegion;
  value: TransportMode;
  onChange: (mode: TransportMode) => void;
  disabled?: boolean;
}

export function TransportModeSelect({
  region,
  value,
  onChange,
  disabled = false,
}: TransportModeSelectProps) {
  const options = reviewModeOptions(region);
  const selectedValue = reviewModeSelection(region, value);
  const generalOptions = options.filter(
    ({ group }) => group === "general",
  );
  const transitOptions = options.filter(
    ({ group }) => group === "transit",
  );

  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      修正交通方式
      <select
        aria-label="修正交通方式"
        className="transport-mode-select rounded-xl border border-slate-300 px-3 py-2"
        disabled={disabled}
        value={selectedValue}
        onChange={(event) => onChange(event.target.value as TransportMode)}
      >
        <optgroup label="一般路線">
          {generalOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
        <optgroup
          label={
            region === "taiwan" ? "台灣大眾運輸" : "國外大眾運輸"
          }
        >
          {transitOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
