import type { RepairRouteResult } from "@/lib/routing/repair-route";
import type {
  AutomaticLane,
  RoutingJob,
} from "@/lib/timeline/route-job";

export interface RoutingProviderAdapter {
  id: AutomaticLane;
  route(
    job: RoutingJob,
    signal?: AbortSignal,
  ): Promise<RepairRouteResult>;
}
