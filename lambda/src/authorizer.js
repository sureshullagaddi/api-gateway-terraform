'use strict';

/**
 * Custom Lambda Authorizer for API Gateway HTTP API (payload format 2.0)
 *
 * This authorizer is called BEFORE your main Lambda handler.
 * It receives the request and must return { isAuthorized: true/false }
 *
 * Use cases:
 *   - Validate a custom API key in a header
 *   - Check a token against your own database
 *   - Integrate with an external IdP (Okta, Auth0, etc.)
 *   - Any custom auth logic Cognito JWT can't cover
 *
 * Payload format 2.0 (HTTP API) — simplified response:
 *   { isAuthorized: true }   → allow, invoke main Lambda
 *   { isAuthorized: false }  → deny, return 403 Forbidden
 */
exports.handler = async (event) => {
  console.log('Authorizer event:', JSON.stringify(event, null, 2));

  try {
    // ── Example 1: API Key in header ────────────────────────────────────────
    // Client sends:  X-Api-Key: my-secret-key-123
    const apiKey = event.headers?.['x-api-key'];
    const validApiKey = process.env.VALID_API_KEY || 'my-secret-key-123';

    if (apiKey === validApiKey) {
      console.log('✅ API key valid — access granted');
      return {
        isAuthorized: true,
        context: {
          // These are passed to the main Lambda via:
          // event.requestContext.authorizer.lambda.keyId
          keyId: apiKey.substring(0, 8) + '...',
          authMethod: 'api-key',
        },
      };
    }

    // ── Example 2: Custom Bearer token ──────────────────────────────────────
    // Client sends:  Authorization: Bearer my-custom-token
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const validToken = process.env.VALID_TOKEN || 'my-custom-token';

      if (token === validToken) {
        console.log('✅ Custom token valid — access granted');
        return {
          isAuthorized: true,
          context: {
            authMethod: 'custom-token',
            tokenPrefix: token.substring(0, 8) + '...',
          },
        };
      }
    }

    // ── Deny by default ─────────────────────────────────────────────────────
    console.log('❌ No valid credentials found — access denied');
    return { isAuthorized: false };

  } catch (err) {
    console.error('Authorizer error:', err);
    return { isAuthorized: false };
  }
};

