import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'node:path';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';

export class StocksIngestionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const configuredApiKey = process.env.MASSIVE_API_KEY;
    const massiveApiSecret = new secretsmanager.Secret(this, 'MassiveApiSecret', {
      secretName: 'massive_api_secret',
      description: 'Secret for the Massive API',
      ...(configuredApiKey
        ? { secretStringValue: cdk.SecretValue.unsafePlainText(configuredApiKey) }
        : {
            generateSecretString: {
              generateStringKey: 'MASSIVE_API_KEY',
              secretStringTemplate: '{}',
            },
          }),
    });

    const dailyWinnersTable = new dynamodb.Table(this, 'DailyStockWinnersTable', {
      partitionKey: { name: 'date', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const ingestionLambda = new lambdaNodejs.NodejsFunction(this, 'StockIngestionLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/ingestion/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        WINNERS_TABLE_NAME: dailyWinnersTable.tableName,
        MASSIVE_API_KEY: massiveApiSecret.secretValue.unsafeUnwrap(),
      },
      bundling: {
        sourceMap: true,
      },
    });

    dailyWinnersTable.grantWriteData(ingestionLambda);

    const schedulerRole = new iam.Role(this, 'DailyIngestionSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [ingestionLambda.functionArn],
      })
    );

    const dailyIngestionSchedule = new scheduler.CfnSchedule(this, 'DailyIngestionSchedule', {
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: 'cron(0 21 * * ? *)',
      scheduleExpressionTimezone: 'America/New_York',
      target: {
        arn: ingestionLambda.functionArn,
        roleArn: schedulerRole.roleArn,
      },
      description: 'Run stock ingestion daily after US market close.',
      state: 'ENABLED',
    });

    ingestionLambda.addPermission('AllowSchedulerInvoke', {
      principal: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      sourceArn: dailyIngestionSchedule.attrArn,
      action: 'lambda:InvokeFunction',
    });
  }
}
