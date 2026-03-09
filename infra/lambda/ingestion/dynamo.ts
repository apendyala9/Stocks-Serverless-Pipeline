import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { TTL_MONTHS } from './config';
import { getEpochSecondsForDatePlusMonths } from './time';
import type { TickerResult } from './types';

const dynamoDbDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Compute TTL for a record based on its date (not `now`).
 */
const getExpiresAtForRecordDate = (recordDate: string): number =>
  getEpochSecondsForDatePlusMonths(recordDate, TTL_MONTHS);

/**
 * Check whether the winners table already contains at least one item.
 */
export const tableHasAnyData = async (tableName: string): Promise<boolean> => {
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
 * Determine the winner ticker for a day by absolute percent change.
 */
export const getWinnerSymbol = (results: TickerResult[]): string => {
  const winner = results.reduce((currentWinner, candidate) =>
    Math.abs(candidate.percentChange) > Math.abs(currentWinner.percentChange)
      ? candidate
      : currentWinner
  );
  return winner.symbol;
};

/**
 * Persist all ticker results for a single trading date into DynamoDB.
 */
export const storeResultsForDate = async (
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
              gsi1pk: 'HISTORY',
              gsi1sk: `${date}#${result.symbol}`,
              ...(result.symbol === winnerSymbol
                ? {
                    gsi2pk: 'WINNERS',
                    gsi2sk: `${date}#${result.symbol}`,
                  }
                : {}),
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
