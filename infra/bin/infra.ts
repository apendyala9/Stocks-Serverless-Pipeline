#!/usr/bin/env node
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import * as cdk from 'aws-cdk-lib';
import { StocksIngestionStack } from '../lib/infra-stack';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = new cdk.App();
new StocksIngestionStack(app, 'StocksIngestionStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
 
});
