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

    template.resourceCountIs('AWS::Lambda::Function', 1);
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

  test('creates daily scheduler and grants scheduler invoke permission on lambda', () => {
    const template = createTemplate();

    template.resourceCountIs('AWS::Scheduler::Schedule', 1);
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      FlexibleTimeWindow: { Mode: 'OFF' },
      ScheduleExpression: 'cron(0 21 * * ? *)',
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
