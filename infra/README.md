# Infra Package

This package contains CDK infrastructure and Lambda code for the Stocks Serverless Pipeline.

Canonical project documentation lives in the root README:

- [`../README.md`](../README.md)

## Common Commands

- `npm run build` - compile TypeScript
- `npm run test` - run infra/lambda tests
- `npm run watch` - TypeScript watch mode
- `npm run dev:api` - run local API server (`/movers`, `/history`)
- `npx cdk synth` - synthesize CloudFormation template
- `npx cdk deploy` - deploy stack to AWS
