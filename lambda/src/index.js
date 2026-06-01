'use strict';

/**
 * Main Lambda handler — simulates a Banking API backend.
 *
 * Routes:
 *   GET /secure    → Customer banking portal (JWT auth via Cognito)
 *                    Returns account balance + recent transactions for the logged-in user
 *
 *   GET /admin     → Partner bank B2B integration (Custom Lambda auth via X-Api-Key)
 *                    Returns system-wide stats — only trusted partners can access
 *
 *   GET /health    → Public health check (no auth)
 *                    Returns service status — used by load balancers / monitoring
 *
 *   GET /internal  → Internal AWS service-to-service call (AWS_IAM / SigV4 auth)
 *                    Returns internal system metrics — only AWS IAM roles can access.
 *                    Caller must sign the request with SigV4 using their IAM credentials.
 *                    API Gateway validates the signature against IAM before forwarding.
 *                    No API key, no Cognito token — identity is the IAM role itself.
 */
exports.handler = async (event) => {
  console.log('[HANDLER] ====== Incoming Request ======');
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

