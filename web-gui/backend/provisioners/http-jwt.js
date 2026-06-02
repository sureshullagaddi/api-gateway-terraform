'use strict';

/**
 * provisioners/http-jwt.js
 * Creates an HTTP API v2 with Cognito JWT authorizer.
 * Reuses the EXISTING Cognito User Pool — no new pool created.
 */

const { createHttpApiBase, deleteHttpApiBase, apigw, CreateRouteCommand, CreateAuthorizerCommand } = require('./base');

// AWS_ACCOUNT_REGION is the custom env var; AWS_REGION is set automatically by Lambda runtime
const REGION = process.env.AWS_ACCOUNT_REGION || process.env.AWS_REGION;

async function create({ apiName, environment, routePath, httpMethod, onApiCreated }) {
  console.log(`[http-jwt] create start — apiName=${apiName} env=${environment} region=${REGION}`);
  console.log(`[http-jwt] env vars — COGNITO_POOL_ID=${process.env.EXISTING_COGNITO_POOL_ID} CLIENT_ID=${process.env.EXISTING_COGNITO_CLIENT_ID}`);

  const base = await createHttpApiBase(
    apiName, environment,
    `JWT-protected HTTP API — Cognito auth, ${httpMethod} ${routePath}`,
    { onApiCreated }
  );
  console.log(`[http-jwt] base created — apiId=${base.apiId}`);

  const issuer   = `https://cognito-idp.${REGION}.amazonaws.com/${process.env.EXISTING_COGNITO_POOL_ID}`;
  const audience = [process.env.EXISTING_COGNITO_CLIENT_ID];
  console.log(`[http-jwt] creating JWT authorizer — issuer=${issuer} audience=${JSON.stringify(audience)}`);

  // Create JWT authorizer — reuses existing Cognito pool
  const authorizer = await apigw.send(new CreateAuthorizerCommand({
    ApiId:            base.apiId,
    Name:             `${apiName}-${environment}-jwt-authorizer`,
    AuthorizerType:   'JWT',
    IdentitySource:   '$request.header.Authorization',
    JwtConfiguration: { Issuer: issuer, Audience: audience },
  }));
  console.log(`[http-jwt] authorizer created — authorizerId=${authorizer.AuthorizerId}`);

  // Create route with JWT auth
  await apigw.send(new CreateRouteCommand({
    ApiId:             base.apiId,
    RouteKey:          `${httpMethod} ${routePath}`,
    AuthorizationType: 'JWT',
    AuthorizerId:      authorizer.AuthorizerId,
    Target:            `integrations/${base.integrationId}`,
  }));
  console.log(`[http-jwt] route created — ${httpMethod} ${routePath}`);

  return {
    api_id:        base.apiId,
    api_endpoint:  base.apiEndpoint,
    route_url:     `${base.apiEndpoint}${routePath}`,
    authorizer_id: authorizer.AuthorizerId,
    resources: {
      api_id:        base.apiId,
      authorizer_id: authorizer.AuthorizerId,
      log_group:     base.logGroupName,
    },
    cognito_pool_id:   process.env.EXISTING_COGNITO_POOL_ID,
    cognito_client_id: process.env.EXISTING_COGNITO_CLIENT_ID,
    test_hint: `Get an IdToken from Cognito and send as: Authorization: Bearer <IdToken>`,
  };
}

async function destroy({ api_id, api_name, environment }) {
  await deleteHttpApiBase(api_id, api_name, environment);
  // Cognito pool is shared — do NOT delete it
}

module.exports = { create, destroy };
