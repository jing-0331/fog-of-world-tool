import type {
  RouteKind,
  RouteSource,
  TransportMode,
} from "@/lib/domain/types";

const ROUTE_KIND_LABELS = {
  "recorded-timeline": "時間軸記錄",
  "actual-track": "實際軌跡",
  "filed-plan": "申報航路",
  "simulated-plan": "模擬航路",
  "direct-line": "直接連線",
  "ground-route": "地面路線",
  "transit-route": "大眾運輸近似",
} satisfies Record<RouteKind, string>;

const ROUTE_SOURCE_LABELS = {
  "google-timeline": "Google 時間軸",
  opensky: "OpenSky",
  aerodatabox: "AeroDataBox",
  "flight-plan-database": "Flight Plan Database",
  openrouteservice: "OpenRouteService",
  tdx: "TDX",
  transitous: "Transitous",
  "local-calculation": "本機計算",
  user: "使用者修正",
} satisfies Record<RouteSource, string>;

const TRANSPORT_MODE_LABELS = {
  walking: "步行",
  running: "跑步",
  cycling: "自行車",
  motorcycling: "機車",
  driving: "開車",
  train: "火車",
  subway: "捷運",
  bus: "公車",
  tram: "路面電車",
  ferry: "渡輪",
  flying: "飛行",
  unknown: "未知",
} satisfies Record<TransportMode, string>;

export function routeKindLabel(kind: RouteKind): string {
  return ROUTE_KIND_LABELS[kind];
}

export function routeSourceLabel(source: RouteSource): string {
  return ROUTE_SOURCE_LABELS[source];
}

export function transportModeLabel(mode: TransportMode): string {
  return TRANSPORT_MODE_LABELS[mode];
}
