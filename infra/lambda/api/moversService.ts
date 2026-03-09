import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { HISTORY_DAYS, MAX_HISTORY_LOOKBACK_DAYS, WATCHLIST } from '../ingestion/config';

export type WinnerRecord = {
  date: string;
  tickerSymbol: string;
  percentChange: number;
  closingPrice: number;
};

export type HistoryRecord = WinnerRecord & {
  isWinner: boolean;
};

export type HistoryDay = {
  date: string;
  movers: HistoryRecord[];
};

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const HISTORY_INDEX_NAME = 'HistoryByDateIndex';
const WINNERS_INDEX_NAME = 'WinnersByDateIndex';
const HISTORY_QUERY_LIMIT = (MAX_HISTORY_LOOKBACK_DAYS + 1) * WATCHLIST.length;

const isWinnerRecord = (item: unknown): item is WinnerRecord => {
  const candidate = item as Partial<WinnerRecord> | undefined;
  return Boolean(
    candidate &&
      typeof candidate.date === 'string' &&
      typeof candidate.tickerSymbol === 'string' &&
      typeof candidate.percentChange === 'number' &&
      typeof candidate.closingPrice === 'number'
  );
};

const isHistoryRecord = (item: unknown): item is HistoryRecord => {
  const candidate = item as Partial<HistoryRecord> | undefined;
  return Boolean(
    candidate &&
      typeof candidate.date === 'string' &&
      typeof candidate.tickerSymbol === 'string' &&
      typeof candidate.percentChange === 'number' &&
      typeof candidate.closingPrice === 'number' &&
      typeof candidate.isWinner === 'boolean'
  );
};

export const fetchRecentWinners = async (tableName: string): Promise<WinnerRecord[]> => {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: WINNERS_INDEX_NAME,
      KeyConditionExpression: '#gsi2pk = :pkValue',
      ExpressionAttributeNames: {
        '#date': 'date',
        '#gsi2pk': 'gsi2pk',
      },
      ExpressionAttributeValues: {
        ':pkValue': 'WINNERS',
      },
      ProjectionExpression: '#date, tickerSymbol, percentChange, closingPrice',
      ScanIndexForward: false,
      Limit: HISTORY_DAYS,
    })
  );

  return (response.Items ?? []).filter((item): item is WinnerRecord => isWinnerRecord(item));
};

export const fetchRecentHistory = async (tableName: string): Promise<HistoryDay[]> => {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: HISTORY_INDEX_NAME,
      KeyConditionExpression: '#gsi1pk = :pkValue',
      ExpressionAttributeNames: {
        '#date': 'date',
        '#gsi1pk': 'gsi1pk',
      },
      ExpressionAttributeValues: {
        ':pkValue': 'HISTORY',
      },
      ProjectionExpression: '#date, tickerSymbol, percentChange, closingPrice, isWinner',
      ScanIndexForward: false,
      Limit: HISTORY_QUERY_LIMIT,
    })
  );

  const groupedByDate = new Map<string, HistoryRecord[]>();
  const records = (response.Items ?? []).filter((item): item is HistoryRecord => isHistoryRecord(item));

  for (const record of records) {
    const existing = groupedByDate.get(record.date);
    if (existing) {
      existing.push(record);
      continue;
    }
    groupedByDate.set(record.date, [record]);
  }

  const history: HistoryDay[] = [];
  for (const [date, movers] of groupedByDate) {
    if (movers.length !== WATCHLIST.length) {
      continue;
    }

    history.push({
      date,
      movers: movers.sort((left, right) => left.tickerSymbol.localeCompare(right.tickerSymbol)),
    });

    if (history.length === HISTORY_DAYS) {
      break;
    }
  }

  return history;
};
