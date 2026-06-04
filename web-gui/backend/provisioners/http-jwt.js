'use strict';

/**
 * provisioners/http-jwt.js
 * Creates an HTTP API v2 with Cognito JWT authorizer.
 * Reuses the EXISTING Cognito User Pool — no new pool created.
 */

const https = require('https');
const { createHttpApiBase, deleteHttpApiBase, apigw, CreateRouteCommand, CreateAuthorizerCommand } = require('./base');

// AWS_ACCOUNT_REGION is the custom env var; AWS_REGION is set automatically by Lambda runtime
const REGION = process.env.AWS_ACCOUNT_REGION || process.env.AWS_REGION;

// ── Validate the Cognito pool is reachable BEFORE calling CreateAuthorizerCommand ──
// API GW v2 validates the OIDC discovery URL when creating a JWT authorizer.
// If the pool doesn't exist it returns HTTP 400 with no __type → "Unknown: UnknownError".
// This check gives a clear, actionable error instead.
function validateCognitoIssuer(issuer, logTag) {
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  console.log(`${logTag} validating Cognito issuer → ${discoveryUrl}`);

  return new Promise((resolve, reject) => {
    const req = https.get(discoveryUrl, { timeout: 6000 }, (res) => {
      res.resume(); // discard body — we only care about the status code
      if (res.statusCode === 200) {
        console.log(`${logTag} Cognito issuer valid (HTTP 200)`);
        resolve();
      } else {
        reject(new Error(
          `Cognito pool not found or not accessible — OIDC discovery returned HTTP ${res.statusCode}. ` +
          `Pool ID '${process.env.EXISTING_COGNITO_POOL_ID}' in region '${REGION}' does not exist or is wrong. ` +
          `Check EXISTING_COGNITO_POOL_ID env var in the Lambda function configuration. ` +
          `Discovery URL: ${discoveryUrl}`
        ));
      }
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(
        `Cognito issuer validation timed out — OIDC endpoint did not respond within 6s. ` +
        `URL: ${discoveryUrl}`
      ));
    });

    req.on('error', (e) => {
      reject(new Error(
        `Cognito issuer validation failed — could not reach OIDC endpoint: ${e.message}. ` +
        `URL: ${discoveryUrl}`
      ));
    });
  });
}

async function create({ apiName, environment, routePath, httpMethod, onApiCreated }) {
  // tag() is a function so apiId updates once base returns
  let _apiId = null;
  const tag = () => `[http-jwt|${apiName}-${environment}|apiId=${_apiId ?? 'pending'}]`;

  console.log(`${tag()} create start | region=${REGION}`);
  console.log(`${tag()} env vars | COGNITO_POOL_ID=${process.env.EXISTING_COGNITO_POOL_ID} CLIENT_ID=${process.env.EXISTING_COGNITO_CLIENT_ID}`);

  const base = await createHttpApiBase(
    apiName, environment,
    `JWT-protected HTTP API — Cognito auth, ${httpMethod} ${routePath}`,
    { onApiCreated }
  );
  _apiId = base.apiId;
  console.log(`${tag()} base created | endpoint=${base.apiEndpoint}`);

  const issuer   = `https://cognito-idp.${REGION}.amazonaws.com/${process.env.EXISTING_COGNITO_POOL_ID}`;
  const audience = [process.env.EXISTING_COGNITO_CLIENT_ID];

  // ── Pre-flight: verify the Cognito pool exists before calling API GW ─────────
  // API GW validates the OIDC discovery URL at authorizer-create time.
  // A deleted / wrong pool gives "Unknown 400" with no useful message.
  await validateCognitoIssuer(issuer, tag());

  console.log(`${tag()} step 6 — CreateAuthorizer | issuer=${issuer} audience=${JSON.stringify(audience)}`);

  // Create JWT authorizer — reuses existing Cognito pool
  const authorizer = await apigw.send(new CreateAuthorizerCommand({
    ApiId:            base.apiId,
    Name:             `${apiName}-${environment}-jwt-authorizer`,
    AuthorizerType:   'JWT',
    IdentitySource:   '$request.header.Authorization',
    JwtConfiguration: { Issuer: issuer, Audience: audience },
  }));
  console.log(`${tag()} step 6 done | authorizerId=${authorizer.AuthorizerId}`);

  // Create route with JWT auth
  console.log(`${tag()} step 7 — CreateRoute | ${httpMethod} ${routePath}`);
  await apigw.send(new CreateRouteCommand({
    ApiId:             base.apiId,
    RouteKey:          `${httpMethod} ${routePath}`,
    AuthorizationType: 'JWT',
    AuthorizerId:      authorizer.AuthorizerId,
    Target:            `integrations/${base.integrationId}`,
  }));
  console.log(`${tag()} step 7 done — create complete`);

  return {
    api_id:        base.apiId,
    api_endpoint:  base.apiEndpoint,
    route_url:     `${base.apiEndpoint}${routePath}`,
    authorizer_id: authorizer.AuthorizerId,
    // cognito details stored inside resources so handler persists them to DynamoDB
    resources: {
      api_id:            base.apiId,
      authorizer_id:     authorizer.AuthorizerId,
      log_group:         base.logGroupName,
      cognito_pool_id:   process.env.EXISTING_COGNITO_POOL_ID,
      cognito_client_id: process.env.EXISTING_COGNITO_CLIENT_ID,
    },
    test_hint: `Get an IdToken from Cognito and send as: Authorization: Bearer <IdToken>`,
  };
}

async function destroy({ api_id, api_name, environment }) {
  console.log(`[http-jwt|${api_name}-${environment}|apiId=${api_id}] destroy start`);
  await deleteHttpApiBase(api_id, api_name, environment);
  // Cognito pool is shared — do NOT delete it
  console.log(`[http-jwt|${api_name}-${environment}|apiId=${api_id}] destroy complete`);
}

module.exports = { create, destroy };
