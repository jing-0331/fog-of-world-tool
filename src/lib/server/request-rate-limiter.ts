export interface RequestRateLimiter {
  acquire(signal?: AbortSignal): Promise<void>;
}
