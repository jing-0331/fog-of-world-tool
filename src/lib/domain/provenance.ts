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
  transit: "大眾運輸",
  train: "火車",
  rail: "鐵路",
  "taiwan-rail": "台鐵",
  "high-speed-rail": "高速鐵路",
  "long-distance-rail": "長途鐵路",
  "night-rail": "夜行列車",
  "regional-rail": "區域鐵路",
  "suburban-rail": "市郊鐵路",
  subway: "捷運／地鐵",
  bus: "公車",
  coach: "長途客運",
  tram: "路面電車",
  ferry: "渡輪",
  funicular: "登山纜車",
  "aerial-lift": "空中纜車",
  "other-transit": "其他大眾運輸",
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
