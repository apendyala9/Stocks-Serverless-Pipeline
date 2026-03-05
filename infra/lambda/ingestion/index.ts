import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { restClient } from '@massive.com/client-js';
import type { EventBridgeEvent } from 'aws-lambda';

const WATCHLIST = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'] as const;
const MARKET_TIMEZONE = 'America/New_York';
const MAX_LOOKBACK_DAYS = 7;

const dynamoDbDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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

const getDateWithLookback = (daysAgo: number): string => {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return formatDateForTimezone(date, MARKET_TIMEZONE);
};

const calculatePercentChange = (open: number, close: number): number =>
  ((close - open) / open) * 100;

const fetchResultsForDate = async (
  rest: ReturnType<typeof restClient>,
  date: string
): Promise<TickerResult[]> => {
  const results: TickerResult[] = [];

  for (const ticker of WATCHLIST) {
    try {
      const response = (await rest.getStocksOpenClose({
        stocksTicker: ticker,
        date,
        adjusted: true,
      })) as OpenCloseData;

      if (
        response.status !== 'OK' ||
        typeof response.open !== 'number' ||
        typeof response.close !== 'number'
      ) {
        return [];
      }

      results.push({
        symbol: response.symbol ?? ticker,
        open: response.open,
        close: response.close,
        percentChange: calculatePercentChange(response.open, response.close),
      });
    } catch (error) {
      console.warn(`Unable to fetch ${ticker} for ${date}`, error);
      return [];
    }
  }

  return results;
};

export const handler = async (_event: EventBridgeEvent<string, unknown>) => {
  try {
    const apiKey = process.env.MASSIVE_API_KEY;
    const tableName = process.env.WINNERS_TABLE_NAME;

    if (!apiKey) {
      throw new Error('MASSIVE_API_KEY is not configured.');
    }

    if (!tableName) {
      throw new Error('WINNERS_TABLE_NAME is not configured.');
    }

    const rest = restClient(apiKey, 'https://api.massive.com');

    let selectedDate: string | undefined;
    let selectedResults: TickerResult[] = [];

    for (let lookback = 0; lookback <= MAX_LOOKBACK_DAYS; lookback += 1) {
      const candidateDate = getDateWithLookback(lookback);
      const candidateResults = await fetchResultsForDate(rest, candidateDate);

      if (candidateResults.length === WATCHLIST.length) {
        selectedDate = candidateDate;
        selectedResults = candidateResults;
        break;
      }
    }

    if (!selectedDate || selectedResults.length === 0) {
      throw new Error('No valid market data found in lookback window.');
    }

    const winner = selectedResults.reduce((currentWinner, candidate) =>
      Math.abs(candidate.percentChange) > Math.abs(currentWinner.percentChange)
        ? candidate
        : currentWinner
    );

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          date: selectedDate,
          tickerSymbol: winner.symbol,
          percentChange: Number(winner.percentChange.toFixed(4)),
          closingPrice: Number(winner.close.toFixed(4)),
        },
        ConditionExpression: 'attribute_not_exists(#date)',
        ExpressionAttributeNames: {
          '#date': 'date',
        },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Daily stock winner stored.',
        date: selectedDate,
        tickerSymbol: winner.symbol,
        percentChange: winner.percentChange,
        closingPrice: winner.close,
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