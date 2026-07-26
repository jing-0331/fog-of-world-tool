import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() !== ""
      ? value.trim()
      : undefined,
  z.string().optional(),
);

const transitousMinimumInterval = z.preprocess(
  (value) => {
    if (
      value === undefined ||
      (typeof value === "string" && value.trim() === "")
    ) {
      return undefined;
    }
    return typeof value === "string" ? Number(value) : value;
  },
  z
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(5_000),
);

const tdxRequestsPerMinute = z.preprocess(
  (value) => {
    if (
      value === undefined ||
      (typeof value === "string" && value.trim() === "")
    ) {
      return undefined;
    }
    return typeof value === "string" ? Number(value) : value;
  },
  z.number().int().positive().default(5),
);

const serverEnvSchema = z.object({
  AERODATABOX_RAPIDAPI_KEY: optionalSecret,
  OPENROUTESERVICE_API_KEY: optionalSecret,
  OPENSKY_CLIENT_ID: optionalSecret,
  OPENSKY_CLIENT_SECRET: optionalSecret,
  FLIGHTPLANDB_API_KEY: optionalSecret,
  TDX_CLIENT_ID: optionalSecret,
  TDX_CLIENT_SECRET: optionalSecret,
  TDX_REQUESTS_PER_MINUTE: tdxRequestsPerMinute,
  TRANSITOUS_CONTACT_URL: optionalSecret,
  TRANSITOUS_MIN_INTERVAL_MS: transitousMinimumInterval,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type EnvironmentInput = Record<string, string | undefined>;

export function readServerEnv(environment: EnvironmentInput): ServerEnv {
  return serverEnvSchema.parse(environment);
}

export function isTransitousContactConfigured(
  contactUrl: string | undefined,
): boolean {
  if (contactUrl === undefined || /YOUR_ACCOUNT|YOUR_REPOSITORY/i.test(contactUrl)) {
    return false;
  }

  try {
    const parsed = new URL(contactUrl);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
