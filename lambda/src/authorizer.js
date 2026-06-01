'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });

// ── Cache the secret outside the handler ──────────────────────────────────────
// Lambda execution context is reused across invocations.
// Caching avoids a Secrets Manager API call on every request.
let cachedApiKey = null;
let cacheExpiry  = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // refresh every 5 minutes

async function getValidApiKey() {
  const now = Date.now();
  if (cachedApiKey && now < cacheExpiry) {
    console.log('[AUTHORIZER] Using cached API key (expires in', Math.round((cacheExpiry - now) / 1000), 's)');
    return cachedApiKey;
  }

  // Fallback to env var (dev/local) if no Secrets Manager ARN configured
  const secretArn = process.env.API_KEY_SECRET_ARN;
  if (!secretArn) {
    console.log('[AUTHORIZER] No SECRET_ARN set — using VALID_API_KEY env var (dev mode)');
    return process.env.VALID_API_KEY || 'my-secret-key-123';
  }

  console.log('[AUTHORIZER] Fetching API key from Secrets Manager:', secretArn);
  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  cachedApiKey = response.SecretString;
  cacheExpiry  = now + CACHE_TTL_MS;
  console.log('[AUTHORIZER] API key refreshed from Secrets Manager — cached for 5 min');
  return cachedApiKey;
}

/**
 * Custom Lambda Authorizer — validates X-Api-Key header.
 *
 * Real-world use: Partner bank (Nordea, SEB) calls IKANO's API
 * with a pre-shared API key stored in AWS Secrets Manager.
 *
 * Key lifecycle:
 *   1. IKANO security team generates key: openssl rand -hex 32
 *   2. Stored in: AWS Secrets Manager (api-demo-{env}/partner-api-key)
 *   3. Shared with partner via secure channel (encrypted email / vault)
 *   4. Partner stores in THEIR Secrets Manager
 *   5. Partner's backend reads key at runtime → sends as X-Api-Key header
 *   6. This authorizer fetches key from Secrets Manager, compares → allow/deny
 */
exports.handler = async (event) => {
  console.log('[AUTHORIZER] ====== Authorizer Invoked ======');
  console.log('[AUTHORIZER] Route    :', event.routeKey);
  console.log('[AUTHORIZER] Source IP:', event.requestContext?.http?.sourceIp);

  try {
    const incomingKey = event.headers?.['x-api-key'];

    console.log('[AUTHORIZER] X-Api-Key header present:', !!incomingKey);

    if (!incomingKey) {
      console.log('[AUTHORIZER] ❌ No X-Api-Key header — denying');
      return { isAuthorized: false };
    }

    // Fetch the valid key (from Secrets Manager or env var)
    const validKey = await getValidApiKey();

    if (incomingKey === validKey) {
      console.log('[AUTHORIZER] ✅ API key VALID — access granted');
      return { isAuthorized: true };
    }

    console.log('[AUTHORIZER] ❌ API key INVALID — does not match stored key');
    return { isAuthorized: false };

  } catch (err) {
    console.error('[AUTHORIZER] ====== ERROR ======');
    console.error('[AUTHORIZER] Message:', err.message);
    console.error('[AUTHORIZER] Stack  :', err.stack);
    return { isAuthorized: false }; // always deny on error — never fail open
  }
};
