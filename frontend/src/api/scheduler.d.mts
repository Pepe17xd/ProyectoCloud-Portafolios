export type ScheduledRequestOptions<T> = {
  method?: string;
  key?: string;
  run: () => Promise<T>;
};

export type RequestScheduler = {
  schedule: <T>(options: ScheduledRequestOptions<T>) => Promise<T>;
};

export function createRequestScheduler(options?: {
  maxConcurrent?: number;
  retryDelayMs?: number;
}): RequestScheduler;
