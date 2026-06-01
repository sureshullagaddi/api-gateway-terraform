'use strict';

/**
 * Custom Lambda Authorizer for API Gateway HTTP API (payload format 2.0)
 * Returns { isAuthorized: true/false, context: {...} }
 */
exports.handler = async (event) => {

  // ── 1. Log full authorizer event ──────────────────────────────────────────
  console.log('[AUTHORIZER] ====== Authorizer Invoked ======');
  console.log('[AUTHORIZER] Route       :', event.routeKey);
  console.log('[AUTHORIZER] Raw path    :', event.rawPath);
  console.log('[AUTHORIZER] Source IP   :', event.requestContext?.http?.sourceIp);
  console.log('[AUTHORIZER] Full event  :', JSON.stringify(event, null, 2));

  try {
    // ── 2. Extract credentials ─────────────────────────────────────────────
    // API Gateway lowercases all header names in payload format 2.0
    const apiKey    = event.headers?.['x-api-key'];
    const authHeader = event.headers?.['authorization'];

    console.log('[AUTHORIZER] X-Api-Key header present :', !!apiKey);
    console.log('[AUTHORIZER] Authorization header present :', !!authHeader);

    const validApiKey = process.env.VALID_API_KEY || 'my-secret-key-123';

    // ── 3. Validate API key in X-Api-Key header ────────────────────────────
    if (apiKey) {
      console.log('[AUTHORIZER] Checking X-Api-Key...');
      if (apiKey === validApiKey) {
        console.log('[AUTHORIZER] ✅ API key VALID — access granted');
        return {
          isAuthorized: true,
          context: {
            keyId:      apiKey.substring(0, 8) + '...',
            authMethod: 'api-key',
          },
        };
      } else {
        console.log('[AUTHORIZER] ❌ API key INVALID — key does not match');
        return { isAuthorized: false };
      }
    }

    // ── 4. Validate custom Bearer token in Authorization header ───────────
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const validToken = process.env.VALID_TOKEN || 'my-custom-token';
      console.log('[AUTHORIZER] Checking custom Bearer token...');
      if (token === validToken) {
        console.log('[AUTHORIZER] ✅ Custom token VALID — access granted');
        return {
          isAuthorized: true,
          context: {
            authMethod:  'custom-token',
            tokenPrefix: token.substring(0, 8) + '...',
          },
        };
      } else {
        console.log('[AUTHORIZER] ❌ Custom token INVALID — token does not match');
        return { isAuthorized: false };
      }
    }

    // ── 5. No credentials found ────────────────────────────────────────────
    console.log('[AUTHORIZER] ❌ No valid credentials in request — denying');
    return { isAuthorized: false };

  } catch (err) {
    console.error('[AUTHORIZER] ====== ERROR ======');
    console.error('[AUTHORIZER] Message :', err.message);
    console.error('[AUTHORIZER] Stack   :', err.stack);
    // Always deny on error — never fail open
    return { isAuthorized: false };
  }
};
