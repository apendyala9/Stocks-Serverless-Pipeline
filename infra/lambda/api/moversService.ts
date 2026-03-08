import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { HISTORY_DAYS, MAX_HISTORY_LOOKBACK_DAYS, WATCHLIST } from '../ingestion/config';
import { getDateWithLookback } from '../ingestion/time';

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
  const winners: WinnerRecord[] = [];

  for (
    let lookback = 0;
    lookback <= MAX_HISTORY_LOOKBACK_DAYS && winners.length < HISTORY_DAYS;
    lookback += 1
  ) {
    const candidateDate = getDateWithLookback(lookback);
    const response = await documentClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: '#date = :dateValue',
        FilterExpression: 'isWinner = :winner',
        ExpressionAttributeNames: {
          '#date': 'date',
        },
        ExpressionAttributeValues: {
          ':dateValue': candidateDate,
          ':winner': true,
        },
        ProjectionExpression: '#date, tickerSymbol, percentChange, closingPrice',
        Limit: 7,
      })
    );

    const winnerItem = response.Items?.find((item) => isWinnerRecord(item));
    if (winnerItem) {
      winners.push(winnerItem);
    }
  }

  return winners;
};

export const fetchRecentHistory = async (tableName: string): Promise<HistoryDay[]> => {
  const history: HistoryDay[] = [];

  for (
    let lookback = 0;
    lookback <= MAX_HISTORY_LOOKBACK_DAYS && history.length < HISTORY_DAYS;
    lookback += 1
  ) {
    const candidateDate = getDateWithLookback(lookback);
    const response = await documentClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: '#date = :dateValue',
        ExpressionAttributeNames: {
          '#date': 'date',
        },
        ExpressionAttributeValues: {
          ':dateValue': candidateDate,
        },
        ProjectionExpression: '#date, tickerSymbol, percentChange, closingPrice, isWinner',
        Limit: 10,
      })
    );

    const records = (response.Items ?? []).filter((item): item is HistoryRecord => isHistoryRecord(item));
    if (records.length !== WATCHLIST.length) {
      continue;
    }

    history.push({
      date: candidateDate,
      movers: records.sort((left, right) => left.tickerSymbol.localeCompare(right.tickerSymbol)),
    });
  }

  return history;
};
