import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { StocksIngestionStack } from '../lib/infra-stack';

const createTemplate = (): Template => {
  const app = new cdk.App();
  const stack = new StocksIngestionStack(app, 'StocksIngestionTestStack');
  return Template.fromStack(stack);
};

describe('StocksIngestionStack', () => {
  test('creates the Massive API secret with generated key config', () => {
    const template = createTemplate();

    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'massive_api_secret',
      Description: 'Secret for the Massive API',
      GenerateSecretString: {
        GenerateStringKey: 'MASSIVE_API_KEY',
        SecretStringTemplate: '{}',
      },
    });
  });

  test('creates a DynamoDB table with expected schema, ttl, and retain policies', () => {
    const template = createTemplate();

    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'date', KeyType: 'HASH' },
        { AttributeName: 'tickerSymbol', KeyType: 'RANGE' },
      ],
      TimeToLiveSpecification: {
        AttributeName: 'expiresAt',
        Enabled: true,
      },
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'HistoryByDateIndex',
          KeySchema: [
            { AttributeName: 'gsi1pk', KeyType: 'HASH' },
            { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
          ],
        }),
        Match.objectLike({
          IndexName: 'WinnersByDateIndex',
          KeySchema: [
            { AttributeName: 'gsi2pk', KeyType: 'HASH' },
            { AttributeName: 'gsi2sk', KeyType: 'RANGE' },
          ],
        }),
      ]),
    });

    const tables = template.findResources('AWS::DynamoDB::Table');
    const [table] = Object.values(tables) as Array<{
      DeletionPolicy?: string;
      UpdateReplacePolicy?: string;
    }>;
    expect(table.DeletionPolicy).toBe('Retain');
    expect(table.UpdateReplacePolicy).toBe('Retain');
  });

  test('creates ingestion lambda with expected runtime, timeout, memory, and env vars', () => {
    const template = createTemplate();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
      Timeout: 900,
      MemorySize: 256,
      Environment: {
        Variables: {
          WINNERS_TABLE_NAME: Match.anyValue(),
          MASSIVE_API_SECRET_ARN: Match.anyValue(),
        },
      },
    });
  });

  test('creates movers api lambda with expected runtime, timeout, and env vars', () => {
    const template = createTemplate();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
      Timeout: 30,
      MemorySize: 256,
      Environment: {
        Variables: {
          WINNERS_TABLE_NAME: Match.anyValue(),
        },
      },
    });
  });

  test('configures one-month CloudWatch log retention for both lambdas', () => {
    const template = createTemplate();

    template.resourceCountIs('Custom::LogRetention', 2);
    template.hasResourceProperties('Custom::LogRetention', {
      RetentionInDays: 30,
    });
  });

  test('creates REST API route for GET /movers', () => {
    const template = createTemplate();

    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      Integration: {
        Type: 'AWS_PROXY',
      },
    });
  });

  test('creates S3 website bucket and deployment', () => {
    const template = createTemplate();

    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResourceProperties('AWS::S3::Bucket', {
      WebsiteConfiguration: {
        IndexDocument: 'index.html',
        ErrorDocument: 'index.html',
      },
    });

    template.resourceCountIs('Custom::CDKBucketDeployment', 1);
  });

  test('creates daily scheduler and grants scheduler invoke permission on lambda', () => {
    const template = createTemplate();

    template.resourceCountIs('AWS::Scheduler::Schedule', 1);
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      FlexibleTimeWindow: { Mode: 'OFF' },
      ScheduleExpression: 'cron(30 0 * * ? *)',
      ScheduleExpressionTimezone: 'America/New_York',
      State: 'ENABLED',
      Target: {
        Arn: Match.anyValue(),
        RoleArn: Match.anyValue(),
      },
    });

    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'scheduler.amazonaws.com',
      SourceArn: Match.anyValue(),
    });
  });
});
