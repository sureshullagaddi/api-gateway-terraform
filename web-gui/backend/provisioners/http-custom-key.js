'use strict';

/**
 * provisioners/http-custom-key.js
 * Creates an HTTP API v2 with Lambda custom authorizer (X-Api-Key header).
 * Reuses the EXISTING authorizer Lambda — no new Lambda created.
 */

const { createHttpApiBase, deleteHttpApiBase,
  apigw, lambda, getAccountId,
  CreateRouteCommand, CreateAuthorizerCommand,
  AddPermissionCommand, RemovePermissionCommand,
} = require('./base');

// AWS_ACCOUNT_REGION is the custom env var; AWS_REGION is set automatically by Lambda runtime
const REGION = process.env.AWS_ACCOUNT_REGION || process.env.AWS_REGION;

// Build the invoke ARN format required by API GW v2 for authorizer URIs
// arn:aws:apigateway:{region}:lambda:path/2015-03-31/functions/{lambda-arn}/invocations
function buildAuthorizerUri(lambdaArn) {
  if (!lambdaArn) return lambdaArn;
  if (lambdaArn.startsWith('arn:aws:apigateway:')) return lambdaArn;
  return `arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${lambdaArn}/invocations`;
}

async function create({ apiName, environment, routePath, httpMethod, onApiCreated }) {
  console.log(`[http-custom-key] create start — apiName=${apiName} env=${environment} region=${REGION}`);
  console.log(`[http-custom-key] env vars — AUTHORIZER_ARN=${process.env.EXISTING_AUTHORIZER_LAMBDA_ARN} AUTHORIZER_FN=${process.env.EXISTING_AUTHORIZER_FUNCTION_NAME}`);

  const base = await createHttpApiBase(
    apiName, environment,
    `Custom Lambda authorizer HTTP API — X-Api-Key, ${httpMethod} ${routePath}`,
    { onApiCreated }
  );
  console.log(`[http-custom-key] base created — apiId=${base.apiId}`);

  // Allow API Gateway to invoke the EXISTING authorizer Lambda
  const accountId = await getAccountId();
  const authSourceArn = `arn:aws:execute-api:${REGION}:${accountId}:${base.apiId}/authorizers/*`;
  console.log(`[http-custom-key] adding Lambda permission — FunctionName=${process.env.EXISTING_AUTHORIZER_FUNCTION_NAME} SourceArn=${authSourceArn}`);

  await lambda.send(new AddPermissionCommand({
    FunctionName: process.env.EXISTING_AUTHORIZER_FUNCTION_NAME,
    StatementId:  `AllowAuthorizerAPIGW-${apiName}-${environment}`,
    Action:       'lambda:InvokeFunction',
    Principal:    'apigateway.amazonaws.com',
    SourceArn:    authSourceArn,
  }));
  console.log(`[http-custom-key] Lambda permission added`);

  // Create Lambda REQUEST authorizer — simple response format
  const authorizerUri = buildAuthorizerUri(process.env.EXISTING_AUTHORIZER_LAMBDA_ARN);
  console.log(`[http-custom-key] creating REQUEST authorizer — uri=${authorizerUri}`);
  const authorizer = await apigw.send(new CreateAuthorizerCommand({
    ApiId:                           base.apiId,
    Name:                            `${apiName}-${environment}-lambda-authorizer`,
    AuthorizerType:                  'REQUEST',
    AuthorizerUri:                   authorizerUri,
    AuthorizerPayloadFormatVersion:  '2.0',
    EnableSimpleResponses:           true,  // ← expects { isAuthorized: true/false }
    AuthorizerResultTtlInSeconds:    300,   // cache 5 min
    IdentitySource:                  '$request.header.X-Api-Key',
  }));
  console.log(`[http-custom-key] authorizer created — authorizerId=${authorizer.AuthorizerId}`);

  // Create route with CUSTOM auth
  await apigw.send(new CreateRouteCommand({
    ApiId:             base.apiId,
    RouteKey:          `${httpMethod} ${routePath}`,
    AuthorizationType: 'CUSTOM',
    AuthorizerId:      authorizer.AuthorizerId,
    Target:            `integrations/${base.integrationId}`,
  }));
  console.log(`[http-custom-key] route created — ${httpMethod} ${routePath}`);

  return {
    api_id:        base.apiId,
    api_endpoint:  base.apiEndpoint,
    route_url:     `${base.apiEndpoint}${routePath}`,
    authorizer_id: authorizer.AuthorizerId,
    resources: {
      api_id:                   base.apiId,
      authorizer_id:            authorizer.AuthorizerId,
      authorizer_permission_id: `AllowAuthorizerAPIGW-${apiName}-${environment}`,
      log_group:                base.logGroupName,
    },
    test_hint: `Send header: X-Api-Key: my-secret-key-123`,
  };
}

async function destroy({ api_id, api_name, environment, resources }) {
  const res = typeof resources === 'string' ? JSON.parse(resources) : (resources ?? {});

  // Remove authorizer Lambda permission
  try {
    await lambda.send(new RemovePermissionCommand({
      FunctionName: process.env.EXISTING_AUTHORIZER_FUNCTION_NAME,
      StatementId:  res.authorizer_permission_id ?? `AllowAuthorizerAPIGW-${api_name}-${environment}`,
    }));
  } catch (e) {
    console.warn(`[http-custom-key] Could not remove authorizer permission: ${e.message}`);
  }

  await deleteHttpApiBase(res.api_id ?? api_id, api_name, environment);
}

module.exports = { create, destroy };
