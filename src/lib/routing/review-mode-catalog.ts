import type {
  GeoPoint,
  TransportMode,
} from "@/lib/domain/types";
import { isTaiwanPoint } from "@/lib/geo/taiwan";
import { modeFamily } from "@/lib/routing/mode-policy";

export type ReviewRegion = "taiwan" | "international";

export interface ReviewModeOption {
  value: TransportMode;
  label: string;
  group: "general" | "transit";
}

const GENERAL_OPTIONS = [
  { value: "walking", label: "步行", group: "general" },
  { value: "running", label: "跑步", group: "general" },
  { value: "cycling", label: "自行車", group: "general" },
  { value: "motorcycling", label: "機車", group: "general" },
  { value: "driving", label: "開車", group: "general" },
] as const satisfies readonly ReviewModeOption[];

const TAIWAN_TRANSIT_OPTIONS = [
  {
    value: "train",
    label: "鐵路（台鐵／高鐵，不限）",
    group: "transit",
  },
  { value: "taiwan-rail", label: "台鐵", group: "transit" },
  { value: "high-speed-rail", label: "高鐵", group: "transit" },
  { value: "bus", label: "公車／公路客運", group: "transit" },
  { value: "subway", label: "捷運", group: "transit" },
  { value: "tram", label: "輕軌", group: "transit" },
  { value: "ferry", label: "渡輪", group: "transit" },
  { value: "funicular", label: "纜車", group: "transit" },
] as const satisfies readonly ReviewModeOption[];

const INTERNATIONAL_TRANSIT_OPTIONS = [
  { value: "transit", label: "大眾運輸（不限）", group: "transit" },
  { value: "rail", label: "鐵路（不限）", group: "transit" },
  {
    value: "high-speed-rail",
    label: "高速鐵路",
    group: "transit",
  },
  {
    value: "long-distance-rail",
    label: "長途鐵路",
    group: "transit",
  },
  { value: "night-rail", label: "夜行列車", group: "transit" },
  { value: "regional-rail", label: "區域鐵路", group: "transit" },
  { value: "suburban-rail", label: "市郊鐵路", group: "transit" },
  { value: "subway", label: "地鐵", group: "transit" },
  { value: "bus", label: "市區／短途公車", group: "transit" },
  { value: "coach", label: "長途客運", group: "transit" },
  { value: "tram", label: "路面電車", group: "transit" },
  { value: "ferry", label: "渡輪", group: "transit" },
  { value: "funicular", label: "登山纜車", group: "transit" },
  { value: "aerial-lift", label: "空中纜車", group: "transit" },
  {
    value: "other-transit",
    label: "其他大眾運輸",
    group: "transit",
  },
] as const satisfies readonly ReviewModeOption[];

const OPTIONS_BY_REGION = {
  taiwan: [...GENERAL_OPTIONS, ...TAIWAN_TRANSIT_OPTIONS],
  international: [...GENERAL_OPTIONS, ...INTERNATIONAL_TRANSIT_OPTIONS],
} as const satisfies Record<
  ReviewRegion,
  readonly ReviewModeOption[]
>;

export function reviewRegion(
  startPoint: GeoPoint,
  endPoint: GeoPoint,
): ReviewRegion {
  return isTaiwanPoint(startPoint) && isTaiwanPoint(endPoint)
    ? "taiwan"
    : "international";
}

export function reviewModeOptions(
  region: ReviewRegion,
): readonly ReviewModeOption[] {
  return OPTIONS_BY_REGION[region];
}

export function reviewModeSelection(
  region: ReviewRegion,
  preferredMode: TransportMode,
): TransportMode {
  const options = reviewModeOptions(region);
  if (options.some(({ value }) => value === preferredMode)) {
    return preferredMode;
  }
  if (modeFamily(preferredMode) === "public-transit") {
    return region === "taiwan" ? "train" : "rail";
  }
  return "walking";
}
