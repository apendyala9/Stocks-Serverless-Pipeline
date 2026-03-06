import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { restClient } from '@massive.com/client-js';
import type { EventBridgeEvent } from 'aws-lambda';

const WATCHLIST = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'] as const;
const MARKET_TIMEZONE = 'America/New_York';
const MAX_LOOKBACK_DAYS = 7;
const HISTORY_DAYS = 7;
const MAX_HISTORY_LOOKBACK_DAYS = 30;
const TTL_DAYS = 7;
const SECONDS_PER_DAY = 24 * 60 * 60;

const dynamoDbDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});

// Cache the API key in the Lambda execution context to avoid calling Secrets Manager on every invocation
let cachedApiKey: string | null = null;

type OpenCloseData = {
  status?: string;
  symbol?: string;
  open?: number;
  close?: number;
};

type TickerResult = {
  symbol: string;
  open: number;
  close: number;
  percentChange: number;
};

type DatedTickerResult = TickerResult & {
  date: string;
};

/**
 * Fetch the Massive API key from Secrets Manager, caching per cold start.
 *
 * @returns Massive REST API key string
 */
const getMassiveApiKey = async (): Promise<string> => {
  if (cachedApiKey) return cachedApiKey;
  const secretArn = process.env.MASSIVE_API_SECRET_ARN;
  if (!secretArn) throw new Error('MASSIVE_API_SECRET_ARN is not configured.');
  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );
  const raw = response.SecretString;
  if (!raw) throw new Error('Secret value is empty.');
  try {
    const parsed = JSON.parse(raw) as { MASSIVE_API_KEY?: string };
    cachedApiKey = parsed.MASSIVE_API_KEY ?? raw;
  } catch {
    cachedApiKey = raw;
  }
  return cachedApiKey as string;
};

/**
 * Format a Date into `YYYY-MM-DD` in the given IANA timezone.
 *
 * @param date - JavaScript Date to format
 * @param timeZone - IANA timezone identifier (e.g. `'America/New_York'`)
 * @returns Date-only string in `YYYY-MM-DD` format
 */
const formatDateForTimezone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Failed to format date in target timezone.');
  }

  return `${year}-${month}-${day}`;
};

/**
 * Get a date string in market timezone for N days ago.
 *
 * @param daysAgo - Number of days to look back from `Date.now()`
 * @returns Date string `YYYY-MM-DD` in market timezone
 */
const getDateWithLookback = (daysAgo: number): string => {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return formatDateForTimezone(date, MARKET_TIMEZONE);
};

/**
 * Compute percent change between open and close prices.
 *
 * @param open - Opening price
 * @param close - Closing price
 * @returns Percent change as a number (e.g. 5.3 for +5.3%)
 */
const calculatePercentChange = (open: number, close: number): number =>
  ((close - open) / open) * 100;

/**
 * Fetch open/close data for a single ticker on a specific date.
 *
 * @param rest - Massive REST client
 * @param ticker - Stock ticker symbol
 * @param date - Trading date in `YYYY-MM-DD` format
 * @returns TickerResult or `null` if data is unavailable
 */
const fetchTickerForDate = async (
  rest: ReturnType<typeof restClient>,
  ticker: string,
  date: string
): Promise<TickerResult | null> => {
  try {
    // Fetch the open/close data for the ticker on the given date
    const response = (await rest.getStocksOpenClose({
      stocksTicker: ticker,
      date,
      adjusted: true,
    })) as OpenCloseData;

    // If the response is not OK, or the open or close price is not a number, return null
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
    console.warn(`Unable to fetch ${ticker} for ${date}`, error);
    return null;
  }
};

/**
 * Fetch open/close data for all watchlist tickers on a date.
 * If any ticker is missing data, returns an empty array.
 *
 * @param rest - Massive REST client
 * @param date - Trading date in `YYYY-MM-DD` format
 * @returns Array of TickerResult for all tickers, or `[]` on incomplete data
 */
