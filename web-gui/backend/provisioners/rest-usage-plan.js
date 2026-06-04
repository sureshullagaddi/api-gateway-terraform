'use strict';

/**
 * provisioners/rest-usage-plan.js
 * Creates a REST API v1 with per-partner usage plan + API key.
 * The only auth type that requires REST API (HTTP API has no quota per key).
 */

const {
  APIGatewayClient,
  CreateRestApiCommand,
  GetResourcesCommand,
  CreateResourceCommand,
  PutMethodCommand,
  PutIntegrationCommand,
  CreateDeploymentCommand,
  CreateStageCommand,
  CreateUsagePlanCommand,
  CreateApiKeyCommand,
  CreateUsagePlanKeyCommand,
  DeleteRestApiCommand,
  DeleteApiKeyCommand,
  DeleteUsagePlanCommand,
} = require('@aws-sdk/client-api-gateway');

const { LambdaClient, AddPermissionCommand, RemovePermissionCommand } = require('@aws-sdk/client-lambda');
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');

const REGION    = process.env.AWS_ACCOUNT_REGION || process.env.AWS_REGION;
const apigwV1   = new APIGatewayClient({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });
const stsClient = new STSClient({ region: REGION });

let _accountId = null;
async function getAccountId() {
  if (!_accountId) {
    const res = await stsClient.send(new GetCallerIdentityCommand({}));
    _accountId = res.Account;
  }
  return _accountId;
}

// Extract qualifier/alias from a Lambda ARN (e.g. ':live' suffix) — same logic as base.js
function extractLambdaQualifier(lambdaArn) {
  if (!lambdaArn) return undefined;
  const parts = lambdaArn.split(':');
  return parts.length === 8 ? parts[7] : undefined;
}

