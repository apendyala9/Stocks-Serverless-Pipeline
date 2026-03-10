import {
  MAX_429_RETRIES,
  getRetryDelayMs,
  isRateLimitedError,
  scheduleMassiveRequest,
  sleep,
} from './massiveRateLimiter';
import { logger } from '../shared/logger';
import type { HttpErrorWithResponse, MassiveRestClient, OpenCloseData, TickerResult } from './types';

const getSafeErrorContext = (error: unknown) => {
  const candidate = error as HttpErrorWithResponse;
  return {
    errorName: candidate.name ?? 'UnknownError',
    errorCode: candidate.code,
    errorMessage: candidate.message ?? 'Unknown failure',
    statusCode: candidate.response?.status,
    requestId: candidate.response?.data?.request_id,
    providerMessage: candidate.response?.data?.message,
  };
};

/**
 * Compute percent change between open and close prices.
 */
export const calculatePercentChange = (open: number, close: number): number =>
  ((close - open) / open) * 100;

/**
 * Fetch open/close data for a single ticker on a specific date.
 */
export const fetchTickerForDate = async (
  rest: MassiveRestClient,
  ticker: string,
  date: string
): Promise<TickerResult | null> => {
  for (let attempt = 1; attempt <= MAX_429_RETRIES + 1; attempt += 1) {
    try {
      const response = (await scheduleMassiveRequest(() =>
        rest.getStocksOpenClose({
          stocksTicker: ticker,
          date,
          adjusted: true,
        })
      )) as OpenCloseData;

      if (
        response.status !== 'OK' ||
        typeof response.open !== 'number' ||
        typeof response.close !== 'number'
      ) {
        return null;
      }

      return {
        symbol: response.symbol ?? ticker,
        open: response.open,
        close: response.close,
        percentChange: calculatePercentChange(response.open, response.close),
      };
    } catch (error) {
      if (!isRateLimitedError(error) || attempt > MAX_429_RETRIES) {
        logger.warn('Unable to fetch ticker daily open/close data', {
          ticker,
          date,
          attempt,
          ...getSafeErrorContext(error),
        });
        return null;
      }

      const retryDelayMs = getRetryDelayMs(attempt, error);
      logger.warn('Massive rate limit hit, retrying request', {
        ticker,
        date,
        attempt,
        maxRetries: MAX_429_RETRIES,
        retryDelayMs,
      });
      await sleep(retryDelayMs);
    }
  }

  return null;
};
