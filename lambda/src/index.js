'use strict';

/**
 * Main Lambda handler — simulates a Banking API backend.
 *
 * Handles TWO event formats (HTTP API v2 + REST API v1):
 *
 * HTTP API v2 routes (aws_apigatewayv2_api):
 *   GET /health         → Public health check (no auth)
 *   GET /secure         → Customer portal — JWT auth via Cognito
 *   GET /admin          → Partner B2B — custom Lambda authorizer (X-Api-Key)
 *   GET /internal       → Internal service — AWS_IAM SigV4
 *
 * REST API v1 routes (aws_api_gateway_rest_api) — per-partner rate limiting:
 *   GET /partner/accounts → Partner account summary — REST API usage plans
 *                           Nordea: 10K req/day  |  SEB: 5K req/day
 *                           AWS enforces quotas before Lambda is even called.
 */
exports.handler = async (event) => {
  console.log('[HANDLER] ====== Incoming Request ======');

  // ── Detect API type: HTTP API v2 vs REST API v1 ────────────────────────────
  // HTTP API v2: event.requestContext.http.path exists
  // REST API v1: event.path exists (no event.requestContext.http)
  const isRestApiV1 = !!event.path && !event.requestContext?.http;

  if (isRestApiV1) {
    console.log('[HANDLER] API type: REST API v1');
    console.log('[HANDLER] Path    :', event.httpMethod, event.path);
    return handleRestApiV1(event);
  }

  console.log('[HANDLER] API type: HTTP API v2');
  console.log('[HANDLER] Route      :', event.requestContext?.http?.method, event.requestContext?.http?.path);
  console.log('[HANDLER] Request ID :', event.requestContext?.requestId);
  console.log('[HANDLER] Source IP  :', event.requestContext?.http?.sourceIp);

  try {
    const requestId  = event.requestContext?.requestId ?? 'unknown';
    const authorizer = event.requestContext?.authorizer;
    const path       = event.requestContext?.http?.path ?? '/';

    console.log('[HANDLER] Authorizer context:', JSON.stringify(authorizer, null, 2));

    // ── Route: GET /health ─────────────────────────────────────────────────
    if (path === '/health') {
      console.log('[HANDLER] Auth method: NONE (public health check)');
      return respond(200, {
        service:     'Banking API',
        status:      'healthy',
        environment: process.env.ENVIRONMENT,
        version:     process.env.AWS_LAMBDA_FUNCTION_VERSION ?? '$LATEST',
        timestamp:   new Date().toISOString(),
        requestId,
      });
    }

    // ── Route: GET /secure — Customer Banking Portal (JWT / Cognito) ───────
    if (path === '/secure' && authorizer?.jwt?.claims) {
      const claims = authorizer.jwt.claims;
      const userId  = claims.sub   ?? 'unknown';
      const email   = claims.email ?? 'unknown';

      console.log('[HANDLER] Auth method: JWT (Cognito)');
      console.log('[HANDLER] User sub   :', userId);
      console.log('[HANDLER] User email :', email);

      // Simulate fetching account data for this specific user
      // In production: query DynamoDB / RDS using userId as partition key
      const accountData = getMockAccountData(userId, email);

      return respond(200, {
        authMethod:  'jwt-cognito',
        message:     `Welcome back, ${email.split('@')[0]}!`,
        account:     accountData,
        environment: process.env.ENVIRONMENT,
        requestId,
        timestamp:   new Date().toISOString(),
      });
    }

    // ── Route: GET /admin — Partner Bank B2B (Custom Lambda Authorizer) ───
    if (path === '/admin' && authorizer?.lambda !== undefined) {
      console.log('[HANDLER] Auth method: Custom Lambda Authorizer (API key)');
      console.log('[HANDLER] Authorizer lambda context:', JSON.stringify(authorizer.lambda));

      // Simulate system-wide stats only accessible to trusted partner systems
      // In production: aggregate from DynamoDB / CloudWatch metrics
      const systemStats = getMockSystemStats();

      return respond(200, {
        authMethod:  'custom-lambda-apikey',
        message:     'Partner access granted — system stats returned',
        caller:      'partner-bank-system',
        stats:       systemStats,
        environment: process.env.ENVIRONMENT,
        requestId,
        timestamp:   new Date().toISOString(),
      });
    }

    // ── Route: GET /internal — Internal AWS service (AWS_IAM / SigV4) ────────
    // API Gateway has already verified the SigV4 signature against IAM before
    // reaching here. The caller's IAM identity is available in the authorizer
    // context. No API key, no Cognito token — IAM role IS the identity.
    if (path === '/internal') {
      // API GW v2 (HTTP API) puts IAM context under requestContext.authorizer.iam
      const iamContext = authorizer?.iam ?? {};
      const callerArn  = iamContext.userArn ?? iamContext.callerArn ?? 'unknown';

      console.log('[HANDLER] Auth method: AWS_IAM (SigV4)');
      console.log('[HANDLER] Caller ARN :', callerArn);
      console.log('[HANDLER] IAM context:', JSON.stringify(iamContext, null, 2));

      // Simulate internal metrics — only accessible to trusted AWS services
      // In production: read from internal DynamoDB tables, SQS queue depths, etc.
      const internalMetrics = getMockInternalMetrics();

      return respond(200, {
        authMethod:      'aws-iam-sigv4',
        message:         'Internal route — AWS IAM identity verified',
        callerArn,
        iamUserId:       iamContext.userId       ?? 'n/a',
        iamPrincipalId:  iamContext.principalId  ?? 'n/a',
        metrics:         internalMetrics,
        environment:     process.env.ENVIRONMENT,
        requestId,
        timestamp:       new Date().toISOString(),
      });
    }

    // ── Fallback — auth context missing (should not reach here) ───────────
    console.warn('[HANDLER] Unexpected: no auth context matched');
    return respond(200, {
      authMethod:  'none',
      message:     'Access granted (public route)',
      environment: process.env.ENVIRONMENT,
      requestId,
      timestamp:   new Date().toISOString(),
    });

  } catch (err) {
    console.error('[HANDLER] ====== ERROR ======');
    console.error('[HANDLER] Message:', err.message);
    console.error('[HANDLER] Stack  :', err.stack);
    return respond(500, { error: 'Internal server error' });
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function respond(statusCode, body) {
  console.log('[HANDLER] Response status:', statusCode);
  console.log('[HANDLER] Response body  :', JSON.stringify(body));
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  };
}

/**
 * Simulate customer account data.
 * In production: DynamoDB.GetItem({ TableName: 'accounts', Key: { userId } })
 */
function getMockAccountData(userId, email) {
  // Use last 4 chars of userId as deterministic seed for consistent mock data
  const seed = parseInt(userId.replace(/-/g, '').slice(-4), 16) % 100;

  return {
    accountNumber:  `IBAN-SE${3500000000 + seed}`,
    accountHolder:  email.split('@')[0],
    currency:       'SEK',
    balance:        (10000 + seed * 250).toFixed(2),
    availableLimit: (5000 + seed * 100).toFixed(2),
    recentTransactions: [
      {
        id:          `TXN-${seed}001`,
        date:        '2026-06-01',
        description: 'Salary — IKANO BANK AB',
        amount:      '+45000.00',
        type:        'credit',
      },
      {
        id:          `TXN-${seed}002`,
        date:        '2026-05-30',
        description: 'Rent payment — Stockholm Housing',
        amount:      '-12500.00',
        type:        'debit',
      },
      {
        id:          `TXN-${seed}003`,
        date:        '2026-05-28',
        description: 'Grocery — ICA Maxi',
        amount:      '-1250.75',
        type:        'debit',
      },
    ],
  };
}

/**
 * Simulate system-wide statistics for partner banks.
 * In production: CloudWatch GetMetricStatistics + DynamoDB aggregation
 */
function getMockSystemStats() {
  return {
    totalActiveAccounts:  42381,
    transactionsToday:    18924,
    apiCallsLast24h:      234876,
    averageResponseMs:    42,
    systemStatus:         'OPERATIONAL',
    lastBatchProcessedAt: '2026-06-01T13:00:00Z',
    partnerBanks:         ['NORDEA', 'SEB', 'SWEDBANK', 'HANDELSBANKEN'],
  };
}

/**
 * Simulate internal system metrics — only visible to trusted AWS IAM roles.
 * In production: read from internal DynamoDB tables, SQS queue depths, ECS task counts, etc.
 */
function getMockInternalMetrics() {
  return {
    batchJobs: {
      queueDepth:       7,
      processingRate:   '1200 tx/min',
      failedLast1h:     0,
      nextScheduledRun: '2026-06-01T14:00:00Z',
    },
    internalServices: {
      fraudDetection:  'HEALTHY',
      settlementEngine:'HEALTHY',
      auditLogger:     'HEALTHY',
      archiver:        'DEGRADED — 2 retries',
    },
    infrastructure: {
      ecsTaskCount:    12,
      rdsConnections:  34,
      cacheHitRate:    '94.7%',
      dlqMessages:     0,
    },
    dataClassification: 'INTERNAL — not for external exposure',
  };
}

// ── REST API v1 Handler ────────────────────────────────────────────────────────
// Called when the event comes from REST API (v1) — different event shape.
// REST API puts path in event.path (not event.requestContext.http.path).
// The x-api-key header is validated by REST API BEFORE Lambda is invoked.
// AWS tracks quota usage per key automatically.
async function handleRestApiV1(event) {
  const requestId = event.requestContext?.requestId ?? 'unknown';
  const path      = event.path ?? '/';
  const apiKeyId  = event.requestContext?.identity?.apiKeyId ?? 'unknown';

  console.log('[HANDLER-REST] Path     :', path);
  console.log('[HANDLER-REST] API Key ID:', apiKeyId); // the key ID (not the value)

  try {
    // ── GET /partner/accounts — per-partner rate limited account summary ──────
    if (path === '/partner/accounts') {
      console.log('[HANDLER-REST] Auth method: REST API usage plan (API key)');

      // In production: look up which partner this key belongs to,
      // then query their account data from DynamoDB using the partner ID.
      const partnerData = getMockPartnerAccountSummary(apiKeyId);

      // REST API v1 response format — must include statusCode + body as string
      return {
        statusCode: 200,
        headers:    { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authMethod:  'rest-api-usage-plan',
          message:     'Partner account summary — rate limited per usage plan',
          apiKeyId,                          // which key was used (not the secret value)
          usagePlan:   partnerData.planName,
          quotaLimit:  partnerData.quotaLimit,
          accounts:    partnerData.accounts,
          environment: process.env.ENVIRONMENT,
          requestId,
          timestamp:   new Date().toISOString(),
          note: 'Try exceeding your quota — AWS returns 429 automatically, Lambda never runs',
        }, null, 2),
      };
    }

    // Fallback for unknown REST API routes
    return {
      statusCode: 404,
      headers:    { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Route not found', path }),
    };

  } catch (err) {
    console.error('[HANDLER-REST] ERROR:', err.message);
    return {
      statusCode: 500,
      headers:    { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * Simulate partner account summary data.
 * In production: DynamoDB query using partner ID derived from the API key ID.
 * apiKeyId is used as a deterministic seed so mock data is consistent per key.
 */
function getMockPartnerAccountSummary(apiKeyId) {
  // Use last char of apiKeyId to vary data between Nordea/SEB
  const seed = apiKeyId.charCodeAt(apiKeyId.length - 1) % 2;
  const isNordea = seed === 0;

  return {
    planName:   isNordea ? 'premium (10,000 req/day)' : 'standard (5,000 req/day)',
    quotaLimit: isNordea ? 10000 : 5000,
    accounts: [
      {
        partnerId:     isNordea ? 'NORDEA-SE' : 'SEB-SE',
        accountNumber: isNordea ? 'IBAN-SE9850000000058398257466' : 'IBAN-SE4550000000058398257467',
        currency:      'SEK',
        totalBalance:  isNordea ? '12,450,000.00' : '8,320,000.00',
        activeAccounts: isNordea ? 3241 : 1872,
        pendingSettlements: isNordea ? 14 : 7,
        lastSettlement: '2026-06-01T06:00:00Z',
      },
    ],
  };
}

