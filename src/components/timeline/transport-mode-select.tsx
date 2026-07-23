"use client";

import type { TransportMode } from "@/lib/domain/types";
import { transportModeLabel } from "@/lib/domain/provenance";

const REPAIRABLE_MODES = [
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
] as const satisfies readonly TransportMode[];

interface TransportModeSelectProps {
  value: TransportMode;
  onChange: (mode: TransportMode) => void;
  disabled?: boolean;
}

export function TransportModeSelect({
  value,
  onChange,
  disabled = false,
}: TransportModeSelectProps) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      修正交通方式
      <select
        aria-label="修正交通方式"
        className="transport-mode-select rounded-xl border border-slate-300 px-3 py-2"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value as TransportMode)}
      >
        {REPAIRABLE_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {transportModeLabel(mode)}
          </option>
        ))}
      </select>
    </label>
  );
}
