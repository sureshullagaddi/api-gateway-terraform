'use strict';

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

const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');

const REGION = process.env.AWS_ACCOUNT_REGION || process.env.AWS_REGION;

const apigw  = new ApiGatewayV2Client({ region: REGION });
const lambda = new LambdaClient({ region: REGION });
const logs   = new CloudWatchLogsClient({ region: REGION });
const sts    = new STSClient({ region: REGION });

// Cache account ID — fetched once per Lambda container lifetime
let _accountId = null;
async function getAccountId() {
  if (!_accountId) {
    const res = await sts.send(new GetCallerIdentityCommand({}));
    _accountId = res.Account;
  }
  return _accountId;
}

/**
 * Creates the base HTTP API + Lambda integration + stage.
 * Used by all HTTP API provisioners.
 * Returns: { apiId, integrationId, apiEndpoint }
 */
async function createHttpApiBase(apiName, environment, description, { onApiCreated } = {}) {
  console.log(`[base] createHttpApiBase — ${apiName}-${environment} | region=${REGION} | lambdaArn=${process.env.EXISTING_LAMBDA_ARN} | lambdaFn=${process.env.EXISTING_LAMBDA_FUNCTION_NAME}`);

  // 1. Create the HTTP API
  console.log(`[base] step 1 — CreateApi`);
  const api = await apigw.send(new CreateApiCommand({
    Name:         `${apiName}-${environment}-api`,
    ProtocolType: 'HTTP',
    Description:  description,
  }));
  console.log(`[base] step 1 done — apiId=${api.ApiId} endpoint=${api.ApiEndpoint}`);

  // ✅ Save api_id to DynamoDB immediately — so delete works even if later steps fail
  if (onApiCreated) await onApiCreated(api.ApiId);

  // 2. Create Lambda integration — points to EXISTING backend Lambda
  console.log(`[base] step 2 — CreateIntegration | uri=${process.env.EXISTING_LAMBDA_ARN}`);
  const integration = await apigw.send(new CreateIntegrationCommand({
    ApiId:                api.ApiId,
    IntegrationType:      'AWS_PROXY',
    IntegrationUri:       process.env.EXISTING_LAMBDA_ARN,
    PayloadFormatVersion: '2.0',
  }));
  console.log(`[base] step 2 done — integrationId=${integration.IntegrationId}`);

  // 3. Create $default stage with auto-deploy
  console.log(`[base] step 3 — CreateStage`);
  await apigw.send(new CreateStageCommand({
    ApiId:      api.ApiId,
    StageName:  '$default',
    AutoDeploy: true,
  }));
  console.log(`[base] step 3 done`);

  // 4. Create CloudWatch log group
  const logGroupName = `/aws/apigateway/${apiName}-${environment}-api`;
  console.log(`[base] step 4 — CreateLogGroup ${logGroupName}`);
  try {
    await logs.send(new CreateLogGroupCommand({ logGroupName }));
    await logs.send(new PutRetentionPolicyCommand({ logGroupName, retentionInDays: 14 }));
  } catch (e) {
    if (e.name !== 'ResourceAlreadyExistsException') throw e;
  }
  console.log(`[base] step 4 done`);

  // 5. Allow API Gateway to invoke the existing Lambda
  const accountId = await getAccountId();
  const sourceArn = `arn:aws:execute-api:${REGION}:${accountId}:${api.ApiId}/*/*`;
  console.log(`[base] step 5 — AddPermission | fn=${process.env.EXISTING_LAMBDA_FUNCTION_NAME} sourceArn=${sourceArn}`);
  try {
    await lambda.send(new AddPermissionCommand({
      FunctionName: process.env.EXISTING_LAMBDA_FUNCTION_NAME,
      StatementId:  `AllowAPIGW-${apiName}-${environment}`,
      Action:       'lambda:InvokeFunction',
      Principal:    'apigateway.amazonaws.com',
      SourceArn:    sourceArn,
      Qualifier:    'live',
    }));
  } catch (e) {
    if (e.name === 'ResourceConflictException') {
      console.log(`[base] Lambda permission already exists for ${apiName}-${environment} — skipping`);
    } else {
      throw e;
    }
  }
  console.log(`[base] step 5 done — createHttpApiBase complete`);

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
  try {
    await apigw.send(new DeleteApiCommand({ ApiId: apiId }));
  } catch (e) {
    // NotFoundException means already deleted — safe to continue
    if (e.name !== 'NotFoundException') {
      throw e;
    }
    console.warn(`[base] API ${apiId} not found — already deleted`);
  }

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
  getAccountId,
  createHttpApiBase,
  deleteHttpApiBase,
  CreateRouteCommand,
  CreateAuthorizerCommand,
  AddPermissionCommand,
  RemovePermissionCommand,
};

