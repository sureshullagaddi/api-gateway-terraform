'use strict';

/**
 * Internal Caller Lambda — demonstrates AWS_IAM / SigV4 auth flow.
 *
 * Real-world scenario:
 *   This Lambda represents an INTERNAL AWS service (e.g. a batch processor,
 *   data pipeline, or another microservice) that calls the /internal route
 *   of the Banking API. It authenticates using its own IAM role — no API key,
 *   no Cognito token needed. AWS handles the identity verification.
 *
 * How SigV4 works:
 *   1. This Lambda has an IAM role with execute-api:Invoke permission
 *   2. AWS SDK signs the HTTP request using the Lambda's credentials
 *      (ACCESS_KEY_ID + SECRET_ACCESS_KEY + SESSION_TOKEN from the role)
 *   3. API Gateway verifies the signature against IAM
 *   4. If valid → request forwarded to main Lambda
 *   5. If invalid → 403 Forbidden
 *
 * Invoke this Lambda directly from AWS Console or CLI to test the /internal flow:
 *   aws lambda invoke --function-name api-demo-dev-internal-caller \
 *     --region eu-north-1 --payload '{}' /tmp/response.json && cat /tmp/response.json
 */

const { HttpRequest }  = require('@aws-sdk/protocol-http');
const { SignatureV4 }  = require('@aws-sdk/signature-v4');
const { Sha256 }       = require('@aws-crypto/sha256-js');
const https            = require('https');

// ── SigV4 signer (initialised once — reused across warm invocations) ──────────
const signer = new SignatureV4({
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken:    process.env.AWS_SESSION_TOKEN,
  },
  region:  process.env.AWS_REGION || 'eu-north-1',
  service: 'execute-api',
  sha256:  Sha256,
});

exports.handler = async (event) => {
  console.log('[INTERNAL-CALLER] ====== Starting internal API call ======');

  const apiHost = process.env.API_HOST;
  const apiPath = '/internal';

  if (!apiHost) {
    console.error('[INTERNAL-CALLER] API_HOST env var not set');
    return { statusCode: 500, error: 'API_HOST not configured' };
  }

  console.log('[INTERNAL-CALLER] Calling:', `https://${apiHost}${apiPath}`);
  console.log('[INTERNAL-CALLER] Signing with IAM role:', process.env.AWS_LAMBDA_FUNCTION_NAME);

  // ── Step 1: Build the HTTP request ────────────────────────────────────────
  const request = new HttpRequest({
    method:   'GET',
    hostname: apiHost,
    path:     apiPath,
    headers: {
      host:           apiHost,
      'content-type': 'application/json',
    },
  });

  // ── Step 2: Sign with SigV4 using this Lambda's IAM credentials ──────────
  console.log('[INTERNAL-CALLER] Signing request with SigV4...');
  const signedRequest = await signer.sign(request);

  console.log('[INTERNAL-CALLER] Signed headers:', Object.keys(signedRequest.headers).join(', '));
  // Headers added by SigV4: Authorization, X-Amz-Date, X-Amz-Security-Token

  // ── Step 3: Make the HTTPS call ───────────────────────────────────────────
  const result = await makeHttpsRequest(apiHost, apiPath, signedRequest.headers);

  console.log('[INTERNAL-CALLER] Response status:', result.statusCode);
  console.log('[INTERNAL-CALLER] Response body  :', result.body);

  return {
    callerFunction:  process.env.AWS_LAMBDA_FUNCTION_NAME,
    callerRegion:    process.env.AWS_REGION,
    targetEndpoint:  `https://${apiHost}${apiPath}`,
    authMethod:      'aws-iam-sigv4',
    responseStatus:  result.statusCode,
    responseBody:    JSON.parse(result.body),
    timestamp:       new Date().toISOString(),
  };
};

// ── Helper: make HTTPS request ─────────────────────────────────────────────────
function makeHttpsRequest(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method: 'GET', headers };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end',  () => resolve({ statusCode: res.statusCode, body }));
    });

    req.on('error', reject);
    req.end();
  });
}