async function create({ apiName, environment, routePath, httpMethod, partnerName, quotaPerDay, rateLimitPerSecond, onApiCreated }) {
  let _apiId = null;
  const tag = () => `[rest-usage-plan|${apiName}-${environment}|apiId=${_apiId ?? 'pending'}]`;

  console.log(`${tag()} create start | region=${REGION} partner=${partnerName} quota=${quotaPerDay}/day rate=${rateLimitPerSecond}/s`);

  // 1. Create REST API
  console.log(`${tag()} step 1 — CreateRestApi`);
  const api = await apigwV1.send(new CreateRestApiCommand({
    name:        `${apiName}-${environment}-rest-api`,
    description: `REST API — ${partnerName} partner, ${quotaPerDay} req/day`,
    endpointConfiguration: { types: ['REGIONAL'] },
  }));
  _apiId = api.id;
  console.log(`${tag()} step 1 done`);

  // ✅ Save api_id to DynamoDB immediately — so delete can clean up even if later steps fail
  if (onApiCreated) await onApiCreated(api.id);

  // 2. Get root resource ID
  console.log(`${tag()} step 2 — GetResources (root)`);
  const resources = await apigwV1.send(new GetResourcesCommand({ restApiId: api.id }));
  const rootId = resources.items.find(r => r.path === '/').id;
  console.log(`${tag()} step 2 done | rootId=${rootId}`);

  // 3. Create path resource — strips leading slash, handles /payments/summary
  const pathParts = routePath.replace(/^\//, '').split('/');
  let parentId = rootId;
  let lastResourceId = rootId;
  console.log(`${tag()} step 3 — CreateResource(s) | pathParts=${JSON.stringify(pathParts)}`);
  for (const part of pathParts) {
    const resource = await apigwV1.send(new CreateResourceCommand({
      restApiId: api.id,
      parentId,
      pathPart:  part,
    }));
    parentId = resource.id;
    lastResourceId = resource.id;
    console.log(`${tag()} step 3 — created resource '${part}' | resourceId=${resource.id}`);
  }

  // 4. Create method — API key required
  console.log(`${tag()} step 4 — PutMethod | ${httpMethod} apiKeyRequired=true`);
  await apigwV1.send(new PutMethodCommand({
    restApiId:         api.id,
    resourceId:        lastResourceId,
    httpMethod,
    authorizationType: 'NONE',
    apiKeyRequired:    true,
  }));
  console.log(`${tag()} step 4 done`);

  // 5. Lambda proxy integration — reuses EXISTING Lambda
  //    Qualifier is derived from EXISTING_LAMBDA_ARN if the ARN includes an alias/version suffix.
  const lambdaQualifier = extractLambdaQualifier(process.env.EXISTING_LAMBDA_ARN);
  const integrationUri = `arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${process.env.EXISTING_LAMBDA_ARN}/invocations`;
  console.log(`${tag()} step 5 — PutIntegration | uri=${integrationUri}`);
  await apigwV1.send(new PutIntegrationCommand({
    restApiId:             api.id,
    resourceId:            lastResourceId,
    httpMethod,
    type:                  'AWS_PROXY',
    integrationHttpMethod: 'POST',
    uri:                   integrationUri,
  }));
  console.log(`${tag()} step 5 done`);

  // 6. Deploy the API once, then create stage pointing to that deployment
  console.log(`${tag()} step 6 — CreateDeployment + CreateStage '${environment}'`);
  const deployment = await apigwV1.send(new CreateDeploymentCommand({ restApiId: api.id }));
  await apigwV1.send(new CreateStageCommand({
    restApiId:    api.id,
    stageName:    environment,
    deploymentId: deployment.id,
  }));
  console.log(`${tag()} step 6 done`);

  // 7. Create usage plan
  console.log(`${tag()} step 7 — CreateUsagePlan | ${quotaPerDay}/day ${rateLimitPerSecond}/s`);
  const usagePlan = await apigwV1.send(new CreateUsagePlanCommand({
    name:        `${apiName}-${environment}-${partnerName}-plan`,
    description: `${partnerName} — ${quotaPerDay} req/day, ${rateLimitPerSecond} req/s`,
    apiStages:   [{ apiId: api.id, stage: environment }],
    quota:       { limit: Number(quotaPerDay), period: 'DAY' },
    throttle:    { rateLimit: Number(rateLimitPerSecond), burstLimit: Number(rateLimitPerSecond) * 2 },
  }));
  console.log(`${tag()} step 7 done | usagePlanId=${usagePlan.id}`);

  // 8. Create API key for the partner
  console.log(`${tag()} step 8 — CreateApiKey`);
  const apiKey = await apigwV1.send(new CreateApiKeyCommand({
    name:    `${apiName}-${environment}-${partnerName}-key`,
    enabled: true,
  }));
  console.log(`${tag()} step 8 done | apiKeyId=${apiKey.id}`);

  // 9. Link key to usage plan
  console.log(`${tag()} step 9 — CreateUsagePlanKey`);
  await apigwV1.send(new CreateUsagePlanKeyCommand({
    usagePlanId: usagePlan.id,
    keyId:       apiKey.id,
    keyType:     'API_KEY',
  }));
  console.log(`${tag()} step 9 done`);

  // 10. Allow REST API to invoke the existing Lambda
  //     Qualifier is derived from EXISTING_LAMBDA_ARN — never hardcode 'live'.
  const accountId = await getAccountId();
  const sourceArn = `arn:aws:execute-api:${REGION}:${accountId}:${api.id}/*/*`;
  console.log(`${tag()} step 10 — AddPermission | fn=${process.env.EXISTING_LAMBDA_FUNCTION_NAME} qualifier=${lambdaQualifier ?? 'none'} sourceArn=${sourceArn}`);
  try {
    await lambdaClient.send(new AddPermissionCommand({
      FunctionName: process.env.EXISTING_LAMBDA_FUNCTION_NAME,
      StatementId:  `AllowRESTAPIGW-${apiName}-${environment}`,
      Action:       'lambda:InvokeFunction',
      Principal:    'apigateway.amazonaws.com',
      SourceArn:    sourceArn,
      ...(lambdaQualifier && { Qualifier: lambdaQualifier }),
    }));
    console.log(`${tag()} step 10 done`);
  } catch (e) {
    if (e.name === 'ResourceConflictException') {
      console.log(`${tag()} step 10 — Lambda permission already exists, skipping`);
    } else {
      throw e;
    }
  }

  const apiEndpoint = `https://${api.id}.execute-api.${REGION}.amazonaws.com/${environment}`;
  console.log(`${tag()} create complete | endpoint=${apiEndpoint}`);

  return {
    api_id:        api.id,
    api_endpoint:  apiEndpoint,
    route_url:     `${apiEndpoint}${routePath}`,
    api_key_id:    apiKey.id,
    usage_plan_id: usagePlan.id,
    partner_name:  partnerName,
    quota_per_day: quotaPerDay,
    resources: {
      rest_api_id:   api.id,
      api_key_id:    apiKey.id,
      usage_plan_id: usagePlan.id,
    },
    test_hint: `Get key from AWS Console → API Gateway → API Keys → ${apiName}-${environment}-${partnerName}-key → Show. Send as x-api-key header.`,
  };
}

async function destroy({ api_id, api_name, environment, resources }) {
  const tag = `[rest-usage-plan|${api_name}-${environment}|apiId=${api_id ?? 'unknown'}]`;
  // resources is stored as JSON string in DynamoDB — parse if needed
  const res = typeof resources === 'string' ? JSON.parse(resources) : (resources ?? {});

  // Prefer resource IDs from DynamoDB record, fall back to top-level api_id
  const restApiId   = res.rest_api_id  ?? api_id;
  const apiKeyId    = res.api_key_id   ?? null;
  const usagePlanId = res.usage_plan_id ?? null;

  // 1. Remove Lambda permission — derive qualifier from ARN, never hardcode 'live'
  const lambdaQualifier = extractLambdaQualifier(process.env.EXISTING_LAMBDA_ARN);
  console.log(`${tag} step 1 — RemovePermission | fn=${process.env.EXISTING_LAMBDA_FUNCTION_NAME} qualifier=${lambdaQualifier ?? 'none'}`);
  try {
    await lambdaClient.send(new RemovePermissionCommand({
      FunctionName: process.env.EXISTING_LAMBDA_FUNCTION_NAME,
      StatementId:  `AllowRESTAPIGW-${api_name}-${environment}`,
      ...(lambdaQualifier && { Qualifier: lambdaQualifier }),
    }));
    console.log(`${tag} step 1 done`);
  } catch (e) { console.warn(`${tag} step 1 — Lambda permission remove (non-fatal): ${e.name} — ${e.message}`); }

  // 2. Delete API key
  console.log(`${tag} step 2 — DeleteApiKey | apiKeyId=${apiKeyId}`);
  if (apiKeyId) {
    try { await apigwV1.send(new DeleteApiKeyCommand({ apiKey: apiKeyId })); console.log(`${tag} step 2 done`); }
    catch (e) { console.warn(`${tag} step 2 — API key delete (non-fatal): ${e.name} — ${e.message}`); }
  } else {
    console.warn(`${tag} step 2 — no apiKeyId in resources, skipping`);
  }

  // 3. Delete usage plan
  console.log(`${tag} step 3 — DeleteUsagePlan | usagePlanId=${usagePlanId}`);
  if (usagePlanId) {
    try { await apigwV1.send(new DeleteUsagePlanCommand({ usagePlanId })); console.log(`${tag} step 3 done`); }
    catch (e) { console.warn(`${tag} step 3 — usage plan delete (non-fatal): ${e.name} — ${e.message}`); }
  } else {
    console.warn(`${tag} step 3 — no usagePlanId in resources, skipping`);
  }

  // 4. Delete REST API — cascades (removes all resources, methods, integrations, stages)
  console.log(`${tag} step 4 — DeleteRestApi | restApiId=${restApiId}`);
  if (restApiId) {
    try { await apigwV1.send(new DeleteRestApiCommand({ restApiId })); console.log(`${tag} step 4 done`); }
    catch (e) { console.warn(`${tag} step 4 — REST API delete (non-fatal): ${e.name} — ${e.message}`); }
  } else {
    console.warn(`${tag} step 4 — no restApiId, skipping`);
  }

  console.log(`${tag} destroy complete`);
}

module.exports = { create, destroy };
