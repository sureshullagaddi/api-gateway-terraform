'use strict';

/**
 * Secure Lambda handler — called via API Gateway HTTP API.
 * The JWT authorizer has already validated the Cognito token before
 * this function is invoked, so we can safely read the claims.
 */
exports.handler = async (event) => {
  console.log('Incoming event:', JSON.stringify(event, null, 2));

  try {
    // JWT claims are injected by the API Gateway JWT authorizer
    const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
    const requestId = event.requestContext?.requestId ?? 'unknown';

    const response = {
      message: 'Access granted to secure endpoint',
      user: {
        sub: claims.sub ?? 'unknown',
        email: claims.email ?? 'unknown',
      },
      environment: process.env.ENVIRONMENT,
      requestId,
      timestamp: new Date().toISOString(),
    };

    console.log('Response:', JSON.stringify(response));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify(response),
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