const fetchResultsForDate = async (
  rest: ReturnType<typeof restClient>,
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
 *
 * @param rest - Massive REST client
 * @param ticker - Stock ticker symbol
 * @returns Array of DatedTickerResult ordered from most recent lookback to older
 */
const fetchHistory = async (
  rest: ReturnType<typeof restClient>,
  ticker: string
): Promise<DatedTickerResult[]> => {
  const history: DatedTickerResult[] = [];

  for (
    let lookback = 0;
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
 * Determine the winner ticker for a day by absolute percent change.
 *
 * @param results - Per-ticker results for a day
 * @returns Symbol of the winning ticker
 */
const getWinnerSymbol = (results: TickerResult[]): string => {
  const winner = results.reduce((currentWinner, candidate) =>
    Math.abs(candidate.percentChange) > Math.abs(currentWinner.percentChange)
      ? candidate
      : currentWinner
  );
  return winner.symbol;
};

/**
 * Compute TTL for a record based on its date (not `now`).
 *
 * @param recordDate - Date string `YYYY-MM-DD` representing the trading day
 * @returns Unix epoch seconds when the row should expire
 */
const getExpiresAtForRecordDate = (recordDate: string): number =>
  Math.floor(new Date(recordDate).getTime() / 1000) + TTL_DAYS * SECONDS_PER_DAY;

/**
 * Check whether the winners table already contains at least one item.
 *
 * @param tableName - DynamoDB table name
 * @returns `true` if at least one item exists, otherwise `false`
 */
const tableHasAnyData = async (tableName: string): Promise<boolean> => {
  const scanResult = await dynamoDbDocumentClient.send(
    new ScanCommand({
      TableName: tableName,
      Limit: 1,
      ProjectionExpression: '#date',
      ExpressionAttributeNames: {
        '#date': 'date',
      },
    })
  );
  return (scanResult.Items?.length ?? 0) > 0;
};

/**
 * Persist all ticker results for a single trading date into DynamoDB.
 * Writes one row per ticker and flags the daily winner with `isWinner=true`.
 *
 * @param tableName - DynamoDB table name
 * @param date - Trading date in `YYYY-MM-DD` format
 * @param results - Per-ticker results for this date
 */
const storeResultsForDate = async (
  tableName: string,
  date: string,
  results: TickerResult[]
): Promise<void> => {
  const winnerSymbol = getWinnerSymbol(results);
  const expiresAt = getExpiresAtForRecordDate(date);

  await Promise.all(
    results.map(async (result) => {
      try {
        await dynamoDbDocumentClient.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              date,
              tickerSymbol: result.symbol,
              percentChange: Number(result.percentChange.toFixed(4)),
              closingPrice: Number(result.close.toFixed(4)),
              isWinner: result.symbol === winnerSymbol,
              expiresAt,
            },
            ConditionExpression: 'attribute_not_exists(#date) AND attribute_not_exists(#ticker)',
            ExpressionAttributeNames: {
              '#date': 'date',
              '#ticker': 'tickerSymbol',
            },
          })
        );
      } catch (error) {
        if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') {
          throw error;
        }
      }
    })
  );
};

/**
 * Find the most recent market day with complete data for all watchlist tickers.
 *
 * @param rest - Massive REST client
 * @returns Object containing the trading date and its per-ticker results
 */
const getLatestMarketDateResults = async (
  rest: ReturnType<typeof restClient>
): Promise<{ date: string; results: TickerResult[] }> => {
  for (let lookback = 0; lookback <= MAX_LOOKBACK_DAYS; lookback += 1) {
    const candidateDate = getDateWithLookback(lookback);
    const candidateResults = await fetchResultsForDate(rest, candidateDate);

    // If we have results for all tickers, return the date and results no need to continue
    if (candidateResults.length === WATCHLIST.length) {
      return { date: candidateDate, results: candidateResults };
    }
  }

  throw new Error('No valid market data found in lookback window.');
};

/**
 * Backfill HISTORY_DAYS worth of per-ticker data into DynamoDB when table is empty.
 * Fetches history per ticker in parallel and groups rows by trading date.
 *
 * @param rest - Massive REST client
 * @param tableName - DynamoDB table name
 * @returns Array of backfilled trading dates (strings)
 */
const backfillHistory = async (
  rest: ReturnType<typeof restClient>,
  tableName: string
): Promise<string[]> => {
  const tickerHistories = await Promise.all(
    WATCHLIST.map((ticker) => fetchHistory(rest, ticker))
  );

  // Group results by date
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

  // Filter out dates that don't have all tickers
  const completeDates = [...resultsByDate.entries()]
    .filter(([, dayResults]) => dayResults.length === WATCHLIST.length)
    .map(([date]) => date)
    .sort((left, right) => right.localeCompare(left))
    .slice(0, HISTORY_DAYS);

  // If we don't have enough complete dates, throw an error
  if (completeDates.length < HISTORY_DAYS) {
    throw new Error('Unable to gather 7 complete historical market days.');
  }

  // Store the results for each date
  for (const date of completeDates) {
    const dayResults = resultsByDate.get(date);
    if (!dayResults) {
      continue;
    }
    await storeResultsForDate(tableName, date, dayResults);
  }

  return completeDates;
};

/**
 * Lambda entrypoint. On first run, backfills historical rows; otherwise writes today only.
 *
 * @param _event - EventBridge schedule event (ignored payload)
 * @returns HTTP-style response with status and metadata about stored rows
 */
export const handler = async (_event: EventBridgeEvent<string, unknown>) => {
  try {
    const apiKey = await getMassiveApiKey();
    const tableName = process.env.WINNERS_TABLE_NAME;

    if (!tableName) {
      throw new Error('WINNERS_TABLE_NAME is not configured.');
    }

    const rest = restClient(apiKey, 'https://api.massive.com');
    const hasData = await tableHasAnyData(tableName);

    if (!hasData) {
      const insertedDates = await backfillHistory(rest, tableName);
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Backfilled historical stock rows.',
          backfilledDates: insertedDates,
          rowsPerDate: WATCHLIST.length,
        }),
      };
    }

    const latest = await getLatestMarketDateResults(rest);
    await storeResultsForDate(tableName, latest.date, latest.results);
    const winnerSymbol = getWinnerSymbol(latest.results);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Daily stock rows stored.',
        date: latest.date,
        winnerTickerSymbol: winnerSymbol,
        rowCount: WATCHLIST.length,
      }),
    };
  } catch (error) {
    console.error('Ingestion failed', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Ingestion failed.' }),
    };
  }
};
