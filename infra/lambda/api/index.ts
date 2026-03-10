import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { fetchRecentHistory, fetchRecentWinners } from './moversService';
import { logger } from '../shared/logger';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Content-Type': 'application/json',
};

export const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.WINNERS_TABLE_NAME;
    if (!tableName) {
      throw new Error('WINNERS_TABLE_NAME is not configured.');
    }

    const requestPath = _event.path ?? '';
    const isHistoryRequest = requestPath.endsWith('/history');
    const payload = isHistoryRequest
      ? await fetchRecentHistory(tableName)
      : await fetchRecentWinners(tableName);

    const isEmpty = !payload || payload.length === 0;
    const cacheControl = isEmpty
      ? 'public, max-age=60, stale-while-revalidate=30'
      : 'public, max-age=3600, stale-while-revalidate=300';

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': cacheControl,
      },
      body: JSON.stringify({
        data: payload,
      }),
    };
  } catch (error) {
    logger.error('Stocks API failed', { error });
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Failed to retrieve data.',
      }),
    };
  }
};
