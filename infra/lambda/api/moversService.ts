import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { HISTORY_DAYS, MAX_HISTORY_LOOKBACK_DAYS } from '../ingestion/config';
import { getDateWithLookback } from '../ingestion/time';

export type WinnerRecord = {
  date: string;
  tickerSymbol: string;
  percentChange: number;
  closingPrice: number;
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
