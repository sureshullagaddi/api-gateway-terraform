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
  enableAutoDeployAndDeploy,
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
  let _apiId = null;
  const tag = () => `[http-custom-key|${apiName}-${environment}|apiId=${_apiId ?? 'pending'}]`;

  console.log(`${tag()} create start | region=${REGION}`);
  console.log(`${tag()} env vars | AUTHORIZER_ARN=${process.env.EXISTING_AUTHORIZER_LAMBDA_ARN} AUTHORIZER_FN=${process.env.EXISTING_AUTHORIZER_FUNCTION_NAME}`);

  const base = await createHttpApiBase(
    apiName, environment,
    `Custom Lambda authorizer HTTP API — X-Api-Key, ${httpMethod} ${routePath}`,
    { onApiCreated }
  );
  _apiId = base.apiId;
  console.log(`${tag()} base created | endpoint=${base.apiEndpoint}`);

  // Allow API Gateway to invoke the EXISTING authorizer Lambda
  const accountId = await getAccountId();
  const authSourceArn = `arn:aws:execute-api:${REGION}:${accountId}:${base.apiId}/authorizers/*`;
  console.log(`${tag()} step 6 — AddPermission (authorizer Lambda) | fn=${process.env.EXISTING_AUTHORIZER_FUNCTION_NAME} sourceArn=${authSourceArn}`);
  try {
    await lambda.send(new AddPermissionCommand({
      FunctionName: process.env.EXISTING_AUTHORIZER_FUNCTION_NAME,
      StatementId:  `AllowAuthorizerAPIGW-${apiName}-${environment}`,
      Action:       'lambda:InvokeFunction',
      Principal:    'apigateway.amazonaws.com',
      SourceArn:    authSourceArn,
    }));
    console.log(`${tag()} step 6 done`);
  } catch (e) {
    if (e.name === 'ResourceConflictException') {
      console.log(`${tag()} step 6 — authorizer permission already exists, skipping`);
    } else {
      throw e;
    }
  }

  // Create Lambda REQUEST authorizer — simple response format
  const authorizerUri = buildAuthorizerUri(process.env.EXISTING_AUTHORIZER_LAMBDA_ARN);
  console.log(`${tag()} step 7 — CreateAuthorizer | uri=${authorizerUri}`);
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
  console.log(`${tag()} step 7 done | authorizerId=${authorizer.AuthorizerId}`);

  // Create route with CUSTOM auth
  console.log(`${tag()} step 8 — CreateRoute | ${httpMethod} ${routePath}`);
  await apigw.send(new CreateRouteCommand({
    ApiId:             base.apiId,
    RouteKey:          `${httpMethod} ${routePath}`,
    AuthorizationType: 'CUSTOM',
    AuthorizerId:      authorizer.AuthorizerId,
    Target:            `integrations/${base.integrationId}`,
  }));
  console.log(`${tag()} step 8 done — create complete`);

  await enableAutoDeployAndDeploy(base.apiId, tag());

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
  const tag = `[http-custom-key|${api_name}-${environment}|apiId=${api_id ?? 'unknown'}]`;
  const res = typeof resources === 'string' ? JSON.parse(resources) : (resources ?? {});

  // Remove authorizer Lambda permission
  console.log(`${tag} step 1 — RemovePermission (authorizer Lambda) | fn=${process.env.EXISTING_AUTHORIZER_FUNCTION_NAME}`);
  try {
    await lambda.send(new RemovePermissionCommand({
      FunctionName: process.env.EXISTING_AUTHORIZER_FUNCTION_NAME,
      StatementId:  res.authorizer_permission_id ?? `AllowAuthorizerAPIGW-${api_name}-${environment}`,
    }));
    console.log(`${tag} step 1 done`);
  } catch (e) {
    console.warn(`${tag} step 1 — could not remove authorizer permission (non-fatal): ${e.name} — ${e.message}`);
  }

  console.log(`${tag} step 2 — deleteHttpApiBase`);
  await deleteHttpApiBase(res.api_id ?? api_id, api_name, environment);
  console.log(`${tag} destroy complete`);
}

module.exports = { create, destroy };
