import { NextResponse } from "next/server";

import {
  isTransitousContactConfigured,
  readServerEnv,
  type EnvironmentInput,
} from "@/lib/server/env";

interface CapabilityStatus {
  configured: boolean;
  message: string;
}

export interface ConfigStatus {
  aerodatabox: CapabilityStatus;
  openrouteservice: CapabilityStatus;
  opensky: CapabilityStatus;
  flightPlanDatabase: CapabilityStatus;
  tdx: CapabilityStatus;
  transitous: CapabilityStatus;
}

function capability(
  configured: boolean,
  readyMessage: string,
  setupMessage: string,
): CapabilityStatus {
  return { configured, message: configured ? readyMessage : setupMessage };
}

export function getConfigStatus(environment: EnvironmentInput): ConfigStatus {
  const env = readServerEnv(environment);
  const transitousConfigured = isTransitousContactConfigured(
    env.TRANSITOUS_CONTACT_URL,
  );

  return {
    aerodatabox: capability(
      env.AERODATABOX_RAPIDAPI_KEY !== undefined,
      "航班搜尋已啟用。",
      "設定 AERODATABOX_RAPIDAPI_KEY 以啟用航班搜尋。",
    ),
    openrouteservice: capability(
      env.OPENROUTESERVICE_API_KEY !== undefined,
      "地面路線修補已啟用。",
      "設定 OPENROUTESERVICE_API_KEY 以啟用地面路線修補。",
    ),
    opensky: capability(
      env.OPENSKY_CLIENT_ID !== undefined &&
        env.OPENSKY_CLIENT_SECRET !== undefined,
      "近期實際航跡增強已啟用。",
      "同時設定 OPENSKY_CLIENT_ID 與 OPENSKY_CLIENT_SECRET 以啟用近期航跡。",
    ),
    flightPlanDatabase: capability(
      env.FLIGHTPLANDB_API_KEY !== undefined,
      "模擬航路查詢已啟用。",
      "設定 FLIGHTPLANDB_API_KEY 以啟用完整模擬航路查詢。",
    ),
    tdx: capability(
      env.TDX_CLIENT_ID !== undefined &&
        env.TDX_CLIENT_SECRET !== undefined,
      "台灣大眾運輸路線查詢已啟用。",
      "設定 TDX_CLIENT_ID 與 TDX_CLIENT_SECRET 以啟用台灣大眾運輸路線查詢。",
    ),
    transitous: capability(
      transitousConfigured,
      "大眾運輸近似路線已啟用。",
      "設定非範例的 TRANSITOUS_CONTACT_URL 聯絡網址以啟用大眾運輸查詢。",
    ),
  };
}

export function GET(): NextResponse {
  return NextResponse.json({ data: getConfigStatus(process.env) });
}
