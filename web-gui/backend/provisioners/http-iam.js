'use strict';

/**
 * provisioners/http-iam.js
 * Creates an HTTP API v2 with AWS_IAM SigV4 auth.
 * Caller must sign requests with AWS SDK — no API key, no token.
 */

const { createHttpApiBase, deleteHttpApiBase, apigw, CreateRouteCommand, enableAutoDeployAndDeploy } = require('./base');

async function create({ apiName, environment, routePath, httpMethod, onApiCreated }) {
  let _apiId = null;
  const tag = () => `[http-iam|${apiName}-${environment}|apiId=${_apiId ?? 'pending'}]`;

  console.log(`${tag()} create start`);

  const base = await createHttpApiBase(
    apiName, environment,
    `AWS_IAM SigV4 HTTP API — internal service-to-service, ${httpMethod} ${routePath}`,
    { onApiCreated }
  );
  _apiId = base.apiId;
  console.log(`${tag()} base created | endpoint=${base.apiEndpoint}`);

  // Create route with AWS_IAM auth — API GW verifies SigV4 signature against IAM
  console.log(`${tag()} step 6 — CreateRoute | ${httpMethod} ${routePath}`);
  await apigw.send(new CreateRouteCommand({
    ApiId:             base.apiId,
    RouteKey:          `${httpMethod} ${routePath}`,
    AuthorizationType: 'AWS_IAM',
    Target:            `integrations/${base.integrationId}`,
  }));
  console.log(`${tag()} step 6 done — create complete`);

  await enableAutoDeployAndDeploy(base.apiId, tag());

  return {
    api_id:       base.apiId,
    api_endpoint: base.apiEndpoint,
    route_url:    `${base.apiEndpoint}${routePath}`,
    resources: { api_id: base.apiId, log_group: base.logGroupName },
    test_hint: `Sign requests with AWS SDK SignatureV4 (service: execute-api). Caller's IAM role must have execute-api:Invoke permission.`,
  };
}

async function destroy({ api_id, api_name, environment }) {
  console.log(`[http-iam|${api_name}-${environment}|apiId=${api_id}] destroy start`);
  await deleteHttpApiBase(api_id, api_name, environment);
  console.log(`[http-iam|${api_name}-${environment}|apiId=${api_id}] destroy complete`);
}

module.exports = { create, destroy };
