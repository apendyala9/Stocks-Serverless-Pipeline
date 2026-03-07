import {
  MASSIVE_REQUEST_INTERVAL_MS,
  MAX_429_RETRIES,
  MAX_RETRY_DELAY_MS,
} from './config';
import type { HttpErrorWithResponse } from './types';

let nextMassiveRequestAt = 0;
let massiveRequestQueue: Promise<void> = Promise.resolve();

export const sleep = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

/**
 * Serialize Massive API calls and enforce a minimum delay between requests.
 */
export const scheduleMassiveRequest = async <T>(request: () => Promise<T>): Promise<T> => {
  const scheduledRequest = massiveRequestQueue.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, nextMassiveRequestAt - now);
    if (waitMs > 0) {
      console.info(`Throttling Massive request for ${waitMs}ms to stay within 5 requests/minute.`);
      await sleep(waitMs);
    }

    // Reserve the next slot before issuing the request so concurrent callers remain spaced.
    nextMassiveRequestAt = Date.now() + MASSIVE_REQUEST_INTERVAL_MS;
    return request();
  });

  // Keep queue alive even when a request fails.
  massiveRequestQueue = scheduledRequest.then(
    () => undefined,
    () => undefined
  );

  return scheduledRequest;
};

export const isRateLimitedError = (error: unknown): boolean =>
  (error as HttpErrorWithResponse)?.response?.status === 429;

const getHeaderValue = (
  headers: Record<string, string | number | undefined> | undefined,
  key: string
): string | number | undefined => {
  if (!headers) {
    return undefined;
  }

  const directValue = headers[key];
  if (directValue !== undefined) {
    return directValue;
  }

  const normalizedKey = Object.keys(headers).find(
    (headerKey) => headerKey.toLowerCase() === key.toLowerCase()
  );
  return normalizedKey ? headers[normalizedKey] : undefined;
};

/**
 * Compute retry delay for 429 responses using Retry-After if present.
 */
export const getRetryDelayMs = (attempt: number, error: unknown): number => {
  const retryAfterHeader = getHeaderValue(
    (error as HttpErrorWithResponse)?.response?.headers,
    'retry-after'
  );

  if (typeof retryAfterHeader === 'number' && Number.isFinite(retryAfterHeader)) {
    return Math.min(Math.max(0, retryAfterHeader * 1000), MAX_RETRY_DELAY_MS);
  }

  if (typeof retryAfterHeader === 'string') {
    const parsedSeconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(parsedSeconds)) {
      return Math.min(Math.max(0, parsedSeconds * 1000), MAX_RETRY_DELAY_MS);
    }
  }

  const exponentialDelayMs = MASSIVE_REQUEST_INTERVAL_MS * 2 ** (attempt - 1);
  return Math.min(exponentialDelayMs, MAX_RETRY_DELAY_MS);
};

export { MAX_429_RETRIES };
