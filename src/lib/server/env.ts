import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() !== ""
      ? value.trim()
      : undefined,
  z.string().optional(),
);

const serverEnvSchema = z.object({
  AERODATABOX_RAPIDAPI_KEY: optionalSecret,
  OPENROUTESERVICE_API_KEY: optionalSecret,
  OPENSKY_CLIENT_ID: optionalSecret,
  OPENSKY_CLIENT_SECRET: optionalSecret,
  FLIGHTPLANDB_API_KEY: optionalSecret,
  TDX_CLIENT_ID: optionalSecret,
  TDX_CLIENT_SECRET: optionalSecret,
  TRANSITOUS_CONTACT_URL: optionalSecret,
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
