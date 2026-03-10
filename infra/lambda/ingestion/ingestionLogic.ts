import { HISTORY_DAYS, MAX_HISTORY_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS, WATCHLIST } from './config';
import { storeResultsForDate } from './dynamo';
import { fetchTickerForDate } from './massiveApi';
import { getDateWithLookback } from './time';
import type { DatedTickerResult, MassiveRestClient, TickerResult } from './types';

/**
 * Fetch open/close data for all watchlist tickers on a date.
 * If any ticker is missing data, returns an empty array.
 */
const fetchResultsForDate = async (
  rest: MassiveRestClient,
  date: string
): Promise<TickerResult[]> => {
  const candidateResults = await Promise.all(
    WATCHLIST.map((ticker) => fetchTickerForDate(rest, ticker, date))
  );

  if (candidateResults.some((result) => result === null)) {
    return [];
  }

  return candidateResults as TickerResult[];
};

/**
 * Fetch historical daily data for a single ticker, up to HISTORY_DAYS market days.
 */
const fetchHistory = async (rest: MassiveRestClient, ticker: string): Promise<DatedTickerResult[]> => {
  const history: DatedTickerResult[] = [];

  for (
    let lookback = 1;
    lookback <= MAX_HISTORY_LOOKBACK_DAYS && history.length < HISTORY_DAYS;
    lookback += 1
  ) {
    const candidateDate = getDateWithLookback(lookback);
    const result = await fetchTickerForDate(rest, ticker, candidateDate);
    if (!result) {
      continue;
    }
    history.push({ ...result, date: candidateDate });
  }

  return history;
};

/**
 * Find the most recent market day with complete data for all watchlist tickers.
 */
export const getLatestMarketDateResults = async (
  rest: MassiveRestClient
): Promise<{ date: string; results: TickerResult[] }> => {
  for (let lookback = 1; lookback <= MAX_LOOKBACK_DAYS; lookback += 1) {
    const candidateDate = getDateWithLookback(lookback);
    const candidateResults = await fetchResultsForDate(rest, candidateDate);

    if (candidateResults.length === WATCHLIST.length) {
      return { date: candidateDate, results: candidateResults };
    }
  }

  throw new Error('No valid market data found in lookback window.');
};

/**
 * Backfill HISTORY_DAYS worth of per-ticker data into DynamoDB when table is empty.
 */
export const backfillHistory = async (rest: MassiveRestClient, tableName: string): Promise<string[]> => {
  const tickerHistories = await Promise.all(WATCHLIST.map((ticker) => fetchHistory(rest, ticker)));

  const resultsByDate = new Map<string, TickerResult[]>();
  for (const tickerHistory of tickerHistories) {
    for (const entry of tickerHistory) {
      const existing = resultsByDate.get(entry.date) ?? [];
      existing.push({
        symbol: entry.symbol,
        open: entry.open,
        close: entry.close,
        percentChange: entry.percentChange,
      });
      resultsByDate.set(entry.date, existing);
    }
  }

  const completeDates = [...resultsByDate.entries()]
    .filter(([, dayResults]) => dayResults.length === WATCHLIST.length)
    .map(([date]) => date)
    .sort((left, right) => right.localeCompare(left))
    .slice(0, HISTORY_DAYS);

  if (completeDates.length < HISTORY_DAYS) {
    throw new Error('Unable to gather 7 complete historical market days.');
  }

  for (const date of completeDates) {
    const dayResults = resultsByDate.get(date);
    if (!dayResults) {
      continue;
    }
    await storeResultsForDate(tableName, date, dayResults);
  }

  return completeDates;
};
