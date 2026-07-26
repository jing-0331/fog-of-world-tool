import type { RepairRouteResult } from "@/lib/routing/repair-route";
import type { RoutingProviderAdapter } from "@/lib/routing/provider-adapter";
import type {
  JobPriority,
  RoutingJob,
} from "@/lib/timeline/route-job";

export interface RoutingLaneConfig {
  adapter: RoutingProviderAdapter;
  concurrency: 1;
}

export interface RoutingLane {
  enqueue(
    job: RoutingJob,
    priority: JobPriority,
  ): Promise<RepairRouteResult>;
  whenIdle(): Promise<void>;
  cancel(reason?: unknown): void;
}

interface QueuedJob {
  job: RoutingJob;
  resolve: (result: RepairRouteResult) => void;
  reject: (reason?: unknown) => void;
}

export function createRoutingLane({
  adapter,
}: RoutingLaneConfig): RoutingLane {
  const automaticQueue: QueuedJob[] = [];
  const manualQueue: QueuedJob[] = [];
  const idleWaiters: Array<() => void> = [];
  let active = false;
  let activeController: AbortController | null = null;
  let canceledReason: unknown;

  const resolveIdleWaiters = () => {
    if (
      active ||
      automaticQueue.length > 0 ||
      manualQueue.length > 0
    ) {
      return;
    }
    idleWaiters.splice(0).forEach((resolve) => resolve());
  };

  const runNext = async (): Promise<void> => {
    if (active) {
      return;
    }
    const next = manualQueue.shift() ?? automaticQueue.shift();
    if (!next) {
      resolveIdleWaiters();
      return;
    }

    active = true;
    activeController = new AbortController();
    try {
      next.resolve(
        await adapter.route(next.job, activeController.signal),
      );
    } catch (error) {
      next.reject(error);
    } finally {
      active = false;
      activeController = null;
      void runNext();
    }
  };

  return {
    enqueue(job, priority) {
      if (canceledReason !== undefined) {
        return Promise.reject(canceledReason);
      }

      const promise = new Promise<RepairRouteResult>(
        (resolve, reject) => {
          const queued = { job, resolve, reject };
          if (priority === "manual") {
            manualQueue.push(queued);
          } else {
            automaticQueue.push(queued);
          }
        },
      );
      void runNext();
      return promise;
    },

    whenIdle() {
      if (
        !active &&
        automaticQueue.length === 0 &&
        manualQueue.length === 0
      ) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },

    cancel(reason = abortError()) {
      if (canceledReason !== undefined) {
        return;
      }
      canceledReason = reason;
      activeController?.abort(reason);
      automaticQueue.splice(0).forEach(({ reject }) => reject(reason));
      manualQueue.splice(0).forEach(({ reject }) => reject(reason));
      resolveIdleWaiters();
    },
  };
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}
