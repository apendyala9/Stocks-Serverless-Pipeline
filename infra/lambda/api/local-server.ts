import * as path from 'node:path';
import { createServer } from 'node:http';
import * as dotenv from 'dotenv';
import { fetchRecentWinners } from './moversService';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const port = Number(process.env.LOCAL_API_PORT ?? 4000);

const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.url !== '/movers' || request.method !== 'GET') {
    response.statusCode = 404;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ message: 'Not found' }));
    return;
  }

  try {
    const tableName = process.env.WINNERS_TABLE_NAME;
    if (!tableName) {
      throw new Error('WINNERS_TABLE_NAME is not configured.');
    }

    const movers = await fetchRecentWinners(tableName);
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ data: movers }));
  } catch (error) {
    console.error('Local movers API failed', error);
    response.statusCode = 500;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ message: 'Failed to retrieve movers.' }));
  }
});

server.listen(port, () => {
  console.info(`Local movers API listening on http://localhost:${port}`);
});
