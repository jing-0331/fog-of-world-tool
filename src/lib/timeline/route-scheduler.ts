import type { RepairRouteResult } from "@/lib/routing/repair-route";
import type { RoutingProviderAdapter } from "@/lib/routing/provider-adapter";
import { ProviderError } from "@/lib/server/provider-error";
import type {
  AutomaticLane,
  JobPriority,
  RoutingJob,
} from "@/lib/timeline/route-job";
import {
  createRoutingLane,
  type RoutingLane,
} from "@/lib/timeline/routing-lane";

export interface RouteSchedulerConfig {
  adapters: Record<AutomaticLane, RoutingProviderAdapter>;
  selectLane(job: RoutingJob): AutomaticLane | null;
}

export interface ScheduledRouteResult {
  lane: AutomaticLane;
  result: RepairRouteResult;
}

export interface RouteScheduler {
  enqueue(
    job: RoutingJob,
    priority: JobPriority,
  ): Promise<ScheduledRouteResult>;
  whenIdle(): Promise<void>;
  cancel(reason?: unknown): void;
}

export function createRouteScheduler({
  adapters,
  selectLane,
}: RouteSchedulerConfig): RouteScheduler {
  const lanes: Record<AutomaticLane, RoutingLane> = {
    openrouteservice: createRoutingLane({
      adapter: adapters.openrouteservice,
      concurrency: 1,
    }),
    transitous: createRoutingLane({
      adapter: adapters.transitous,
      concurrency: 1,
    }),
    tdx: createRoutingLane({
      adapter: adapters.tdx,
      concurrency: 1,
    }),
  };

  return {
    async enqueue(job, priority) {
      const lane = selectLane(job);
      if (lane === null) {
        throw new ProviderError({
          code: "no_data",
          message: `交通方式 ${job.mode} 沒有可用的路線來源。`,
          retryable: false,
        });
      }
      return {
        lane,
        result: await lanes[lane].enqueue(job, priority),
      };
    },

    async whenIdle() {
      await Promise.all(
        Object.values(lanes).map((lane) => lane.whenIdle()),
      );
    },

    cancel(reason) {
      Object.values(lanes).forEach((lane) => lane.cancel(reason));
    },
  };
}
