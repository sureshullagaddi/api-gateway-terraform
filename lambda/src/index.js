'use strict';

/**
 * Main Lambda handler — called via API Gateway HTTP API.
 * Supports two auth paths:
 *   JWT auth    → event.requestContext.authorizer.jwt.claims  (Cognito)
 *   Custom auth → event.requestContext.authorizer.lambda      (API key etc.)
 *   No auth     → event.requestContext.authorizer is undefined (public routes)
 */
exports.handler = async (event) => {

  // ── 1. Log full incoming event (useful for debugging in CloudWatch) ────────
  console.log('[HANDLER] ====== Incoming Request ======');
  console.log('[HANDLER] Route       :', event.requestContext?.http?.method, event.requestContext?.http?.path);
  console.log('[HANDLER] Request ID  :', event.requestContext?.requestId);
  console.log('[HANDLER] Source IP   :', event.requestContext?.http?.sourceIp);
  console.log('[HANDLER] Full event  :', JSON.stringify(event, null, 2));

  try {
    const requestId = event.requestContext?.requestId ?? 'unknown';
    const authorizer = event.requestContext?.authorizer;

    // ── 2. Log raw authorizer context ─────────────────────────────────────
    console.log('[HANDLER] Authorizer context:', JSON.stringify(authorizer, null, 2));

    // ── 3. Detect which auth method was used ──────────────────────────────
    let authMethod = 'none';
    let userInfo = {};

    if (authorizer?.jwt?.claims) {
      // Route protected by Cognito JWT authorizer (GET /secure)
      authMethod = 'jwt';
      const claims = authorizer.jwt.claims;
      userInfo = {
        sub:   claims.sub   ?? 'unknown',
        email: claims.email ?? 'unknown',
      };
      console.log('[HANDLER] Auth method : JWT (Cognito)');
      console.log('[HANDLER] User sub    :', userInfo.sub);
      console.log('[HANDLER] User email  :', userInfo.email);

    } else if (authorizer?.lambda) {
      // Route protected by custom Lambda authorizer (GET /admin)
      authMethod = 'custom';
      userInfo = {
        authMethod: authorizer.lambda.authMethod ?? 'unknown',
        keyId:      authorizer.lambda.keyId      ?? 'unknown',
      };
      console.log('[HANDLER] Auth method : Custom Lambda Authorizer');
      console.log('[HANDLER] Key ID      :', userInfo.keyId);
      console.log('[HANDLER] Auth type   :', userInfo.authMethod);

    } else {
      // Public route — no authorizer (GET /health)
      console.log('[HANDLER] Auth method : NONE (public route)');
    }

    // ── 4. Build response ──────────────────────────────────────────────────
    const response = {
      message:     'Access granted',
      authMethod,
      user:        userInfo,
      environment: process.env.ENVIRONMENT,
      requestId,
      timestamp:   new Date().toISOString(),
    };

    console.log('[HANDLER] ====== Response ======');
    console.log('[HANDLER] Status      : 200');
    console.log('[HANDLER] Body        :', JSON.stringify(response));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify(response),
    };

  } catch (err) {
    console.error('[HANDLER] ====== ERROR ======');
    console.error('[HANDLER] Message :', err.message);
    console.error('[HANDLER] Stack   :', err.stack);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
