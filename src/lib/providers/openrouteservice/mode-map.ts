import type {
  GeneralRouteMode,
  TransportMode,
} from "@/lib/domain/types";

export type OpenRouteServiceProfile =
  | "foot-walking"
  | "cycling-regular"
  | "driving-car";

const PROFILES: Record<
  GeneralRouteMode,
  OpenRouteServiceProfile
> = {
  walking: "foot-walking",
  running: "foot-walking",
  cycling: "cycling-regular",
  motorcycling: "driving-car",
  driving: "driving-car",
};
const PROFILES_BY_MODE: Partial<
  Record<TransportMode, OpenRouteServiceProfile>
> = PROFILES;

export function openRouteServiceProfileFor(
  mode: GeneralRouteMode,
): OpenRouteServiceProfile;
export function openRouteServiceProfileFor(
  mode: TransportMode,
): OpenRouteServiceProfile | null;
export function openRouteServiceProfileFor(
  mode: TransportMode,
): OpenRouteServiceProfile | null {
  return PROFILES_BY_MODE[mode] ?? null;
}
