import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

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
    dailyWinnersTable.addGlobalSecondaryIndex({
      indexName: 'HistoryByDateIndex',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    dailyWinnersTable.addGlobalSecondaryIndex({
      indexName: 'WinnersByDateIndex',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Create the ingestion lambda
    const ingestionLambda = new lambdaNodejs.NodejsFunction(this, 'StockIngestionLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/ingestion/index.ts'),
      handler: 'handler',
      // Backfills can take several minutes when honoring upstream API rate limits.
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_MONTH,
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

    const moversApiLambda = new lambdaNodejs.NodejsFunction(this, 'MoversApiLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/api/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        WINNERS_TABLE_NAME: dailyWinnersTable.tableName,
      },
      bundling: {
        sourceMap: true,
      },
    });
    dailyWinnersTable.grantReadData(moversApiLambda);

    const moversApi = new apigateway.RestApi(this, 'MoversRestApi', {
      restApiName: 'MoversService',
      description: 'REST API for retrieving winning stock movers.',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'OPTIONS'],
      },
    });

    const moversResource = moversApi.root.addResource('movers');
    moversResource.addMethod('GET', new apigateway.LambdaIntegration(moversApiLambda));
    const historyResource = moversApi.root.addResource('history');
    historyResource.addMethod('GET', new apigateway.LambdaIntegration(moversApiLambda));

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

    const websiteBucket = new s3.Bucket(this, 'MoversFrontendBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const frontendDistPath = path.join(__dirname, '../../frontend/dist');
    const frontendSource = fs.existsSync(frontendDistPath)
      ? s3deploy.Source.asset(frontendDistPath)
      : s3deploy.Source.data(
          'index.html',
          '<!doctype html><html><body><h1>Frontend artifact missing</h1><p>Run frontend build before deploy.</p></body></html>'
        );

    new s3deploy.BucketDeployment(this, 'DeployMoversFrontend', {
      destinationBucket: websiteBucket,
      sources: [frontendSource],
    });

    const distribution = new cloudfront.Distribution(this, 'MoversDistribution', {
      defaultBehavior: {
        origin: new origins.S3StaticWebsiteOrigin(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        'movers*': {
          origin: new origins.RestApiOrigin(moversApi),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          // Look at cache-control header for the actual cache policy
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        'history*': {
          origin: new origins.RestApiOrigin(moversApi),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
    });

    new cdk.CfnOutput(this, 'MoversApiUrl', {
      value: `${moversApi.url}movers`,
      description: 'GET endpoint for recent winning stock movers.',
    });
    new cdk.CfnOutput(this, 'HistoryApiUrl', {
      value: `${moversApi.url}history`,
      description: 'GET endpoint for full stock history used by charts.',
    });

    new cdk.CfnOutput(this, 'MoversWebsiteUrl', {
      value: websiteBucket.bucketWebsiteUrl,
      description: 'S3 static website URL for movers frontend.',
    });
    new cdk.CfnOutput(this, 'MoversCloudFrontUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront URL for frontend and cached API routes.',
    });
  }
}
