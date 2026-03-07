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

    // Secret is created with a generated placeholder. Set the real API key in AWS after deploy:
    const massiveApiSecret = new secretsmanager.Secret(this, 'MassiveApiSecret', {
      secretName: 'massive_api_secret',
      description: 'Secret for the Massive API',
      generateSecretString: {
        generateStringKey: 'MASSIVE_API_KEY',
        secretStringTemplate: '{}',
      },
    });

    const dailyWinnersTable = new dynamodb.Table(this, 'DailyStockWinnersTable', {
      partitionKey: { name: 'date', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'tickerSymbol', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'expiresAt',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Create the ingestion lambda
    const ingestionLambda = new lambdaNodejs.NodejsFunction(this, 'StockIngestionLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/ingestion/index.ts'),
      handler: 'handler',
      // Backfills can take several minutes when honoring upstream API rate limits.
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
      environment: {
        WINNERS_TABLE_NAME: dailyWinnersTable.tableName,
        // Pass secret ARN only; Lambda fetches the value at runtime (never put secrets in env vars)
        MASSIVE_API_SECRET_ARN: massiveApiSecret.secretArn,
      },
      bundling: {
        sourceMap: true,
      },
    });

    // Grant the ingestion lambda read/write access to the daily winners table
    dailyWinnersTable.grantReadWriteData(ingestionLambda);
    // Grant read access to the API key secret so Lambda can fetch it at runtime
    massiveApiSecret.grantRead(ingestionLambda);

    // Create the scheduler role
    const schedulerRole = new iam.Role(this, 'DailyIngestionSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [ingestionLambda.functionArn],
      })
    );

    // Create the daily ingestion schedule
    // Run the ingestion lambda daily after US market close
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

    // Add the permission to allow the scheduler to invoke the ingestion lambda
    ingestionLambda.addPermission('AllowSchedulerInvoke', {
      principal: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      sourceArn: dailyIngestionSchedule.attrArn,
      action: 'lambda:InvokeFunction',
    });
  }
}
