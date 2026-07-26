import type { CachedRoute } from "@/lib/client/route-cache";
import type {
  RepairAttempt,
  TransportMode,
} from "@/lib/domain/types";
import type { TimelineRepairGap } from "@/lib/timeline/build-legs";

export type AutomaticLane =
  | "openrouteservice"
  | "transitous"
  | "tdx";

export type JobPriority = "automatic" | "manual";

export interface RoutingJob {
  gap: TimelineRepairGap;
  originalMode: TransportMode;
  mode: TransportMode;
}

export interface ReviewQueueItem {
  gap: TimelineRepairGap;
  originalMode: TransportMode;
  attemptedMode: TransportMode;
  lane: AutomaticLane;
  attempts: RepairAttempt[];
  warning?: "probable-flight";
}

export type ReviewDecision =
  | {
      gapId: string;
      action: "reroute";
      mode: TransportMode;
    }
  | {
      gapId: string;
      action: "exclude";
    };

export type PersistedReviewDecision =
  | {
      gapId: string;
      action: "reroute";
      originalMode: TransportMode;
      correctedMode: TransportMode;
      normalizedRoute: CachedRoute;
    }
  | {
      gapId: string;
      action: "exclude";
      originalMode: TransportMode;
    };
