'use strict';

/**
 * provisioners/http-public.js
 * Creates an HTTP API v2 with NO auth — public endpoint.
 */

const { createHttpApiBase, deleteHttpApiBase, apigw, CreateRouteCommand, enableAutoDeployAndDeploy } = require('./base');

async function create({ apiName, environment, routePath, httpMethod, onApiCreated }) {
  let _apiId = null;
  const tag = () => `[http-public|${apiName}-${environment}|apiId=${_apiId ?? 'pending'}]`;

  console.log(`${tag()} create start`);

  const base = await createHttpApiBase(
    apiName, environment,
    `Public HTTP API — no auth, ${httpMethod} ${routePath}`,
    { onApiCreated }
  );
  _apiId = base.apiId;
  console.log(`${tag()} base created | endpoint=${base.apiEndpoint}`);

  // Create route — authorization_type = NONE
  console.log(`${tag()} step 6 — CreateRoute | ${httpMethod} ${routePath}`);
  await apigw.send(new CreateRouteCommand({
    ApiId:             base.apiId,
    RouteKey:          `${httpMethod} ${routePath}`,
    AuthorizationType: 'NONE',
    Target:            `integrations/${base.integrationId}`,
  }));
  console.log(`${tag()} step 6 done — create complete`);

  await enableAutoDeployAndDeploy(base.apiId, tag());

  return {
    api_id:       base.apiId,
    api_endpoint: base.apiEndpoint,
    route_url:    `${base.apiEndpoint}${routePath}`,
    resources:    { api_id: base.apiId, log_group: base.logGroupName },
  };
}

async function destroy({ api_id, api_name, environment }) {
  console.log(`[http-public|${api_name}-${environment}|apiId=${api_id}] destroy start`);
  await deleteHttpApiBase(api_id, api_name, environment);
  console.log(`[http-public|${api_name}-${environment}|apiId=${api_id}] destroy complete`);
}

module.exports = { create, destroy };
