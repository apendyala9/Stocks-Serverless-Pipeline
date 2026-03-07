import {
  MAX_429_RETRIES,
  getRetryDelayMs,
  isRateLimitedError,
  scheduleMassiveRequest,
  sleep,
} from './massiveRateLimiter';
import type { MassiveRestClient, OpenCloseData, TickerResult } from './types';

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
        console.warn(`Unable to fetch ${ticker} for ${date}`, error);
        return null;
      }

      const retryDelayMs = getRetryDelayMs(attempt, error);
      console.warn(
        `Massive rate limit hit for ${ticker} on ${date}. Retrying in ${retryDelayMs}ms (attempt ${attempt}/${MAX_429_RETRIES}).`
      );
      await sleep(retryDelayMs);
    }
  }

  return null;
};
