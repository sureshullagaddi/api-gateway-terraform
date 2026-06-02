'use strict';

/**
 * provisioners/http-custom-key.js
 * Creates an HTTP API v2 with Lambda custom authorizer (X-Api-Key header).
 * Reuses the EXISTING authorizer Lambda — no new Lambda created.
 */

const {
  createHttpApiBase, deleteHttpApiBase,
  apigw, lambda, getAccountId,
  CreateRouteCommand, CreateAuthorizerCommand,
  AddPermissionCommand, RemovePermissionCommand,
} = require('./base');

const REGION = process.env.AWS_ACCOUNT_REGION;

async function create({ apiName, environment, routePath, httpMethod }) {
  const base = await createHttpApiBase(
    apiName, environment,
    `Custom Lambda authorizer HTTP API — X-Api-Key, ${httpMethod} ${routePath}`
  );

  // Allow API Gateway to invoke the EXISTING authorizer Lambda
  const accountId = await getAccountId();
  await lambda.send(new AddPermissionCommand({
    FunctionName: process.env.EXISTING_AUTHORIZER_FUNCTION_NAME,
    StatementId:  `AllowAuthorizerAPIGW-${apiName}-${environment}`,
    Action:       'lambda:InvokeFunction',
    Principal:    'apigateway.amazonaws.com',
    SourceArn:    `arn:aws:execute-api:${REGION}:${accountId}:${base.apiId}/authorizers/*`,
  }));

  // Create Lambda REQUEST authorizer — simple response format
  const authorizer = await apigw.send(new CreateAuthorizerCommand({
    ApiId:                           base.apiId,
    Name:                            `${apiName}-${environment}-lambda-authorizer`,
    AuthorizerType:                  'REQUEST',
    AuthorizerUri:                   process.env.EXISTING_AUTHORIZER_LAMBDA_ARN,
    AuthorizerPayloadFormatVersion:  '2.0',
    EnableSimpleResponses:           true,  // ← critical: expects { isAuthorized: true/false }
    AuthorizerResultTtlInSeconds:    300,   // cache 5 min — reduces Lambda invocations
    IdentitySources:                 ['$request.header.X-Api-Key'],
  }));

  // Create route with CUSTOM auth
  await apigw.send(new CreateRouteCommand({
    ApiId:             base.apiId,
    RouteKey:          `${httpMethod} ${routePath}`,
    AuthorizationType: 'CUSTOM',
    AuthorizerId:      authorizer.AuthorizerId,
    Target:            `integrations/${base.integrationId}`,
  }));

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

