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

const REGION = process.env.AWS_ACCOUNT_REGION || process.env.AWS_REGION;
const apigwV1 = new APIGatewayClient({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });

async function create({ apiName, environment, routePath, httpMethod, partnerName, quotaPerDay, rateLimitPerSecond }) {
  // 1. Create REST API
  const api = await apigwV1.send(new CreateRestApiCommand({
    name:        `${apiName}-${environment}-rest-api`,
    description: `REST API — ${partnerName} partner, ${quotaPerDay} req/day`,
    endpointConfiguration: { types: ['REGIONAL'] },
  }));

  // 2. Get root resource ID
  const resources = await apigwV1.send(new GetResourcesCommand({ restApiId: api.id }));
  const rootId = resources.items.find(r => r.path === '/').id;

  // 3. Create path resource — strips leading slash, handles /payments/summary
  const pathParts = routePath.replace(/^\//, '').split('/');
  let parentId = rootId;
  let lastResourceId = rootId;

  for (const part of pathParts) {
    const resource = await apigwV1.send(new CreateResourceCommand({
      restApiId: api.id,
      parentId,
      pathPart: part,
    }));
    parentId = resource.id;
    lastResourceId = resource.id;
  }

  // 4. Create method — API key required
  await apigwV1.send(new PutMethodCommand({
    restApiId:         api.id,
    resourceId:        lastResourceId,
    httpMethod,
    authorizationType: 'NONE',
    apiKeyRequired:    true,
  }));

  // 5. Lambda proxy integration — reuses EXISTING Lambda
  const lambdaArn = process.env.EXISTING_LAMBDA_ARN
    .replace(':live', '') // remove alias for REST API integration URI format
    .replace('arn:aws:lambda', 'arn:aws:apigateway')
    .replace(/lambda:[^:]+:function:[^:]+/, `lambda:path/2015-03-31/functions/${process.env.EXISTING_LAMBDA_ARN}/invocations`);

  // Build the correct integration URI for REST API → Lambda proxy
  const integrationUri = `arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${process.env.EXISTING_LAMBDA_ARN}/invocations`;

  await apigwV1.send(new PutIntegrationCommand({
    restApiId:             api.id,
    resourceId:            lastResourceId,
    httpMethod,
    type:                  'AWS_PROXY',
    integrationHttpMethod: 'POST',
    uri:                   integrationUri,
  }));

  // 6. Deploy the API
  await apigwV1.send(new CreateDeploymentCommand({ restApiId: api.id }));

  // 7. Create stage
  const stage = await apigwV1.send(new CreateStageCommand({
    restApiId:    api.id,
    stageName:    environment,
    deploymentId: (await apigwV1.send(new CreateDeploymentCommand({ restApiId: api.id }))).id,
  }));

  // 8. Create usage plan
  const usagePlan = await apigwV1.send(new CreateUsagePlanCommand({
    name:        `${apiName}-${environment}-${partnerName}-plan`,
    description: `${partnerName} — ${quotaPerDay} req/day, ${rateLimitPerSecond} req/s`,
    apiStages:   [{ apiId: api.id, stage: environment }],
    quota:       { limit: Number(quotaPerDay), period: 'DAY' },
    throttle:    { rateLimit: Number(rateLimitPerSecond), burstLimit: Number(rateLimitPerSecond) * 2 },
  }));

  // 9. Create API key for the partner
  const apiKey = await apigwV1.send(new CreateApiKeyCommand({
    name:    `${apiName}-${environment}-${partnerName}-key`,
    enabled: true,
  }));

  // 10. Link key to usage plan
  await apigwV1.send(new CreateUsagePlanKeyCommand({
    usagePlanId: usagePlan.id,
    keyId:       apiKey.id,
    keyType:     'API_KEY',
  }));

  // 11. Allow REST API to invoke the existing Lambda
  await lambdaClient.send(new AddPermissionCommand({
    FunctionName: process.env.EXISTING_LAMBDA_FUNCTION_NAME,
    StatementId:  `AllowRESTAPIGW-${apiName}-${environment}`,
    Action:       'lambda:InvokeFunction',
    Principal:    'apigateway.amazonaws.com',
    SourceArn:    `arn:aws:execute-api:${REGION}:*:${api.id}/*/*`,
    Qualifier:    'live',
  }));

  const apiEndpoint = `https://${api.id}.execute-api.${REGION}.amazonaws.com/${environment}`;

  return {
    api_id:        api.id,
    api_endpoint:  apiEndpoint,
    route_url:     `${apiEndpoint}${routePath}`,
    api_key_id:    apiKey.id,
    usage_plan_id: usagePlan.id,
    resources: {
      rest_api_id:   api.id,
      api_key_id:    apiKey.id,
      usage_plan_id: usagePlan.id,
    },
    partner_name:  partnerName,
    quota_per_day: quotaPerDay,
    test_hint: `Get key from AWS Console → API Gateway → API Keys → ${apiName}-${environment}-${partnerName}-key → Show. Send as x-api-key header.`,
  };
}

async function destroy({ api_id, api_name, environment, resources }) {
  // resources is stored as JSON string in DynamoDB — parse if needed
  const res = typeof resources === 'string' ? JSON.parse(resources) : (resources ?? {});

  // Prefer resource IDs from DynamoDB record, fall back to top-level api_id
  const restApiId   = res.rest_api_id  ?? api_id;
  const apiKeyId    = res.api_key_id   ?? null;
  const usagePlanId = res.usage_plan_id ?? null;

  // 1. Remove Lambda permission
  try {
    await lambdaClient.send(new RemovePermissionCommand({
      FunctionName: process.env.EXISTING_LAMBDA_FUNCTION_NAME,
      StatementId:  `AllowRESTAPIGW-${api_name}-${environment}`,
      Qualifier:    'live',
    }));
  } catch (e) { console.warn('[rest-usage-plan] Lambda permission remove:', e.message); }

  // 2. Delete API key
  if (apiKeyId) {
    try { await apigwV1.send(new DeleteApiKeyCommand({ apiKey: apiKeyId })); }
    catch (e) { console.warn('[rest-usage-plan] API key delete:', e.message); }
  }

  // 3. Delete usage plan
  if (usagePlanId) {
    try { await apigwV1.send(new DeleteUsagePlanCommand({ usagePlanId })); }
    catch (e) { console.warn('[rest-usage-plan] Usage plan delete:', e.message); }
  }

  // 4. Delete REST API — cascades (removes all resources, methods, integrations, stages)
  if (restApiId) {
    try { await apigwV1.send(new DeleteRestApiCommand({ restApiId })); }
    catch (e) { console.warn('[rest-usage-plan] REST API delete:', e.message); }
  }
}

module.exports = { create, destroy };

