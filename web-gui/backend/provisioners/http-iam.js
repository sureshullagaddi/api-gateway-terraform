'use strict';

/**
 * provisioners/http-iam.js
 * Creates an HTTP API v2 with AWS_IAM SigV4 auth.
 * Caller must sign requests with AWS SDK — no API key, no token.
 */

const { createHttpApiBase, deleteHttpApiBase, apigw, CreateRouteCommand } = require('./base');

async function create({ apiName, environment, routePath, httpMethod }) {
  const base = await createHttpApiBase(
    apiName, environment,
    `AWS_IAM SigV4 HTTP API — internal service-to-service, ${httpMethod} ${routePath}`
  );

  // Create route with AWS_IAM auth — API GW verifies SigV4 signature against IAM
  await apigw.send(new CreateRouteCommand({
    ApiId:             base.apiId,
    RouteKey:          `${httpMethod} ${routePath}`,
    AuthorizationType: 'AWS_IAM',
    Target:            `integrations/${base.integrationId}`,
  }));

  return {
    api_id:       base.apiId,
    api_endpoint: base.apiEndpoint,
    route_url:    `${base.apiEndpoint}${routePath}`,
    resources: { api_id: base.apiId, log_group: base.logGroupName },
    test_hint: `Sign requests with AWS SDK SignatureV4 (service: execute-api). Caller's IAM role must have execute-api:Invoke permission.`,
  };
}

async function destroy({ api_id, api_name, environment }) {
  await deleteHttpApiBase(api_id, api_name, environment);
}

module.exports = { create, destroy };

