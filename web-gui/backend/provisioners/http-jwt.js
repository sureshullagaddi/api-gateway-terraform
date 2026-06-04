'use strict';

/**
 * provisioners/http-jwt.js
 * Creates an HTTP API v2 with Cognito JWT authorizer.
 * Reuses the EXISTING Cognito User Pool — no new pool created.
 */

const https = require('https');
const { createHttpApiBase, deleteHttpApiBase, apigw, CreateRouteCommand, CreateAuthorizerCommand, enableAutoDeployAndDeploy } = require('./base');

// AWS_ACCOUNT_REGION is the custom env var; AWS_REGION is set automatically by Lambda runtime
const REGION = process.env.AWS_ACCOUNT_REGION || process.env.AWS_REGION;

// ── Pre-flight: verify the Cognito pool OIDC endpoint is reachable ────────────
// API GW v2 validates the issuer OIDC discovery URL when creating a JWT authorizer.
// If the pool doesn't exist (deleted / wrong ID / wrong region) it returns HTTP 400
// with no __type in the body → SDK throws "Unknown: UnknownError" with bodyRaw=null.
//
// This check runs BEFORE createHttpApiBase so we fail fast without creating any
// orphaned API Gateway resources.
function validateCognitoIssuer(issuer, poolId, logTag) {
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  console.log(`${logTag} pre-flight: validating Cognito pool '${poolId}' → ${discoveryUrl}`);

  return new Promise((resolve, reject) => {
    const req = https.get(discoveryUrl, { timeout: 6000 }, (res) => {
      res.resume(); // discard body — we only care about the status code
      if (res.statusCode === 200) {
        console.log(`${logTag} pre-flight: Cognito pool valid (HTTP 200)`);
        resolve();
      } else {
        const e = new Error(
          `Cognito pool not found or not accessible. ` +
          `OIDC discovery endpoint returned HTTP ${res.statusCode}. ` +
          `Pool ID '${poolId}' in region '${REGION}' does not exist or is wrong. ` +
          `Fix: re-deploy the main Terraform stack to recreate the Cognito pool, ` +
          `then re-deploy the web-gui infrastructure so EXISTING_COGNITO_POOL_ID is updated. ` +
          `Discovery URL: ${discoveryUrl}`
        );
        e.name = 'CognitoPoolNotFound';
        reject(e);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      const e = new Error(
        `Cognito OIDC discovery endpoint timed out (6s). ` +
        `Pool ID '${poolId}' | URL: ${discoveryUrl}`
      );
      e.name = 'CognitoPoolTimeout';
      reject(e);
    });

    req.on('error', (networkErr) => {
      const e = new Error(
        `Cognito OIDC discovery endpoint unreachable: ${networkErr.message}. ` +
        `Pool ID '${poolId}' | URL: ${discoveryUrl}`
      );
      e.name = 'CognitoPoolUnreachable';
      reject(e);
    });
  });
}

async function create({ apiName, environment, routePath, httpMethod, onApiCreated }) {
  let _apiId = null;
  const tag = () => `[http-jwt|${apiName}-${environment}|apiId=${_apiId ?? 'pending'}]`;

  console.log(`${tag()} create start | region=${REGION}`);

  const poolId   = process.env.EXISTING_COGNITO_POOL_ID;
  const clientId = process.env.EXISTING_COGNITO_CLIENT_ID;
  const issuer   = `https://cognito-idp.${REGION}.amazonaws.com/${poolId}`;
  const audience = [clientId];

  console.log(`${tag()} env vars | COGNITO_POOL_ID=${poolId} CLIENT_ID=${clientId}`);
  console.log(`${tag()} jwt config | issuer=${issuer} audience=${JSON.stringify(audience)}`);

  // ── STEP 0a: Validate required env vars ──────────────────────────────────────
  if (!poolId || poolId === 'undefined') {
    throw Object.assign(
      new Error(
        `EXISTING_COGNITO_POOL_ID is not set or invalid (got: '${poolId}'). ` +
        `Re-deploy the web-gui infrastructure so the variable is populated.`
      ),
      { name: 'MissingCognitoPoolId' }
    );
  }
  if (!clientId || clientId === 'undefined') {
    throw Object.assign(
      new Error(
        `EXISTING_COGNITO_CLIENT_ID is not set or invalid (got: '${clientId}'). ` +
        `API Gateway JWT authorizer requires a valid audience (client ID). ` +
        `Re-deploy the web-gui infrastructure so the variable is populated.`
      ),
      { name: 'MissingCognitoClientId' }
    );
  }

  // ── STEP 0b: Validate Cognito pool BEFORE creating any AWS resources ──────────
  // Fail fast here — avoids orphaned API Gateways on every retry.
  await validateCognitoIssuer(issuer, poolId, tag());

  // ── STEPS 1-5: Create API, integration, stage, log group, Lambda permission ──
  const base = await createHttpApiBase(
    apiName, environment,
    `JWT-protected HTTP API — Cognito auth, ${httpMethod} ${routePath}`,
    { onApiCreated }
  );
  _apiId = base.apiId;
  console.log(`${tag()} base created | endpoint=${base.apiEndpoint}`);

  // ── STEP 6: Create JWT authorizer ────────────────────────────────────────────
  const safeAudience = audience.filter(Boolean);
  console.log(`${tag()} step 6 — CreateAuthorizer | issuer=${issuer} audience=${JSON.stringify(safeAudience)}`);
  if (safeAudience.length === 0) {
    throw Object.assign(
      new Error(
        `JWT authorizer audience is empty after filtering. ` +
        `EXISTING_COGNITO_CLIENT_ID resolved to: '${clientId}'. ` +
        `API Gateway requires at least one valid audience value.`
      ),
      { name: 'EmptyJwtAudience' }
    );
  }
  const authorizer = await apigw.send(new CreateAuthorizerCommand({
    ApiId:            base.apiId,
    Name:             `${apiName}-${environment}-jwt-authorizer`,
    AuthorizerType:   'JWT',
    IdentitySource:   '$request.header.Authorization',
    JwtConfiguration: { Issuer: issuer, Audience: safeAudience },
  }));
  console.log(`${tag()} step 6 done | authorizerId=${authorizer.AuthorizerId}`);

  // ── STEP 7: Create route with JWT auth ───────────────────────────────────────
  console.log(`${tag()} step 7 — CreateRoute | ${httpMethod} ${routePath}`);
  await apigw.send(new CreateRouteCommand({
    ApiId:             base.apiId,
    RouteKey:          `${httpMethod} ${routePath}`,
    AuthorizationType: 'JWT',
    AuthorizerId:      authorizer.AuthorizerId,
    Target:            `integrations/${base.integrationId}`,
  }));
  console.log(`${tag()} step 7 done — create complete`);

  // ── STEP 8: Enable AutoDeploy and trigger deployment now that routes exist ────
  await enableAutoDeployAndDeploy(base.apiId, tag());

  return {
    api_id:        base.apiId,
    api_endpoint:  base.apiEndpoint,
    route_url:     `${base.apiEndpoint}${routePath}`,
    authorizer_id: authorizer.AuthorizerId,
    resources: {
      api_id:            base.apiId,
      authorizer_id:     authorizer.AuthorizerId,
      log_group:         base.logGroupName,
      cognito_pool_id:   poolId,
      cognito_client_id: clientId,
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
