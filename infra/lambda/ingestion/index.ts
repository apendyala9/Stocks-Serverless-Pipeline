import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { restClient } from '@massive.com/client-js';
import type { EventBridgeEvent } from 'aws-lambda';
import { WATCHLIST } from './config';
import { getWinnerSymbol, storeResultsForDate, tableHasAnyData } from './dynamo';
import { backfillHistory, getLatestMarketDateResults } from './ingestionLogic';
import type { HttpErrorWithResponse } from './types';
import { logger } from '../shared/logger';

const secretsClient = new SecretsManagerClient({});

// Cache the API key in the Lambda execution context to avoid calling Secrets Manager on every invocation
let cachedApiKey: string | null = null;

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
    const candidate = error as HttpErrorWithResponse;
    logger.error('Ingestion failed', {
      errorName: candidate.name ?? 'UnknownError',
      errorCode: candidate.code,
      errorMessage: candidate.message ?? 'Unknown failure',
      statusCode: candidate.response?.status,
      requestId: candidate.response?.data?.request_id,
      providerMessage: candidate.response?.data?.message,
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Ingestion failed.' }),
    };
  }
};
