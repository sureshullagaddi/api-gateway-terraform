'use strict';

/**
 * provisioners/http-public.js
 * Creates an HTTP API v2 with NO auth — public endpoint.
 */

const { createHttpApiBase, deleteHttpApiBase, apigw, CreateRouteCommand } = require('./base');

async function create({ apiName, environment, routePath, httpMethod }) {
  const base = await createHttpApiBase(
    apiName, environment,
    `Public HTTP API — no auth, ${httpMethod} ${routePath}`
  );

  // Create route — authorization_type = NONE
  await apigw.send(new CreateRouteCommand({
    ApiId:             base.apiId,
    RouteKey:          `${httpMethod} ${routePath}`,
    AuthorizationType: 'NONE',
    Target:            `integrations/${base.integrationId}`,
  }));

  return {
    api_id:       base.apiId,
    api_endpoint: base.apiEndpoint,
    route_url:    `${base.apiEndpoint}${routePath}`,
    resources:    { api_id: base.apiId, log_group: base.logGroupName },
  };
}

async function destroy({ api_id, api_name, environment }) {
  await deleteHttpApiBase(api_id, api_name, environment);
}

module.exports = { create, destroy };

