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

// ── Build the correct Lambda integration URI for HTTP API v2 ─────────────────
// API GW v2 CreateIntegration requires the API GW invoke ARN format:
//   arn:aws:apigateway:{region}:lambda:path/2015-03-31/functions/{lambda-arn}/invocations
// Accepts either format in the env var and normalises automatically.
function buildIntegrationUri(lambdaArn) {
  if (!lambdaArn) return lambdaArn;
  // Already in invoke ARN format — pass through
  if (lambdaArn.startsWith('arn:aws:apigateway:')) return lambdaArn;
  // Plain Lambda ARN — convert to invoke ARN format
  return `arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${lambdaArn}/invocations`;
}

// ── Extract qualifier/alias from a Lambda ARN (if present) ───────────────────
// Standard ARN (7 parts): arn:aws:lambda:{region}:{account}:function:{name}
// With qualifier (8 parts): arn:aws:lambda:{region}:{account}:function:{name}:{alias|version}
// Returns the qualifier string, or undefined if the ARN is unqualified.
function extractLambdaQualifier(lambdaArn) {
  if (!lambdaArn) return undefined;
  const parts = lambdaArn.split(':');
  // parts: ['arn','aws','lambda',region,account,'function',name,?qualifier]
  return parts.length === 8 ? parts[7] : undefined;
}

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
  // Consistent log prefix — apiId is filled in after step 1
  const tag = () => `[base|${apiName}-${environment}|apiId=${_apiId ?? 'pending'}]`;

  let _apiId = null;
  console.log(`${tag()} createHttpApiBase start | region=${REGION} | lambdaArn=${process.env.EXISTING_LAMBDA_ARN} | lambdaFn=${process.env.EXISTING_LAMBDA_FUNCTION_NAME}`);

  // 1. Create the HTTP API
  console.log(`${tag()} step 1 — CreateApi`);
  const api = await apigw.send(new CreateApiCommand({
    Name:         `${apiName}-${environment}-api`,
    ProtocolType: 'HTTP',
    Description:  description,
  }));
  _apiId = api.ApiId;
  console.log(`${tag()} step 1 done — endpoint=${api.ApiEndpoint}`);

  // ✅ Save api_id to DynamoDB immediately — so delete works even if later steps fail
  if (onApiCreated) await onApiCreated(api.ApiId);

  // 2. Create Lambda integration — points to EXISTING backend Lambda
  const integrationUri = buildIntegrationUri(process.env.EXISTING_LAMBDA_ARN);
  console.log(`${tag()} step 2 — CreateIntegration | integrationUri=${integrationUri}`);
  const integration = await apigw.send(new CreateIntegrationCommand({
    ApiId:                api.ApiId,
    IntegrationType:      'AWS_PROXY',
    IntegrationUri:       integrationUri,
    PayloadFormatVersion: '2.0',
  }));
  console.log(`${tag()} step 2 done — integrationId=${integration.IntegrationId}`);

  // 3. Create $default stage with auto-deploy
  console.log(`${tag()} step 3 — CreateStage`);
  await apigw.send(new CreateStageCommand({
    ApiId:      api.ApiId,
    StageName:  '$default',
    AutoDeploy: true,
  }));
  console.log(`${tag()} step 3 done`);

  // 4. Create CloudWatch log group
  const logGroupName = `/aws/apigateway/${apiName}-${environment}-api`;
  console.log(`${tag()} step 4 — CreateLogGroup ${logGroupName}`);
  try {
    await logs.send(new CreateLogGroupCommand({ logGroupName }));
  } catch (e) {
    if (e.name !== 'ResourceAlreadyExistsException') throw e;
    console.log(`${tag()} step 4 — log group already exists, skipping`);
  }
  // PutRetentionPolicy is cosmetic — warn but never fail provisioning
  try {
    await logs.send(new PutRetentionPolicyCommand({ logGroupName, retentionInDays: 14 }));
  } catch (e) {
    console.warn(`${tag()} step 4 — could not set log retention (non-fatal): ${e.name} — ${e.message}`);
  }
  console.log(`${tag()} step 4 done`);

  // 5. Allow API Gateway to invoke the existing Lambda
  //    Qualifier is derived from EXISTING_LAMBDA_ARN (e.g. the ':live' alias suffix).
  //    If the ARN is unqualified (plain function ARN), Qualifier is omitted so the
  //    permission applies to all versions/aliases — never hardcode 'live' here.
  const accountId = await getAccountId();
  const sourceArn = `arn:aws:execute-api:${REGION}:${accountId}:${api.ApiId}/*/*`;
  const lambdaQualifier = extractLambdaQualifier(process.env.EXISTING_LAMBDA_ARN);
  console.log(`${tag()} step 5 — AddPermission | fn=${process.env.EXISTING_LAMBDA_FUNCTION_NAME} qualifier=${lambdaQualifier ?? 'none'} sourceArn=${sourceArn}`);
  try {
    await lambda.send(new AddPermissionCommand({
      FunctionName: process.env.EXISTING_LAMBDA_FUNCTION_NAME,
      StatementId:  `AllowAPIGW-${apiName}-${environment}`,
      Action:       'lambda:InvokeFunction',
      Principal:    'apigateway.amazonaws.com',
      SourceArn:    sourceArn,
      ...(lambdaQualifier && { Qualifier: lambdaQualifier }),
    }));
  } catch (e) {
    if (e.name === 'ResourceConflictException') {
      console.log(`${tag()} step 5 — Lambda permission already exists, skipping`);
    } else {
      throw e;
    }
  }
  console.log(`${tag()} step 5 done — createHttpApiBase complete`);

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
  const tag = `[base|${apiName}-${environment}|apiId=${apiId ?? 'unknown'}]`;

  // Remove Lambda permission — derive qualifier from ARN, same logic as create
  const lambdaQualifier = extractLambdaQualifier(process.env.EXISTING_LAMBDA_ARN);
  console.log(`${tag} step 1 — RemovePermission | fn=${process.env.EXISTING_LAMBDA_FUNCTION_NAME} qualifier=${lambdaQualifier ?? 'none'}`);
  try {
    await lambda.send(new RemovePermissionCommand({
      FunctionName: process.env.EXISTING_LAMBDA_FUNCTION_NAME,
      StatementId:  `AllowAPIGW-${apiName}-${environment}`,
      ...(lambdaQualifier && { Qualifier: lambdaQualifier }),
    }));
    console.log(`${tag} step 1 done`);
  } catch (e) {
    console.warn(`${tag} step 1 — could not remove Lambda permission (non-fatal): ${e.name} — ${e.message}`);
  }

  // Delete the API (cascades — deletes routes, integrations, authorizers)
  console.log(`${tag} step 2 — DeleteApi`);
  try {
    await apigw.send(new DeleteApiCommand({ ApiId: apiId }));
    console.log(`${tag} step 2 done`);
  } catch (e) {
    // NotFoundException means already deleted — safe to continue
    if (e.name !== 'NotFoundException') {
      throw e;
    }
    console.warn(`${tag} step 2 — API not found, already deleted`);
  }

  // Delete log group
  const logGroupName = `/aws/apigateway/${apiName}-${environment}-api`;
  console.log(`${tag} step 3 — DeleteLogGroup ${logGroupName}`);
  try {
    await logs.send(new DeleteLogGroupCommand({ logGroupName }));
    console.log(`${tag} step 3 done`);
  } catch (e) {
    console.warn(`${tag} step 3 — could not delete log group (non-fatal): ${e.name} — ${e.message}`);
  }

  console.log(`${tag} deleteHttpApiBase complete`);
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

