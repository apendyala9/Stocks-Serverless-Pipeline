import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { fetchRecentWinners } from './moversService';

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

    const movers = await fetchRecentWinners(tableName);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        data: movers,
      }),
    };
  } catch (error) {
    console.error('Movers API failed', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Failed to retrieve movers.',
      }),
    };
  }
};
