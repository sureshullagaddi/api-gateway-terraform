'use strict';

/**
 * provisioners/base.js
 *
 * Shared AWS SDK clients and helper utilities used by all provisioners.
 * Each provisioner (http-public, http-jwt, etc.) imports from here.
 */

const {
  ApiGatewayV2Client,
  CreateApiCommand,
  CreateIntegrationCommand,
  CreateRouteCommand,
  CreateStageCommand,
  CreateAuthorizerCommand,
  DeleteApiCommand,
} = require('@aws-sdk/client-apigatewayv2');

const {
  LambdaClient,
  AddPermissionCommand,
  RemovePermissionCommand,
} = require('@aws-sdk/client-lambda');

const {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  PutRetentionPolicyCommand,
  DeleteLogGroupCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

const REGION = process.env.AWS_ACCOUNT_REGION;

const apigw  = new ApiGatewayV2Client({ region: REGION });
const lambda = new LambdaClient({ region: REGION });
const logs   = new CloudWatchLogsClient({ region: REGION });

/**
 * Creates the base HTTP API + Lambda integration + stage.
 * Used by all HTTP API provisioners.
 * Returns: { apiId, integrationId, apiEndpoint }
 */
async function createHttpApiBase(apiName, environment, description) {
  // 1. Create the HTTP API
  const api = await apigw.send(new CreateApiCommand({
    Name:         `${apiName}-${environment}-api`,
    ProtocolType: 'HTTP',
    Description:  description,
  }));

  // 2. Create Lambda integration — points to EXISTING backend Lambda
  const integration = await apigw.send(new CreateIntegrationCommand({
    ApiId:                api.ApiId,
    IntegrationType:      'AWS_PROXY',
    IntegrationUri:       process.env.EXISTING_LAMBDA_ARN,
    PayloadFormatVersion: '2.0',
  }));

  // 3. Create $default stage with auto-deploy
  await apigw.send(new CreateStageCommand({
    ApiId:      api.ApiId,
    StageName:  '$default',
    AutoDeploy: true,
  }));

  // 4. Create CloudWatch log group
  const logGroupName = `/aws/apigateway/${apiName}-${environment}-api`;
  try {
    await logs.send(new CreateLogGroupCommand({ logGroupName }));
    await logs.send(new PutRetentionPolicyCommand({ logGroupName, retentionInDays: 14 }));
  } catch (e) {
    if (e.name !== 'ResourceAlreadyExistsException') throw e;
  }

  // 5. Allow API Gateway to invoke the existing Lambda
  await lambda.send(new AddPermissionCommand({
    FunctionName: process.env.EXISTING_LAMBDA_FUNCTION_NAME,
    StatementId:  `AllowAPIGW-${apiName}-${environment}`,
    Action:       'lambda:InvokeFunction',
    Principal:    'apigateway.amazonaws.com',
    SourceArn:    `arn:aws:execute-api:${REGION}:*:${api.ApiId}/*/*`,
    Qualifier:    'live',
  }));

  return {
    apiId:           api.ApiId,
    integrationId:   integration.IntegrationId,
    apiEndpoint:     api.ApiEndpoint,
    logGroupName,
  };
}

/**
 * Deletes an HTTP API and cleans up Lambda permission + log group.
 */
async function deleteHttpApiBase(apiId, apiName, environment) {
  // Remove Lambda permission
  try {
    await lambda.send(new RemovePermissionCommand({
      FunctionName: process.env.EXISTING_LAMBDA_FUNCTION_NAME,
      StatementId:  `AllowAPIGW-${apiName}-${environment}`,
      Qualifier:    'live',
    }));
  } catch (e) {
    console.warn(`[base] Could not remove Lambda permission: ${e.message}`);
  }

  // Delete the API (cascades — deletes routes, integrations, authorizers)
  await apigw.send(new DeleteApiCommand({ ApiId: apiId }));

  // Delete log group
  try {
    await logs.send(new DeleteLogGroupCommand({
      logGroupName: `/aws/apigateway/${apiName}-${environment}-api`,
    }));
  } catch (e) {
    console.warn(`[base] Could not delete log group: ${e.message}`);
  }
}

module.exports = {
  apigw, lambda, logs,
  createHttpApiBase,
  deleteHttpApiBase,
  CreateRouteCommand,
  CreateAuthorizerCommand,
  AddPermissionCommand,
  RemovePermissionCommand,
};

