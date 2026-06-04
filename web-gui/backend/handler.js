'use strict';

/**
 * handler.js — Web GUI Lambda
 *
 * Routes:
 *   POST   /apis             → provision (create) a new API
 *   GET    /apis             → list all provisioned APIs
 *   GET    /apis/{api_name}  → get details of one API
 *   DELETE /apis/{api_name}  → destroy an API and all its resources
 *
 * Each auth type is handled by its own provisioner module.
 * DynamoDB tracks the created resource IDs for clean deletion.
 */

const db = require('./db');

// ── Provisioner registry — add new auth types here ───────────────────────────
const provisioners = {
  'http-public':      require('./provisioners/http-public'),
  'http-jwt':         require('./provisioners/http-jwt'),
  'http-custom-key':  require('./provisioners/http-custom-key'),
  'http-iam':         require('./provisioners/http-iam'),
  'rest-usage-plan':  require('./provisioners/rest-usage-plan'),
};

// ── Required env vars per api_type — checked before provisioning ──────────────
const REQUIRED_ENV_VARS = {
  'http-public':     ['EXISTING_LAMBDA_ARN', 'EXISTING_LAMBDA_FUNCTION_NAME'],
  'http-jwt':        ['EXISTING_LAMBDA_ARN', 'EXISTING_LAMBDA_FUNCTION_NAME', 'EXISTING_COGNITO_POOL_ID', 'EXISTING_COGNITO_CLIENT_ID'],
  'http-custom-key': ['EXISTING_LAMBDA_ARN', 'EXISTING_LAMBDA_FUNCTION_NAME', 'EXISTING_AUTHORIZER_LAMBDA_ARN', 'EXISTING_AUTHORIZER_FUNCTION_NAME'],
  'http-iam':        ['EXISTING_LAMBDA_ARN', 'EXISTING_LAMBDA_FUNCTION_NAME'],
  'rest-usage-plan': ['EXISTING_LAMBDA_ARN', 'EXISTING_LAMBDA_FUNCTION_NAME'],
};

function checkEnvVars(apiType) {
  const required = REQUIRED_ENV_VARS[apiType] ?? [];
  const missing  = required.filter(v => !process.env[v]);
  return missing;
}

// ── Input validation ──────────────────────────────────────────────────────────
const VALID_API_TYPES   = Object.keys(provisioners);
const VALID_HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const VALID_ENVIRONMENTS = ['dev', 'sit', 'stage', 'prod'];
const API_NAME_REGEX     = /^[a-z][a-z0-9-]{2,28}[a-z0-9]$/;

function validate(body) {
  const errors = [];
  if (!body.api_name)                              errors.push('api_name is required');
  if (body.api_name && !API_NAME_REGEX.test(body.api_name))
    errors.push('api_name must be lowercase letters, numbers, hyphens (4-30 chars)');
  if (!VALID_API_TYPES.includes(body.api_type))    errors.push(`api_type must be one of: ${VALID_API_TYPES.join(', ')}`);
  if (!VALID_HTTP_METHODS.includes(body.http_method)) errors.push(`http_method must be one of: ${VALID_HTTP_METHODS.join(', ')}`);
  if (!body.route_path?.startsWith('/'))            errors.push('route_path must start with /');
  if (!VALID_ENVIRONMENTS.includes(body.environment)) errors.push(`environment must be one of: ${VALID_ENVIRONMENTS.join(', ')}`);
  return errors;
}

// ── Response helpers ──────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  process.env.CORS_ALLOWED_ORIGIN ?? '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

function ok(body, status = 200) {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body, null, 2) };
}

function err(message, status = 400, details = null) {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: message, details }) };
}

// ── AWS error serialiser ──────────────────────────────────────────────────────
// AWS SDK v3 sets e.name="Unknown" e.message="Unknown" when it can't parse the
// service error body. The real cause lives in other fields — we try them all.
//
// IMPORTANT: async — must be awaited. The $response.body in AWS Lambda Node 18
// is a SdkStream that requires transformToString() to decode (not synchronous).
async function serializeAwsError(e) {
  // name / code — prefer the specific exception type over generic "Unknown"
  // Also handles plain JS errors thrown by pre-flight checks (e.g. CognitoPoolNotFound)
  const SKIP_NAMES = new Set(['Unknown', 'Error', 'UnknownError']);
  const code = (e.name && !SKIP_NAMES.has(e.name))
    ? e.name
    : (e.Code || e.code || e.__type || e.name || 'UnknownError');

  const GENERIC = new Set(['Unknown', 'UnknownError', 'undefined', '']);

  // ── Decode response body — try every encoding the SDK might use ──────────────
  let bodyRaw = null;   // raw text from body
  let bodyJson = null;  // parsed JSON (if body is JSON)
  try {
    const rawBody = e.$response?.body;
    if (rawBody) {
      if (typeof rawBody === 'string') {
        bodyRaw = rawBody;
      } else if (Buffer.isBuffer(rawBody)) {
        bodyRaw = rawBody.toString('utf8');
      } else if (ArrayBuffer.isView(rawBody)) {
        bodyRaw = Buffer.from(rawBody).toString('utf8');
      } else if (typeof rawBody.transformToString === 'function') {
        // SdkStream — used in AWS Lambda Node 18 runtime with SDK v3
        bodyRaw = await rawBody.transformToString('utf8');
      } else if (typeof rawBody.text === 'function') {
        // Web ReadableStream / Fetch Response body
        bodyRaw = await rawBody.text();
      }

      if (bodyRaw) {
        try {
          bodyJson = JSON.parse(bodyRaw);
        } catch {
          // body is not JSON (e.g. XML or plain text) — keep bodyRaw as-is
        }
      }
    }
  } catch (bodyErr) {
    console.warn('[serializeAwsError] could not read response body:', bodyErr?.message);
  }

  const bodyMessage = bodyJson
    ? (bodyJson.message || bodyJson.Message || bodyJson.errorMessage || bodyJson.__type || null)
    : (bodyRaw ? bodyRaw.substring(0, 500) : null);   // plain text / XML fallback

  const bodyCode = bodyJson
    ? (bodyJson.code || bodyJson.Code || bodyJson.__type || null)
    : null;

  // Final code — prefer body-parsed code over "Unknown"
  const finalCode = (code !== 'Unknown' && code !== 'UnknownError') ? code : (bodyCode || code);

  const message =
    (!GENERIC.has(e.message) ? e.message : null) ||
    bodyMessage ||
    e.Error?.Message ||
    e.Message ||
    e.errorMessage ||
    e.detail ||
    (!GENERIC.has(finalCode) ? `AWS error: ${finalCode}` : 'Provisioning failed — check CloudWatch logs for details');

  // ── Structured diagnostic dump so CloudWatch always has the full picture ─────
  const diag = {
    name:       e.name,
    message:    e.message,
    code:       finalCode,
    httpStatus: e.$metadata?.httpStatusCode,
    requestId:  e.$metadata?.requestId,
    fault:      e.$fault,
    bodyRaw:    bodyRaw ? bodyRaw.substring(0, 1000) : null,
    bodyJson,
  };
  console.error('[serializeAwsError] diagnostic:', JSON.stringify(diag));
  // Full error object (own properties only — avoids circular refs in body streams)
  try {
    const safeProps = Object.getOwnPropertyNames(e).filter(k => k !== '$response');
    console.error('[serializeAwsError] full error props:', JSON.stringify(Object.fromEntries(safeProps.map(k => [k, e[k]]))));
  } catch { /* non-serializable fields — ignore */ }

  return {
    code:       finalCode,
    message,
    httpStatus: e.$metadata?.httpStatusCode ?? null,
    requestId:  e.$metadata?.requestId      ?? null,
    fault:      e.$fault                    ?? null,
    stack:      e.stack                     ?? null,
    ...(bodyJson?.code      && { awsCode:    bodyJson.code }),
    ...(e.detail            && { detail:     e.detail }),
    ...(e.reason            && { reason:     e.reason }),
    ...(e.OAuthError        && { OAuthError: e.OAuthError }),
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const method   = event.requestContext?.http?.method;
  const path     = event.requestContext?.http?.path;
  const apiName  = event.pathParameters?.api_name;

  console.log(`[handler] ${method} ${path}`);

  try {
    // ── POST /apis — create a new API ────────────────────────────────────────
    if (method === 'POST' && path === '/apis') {
      const body = JSON.parse(event.body ?? '{}');
      const errors = validate(body);
      if (errors.length) return err('Validation failed', 400, errors);

      console.log(`[handler|${body.api_name}|${body.api_type}] POST /apis — validate OK`);

      // Check for duplicate api_name
      const existing = await db.getApi(body.api_name);
      if (existing) return err(`API '${body.api_name}' already exists. Use DELETE to remove it first.`, 409);

      // ── Early env-var check — fail fast with a clear message ─────────────────
      const missingVars = checkEnvVars(body.api_type);
      if (missingVars.length) {
        return err(
          `Missing required environment variables for ${body.api_type}: ${missingVars.join(', ')}. Check Lambda environment config.`,
          500
        );
      }

      // Save initial record with CREATING status
      await db.saveApi({
        api_name:    body.api_name,
        api_type:    body.api_type,
        environment: body.environment,
        route_path:  body.route_path,
        http_method: body.http_method,
        partner_name: body.partner_name ?? null,
        status:      'CREATING',
      });
      console.log(`[handler|${body.api_name}|${body.api_type}] DB record saved — status=CREATING`);

      // Call the provisioner for this api_type
      const provisioner = provisioners[body.api_type];
      let result;
      try {
        result = await provisioner.create({
          apiName:             body.api_name,
          environment:         body.environment,
          routePath:           body.route_path,
          httpMethod:          body.http_method,
          partnerName:         body.partner_name ?? 'partner',
          quotaPerDay:         body.quota_per_day ?? 5000,
          rateLimitPerSecond:  body.rate_limit_per_second ?? 50,
          // Saves api_id to DynamoDB as soon as API GW is created
          // so delete can clean up even if later steps fail
          onApiCreated: async (apiId) => {
            console.log(`[handler|${body.api_name}|${body.api_type}|apiId=${apiId}] onApiCreated — updating DB`);
            await db.updateStatus(body.api_name, 'CREATING', { api_id: apiId });
          },
        });
      } catch (provisionError) {
        // Serialise the full AWS SDK error — await required (reads streaming body)
        const errDetail = await serializeAwsError(provisionError);
        console.error(`[handler|${body.api_name}|${body.api_type}] provisioning FAILED — code=${errDetail.code} status=${errDetail.httpStatus}`);
        await db.updateStatus(body.api_name, 'FAILED', {
          error_message: errDetail.message,
          error_code:    errDetail.code    ?? null,
          error_status:  errDetail.httpStatus ? String(errDetail.httpStatus) : null,
          error_req_id:  errDetail.requestId  ?? null,
        });
        console.error('[handler] Provisioning failed:', provisionError);
        return err('Provisioning failed', 500, errDetail);
      }

      // Update DynamoDB with created resource IDs
      // cognito_pool_id / cognito_client_id are nested inside result.resources for http-jwt;
      // we also surface them as top-level fields for easy querying / display.
      const resources = result.resources ?? {};
      console.log(`[handler|${body.api_name}|${body.api_type}|apiId=${result.api_id}] provisioning succeeded — updating DB status=ACTIVE`);
      await db.updateStatus(body.api_name, 'ACTIVE', {
        api_id:            result.api_id,
        api_endpoint:      result.api_endpoint,
        route_url:         result.route_url,
        resources:         JSON.stringify(resources),
        test_hint:         result.test_hint         ?? null,
        api_key_id:        result.api_key_id         ?? null,
        usage_plan_id:     result.usage_plan_id      ?? null,
        // partner_name from provisioner result (REST usage plan sets this)
        partner_name:      result.partner_name       ?? body.partner_name ?? null,
        // Cognito fields — set for http-jwt, null for all others
        cognito_pool_id:   resources.cognito_pool_id   ?? null,
        cognito_client_id: resources.cognito_client_id ?? null,
      });

      console.log(`[handler|${body.api_name}|${body.api_type}|apiId=${result.api_id}] done — route_url=${result.route_url}`);
      return ok({
        message:      `API '${body.api_name}' created successfully`,
        api_name:     body.api_name,
        api_type:     body.api_type,
        route_url:    result.route_url,
        api_endpoint: result.api_endpoint,
        test_hint:    result.test_hint,
      }, 201);
    }

    // ── GET /apis — list all APIs ─────────────────────────────────────────────
    if (method === 'GET' && path === '/apis') {
      const items = await db.listApis();
      console.log(`[handler] GET /apis — returning ${items.length} items`);
      return ok({ count: items.length, apis: items });
    }

    // ── GET /apis/{api_name} — get one API ────────────────────────────────────
    if (method === 'GET' && apiName) {
      const item = await db.getApi(apiName);
      if (!item) return err(`API '${apiName}' not found`, 404);
      console.log(`[handler|${apiName}|apiId=${item.api_id ?? 'none'}] GET — status=${item.status}`);
      return ok(item);
    }

    // ── POST /apis/{api_name}/force-clear — remove stuck DELETE_FAILED record ──
    if (method === 'POST' && path.endsWith('/force-clear') && apiName) {
      const item = await db.getApi(apiName);
      if (!item) return err(`API '${apiName}' not found`, 404);
      if (item.status !== 'DELETE_FAILED' && item.status !== 'FAILED') {
        return err(`Force clear only allowed for DELETE_FAILED or FAILED status (current: ${item.status})`, 400);
      }
      console.log(`[handler|${apiName}|apiId=${item.api_id ?? 'none'}] force-clear — status=${item.status}`);
      await db.deleteApi(apiName);
      return ok({ message: `API '${apiName}' force-cleared from registry. Note: some AWS resources may still exist — check AWS Console.` });
    }

    // ── DELETE /apis/{api_name} — destroy an API ──────────────────────────────
    if (method === 'DELETE' && apiName) {
      const item = await db.getApi(apiName);
      if (!item) return err(`API '${apiName}' not found`, 404);
      if (item.status === 'DELETING') return err(`API '${apiName}' is already being deleted`, 409);

      // Allow deleting FAILED records too — they may have partial AWS resources
      const deletableStatuses = ['ACTIVE', 'FAILED', 'DELETE_FAILED'];
      if (!deletableStatuses.includes(item.status)) {
        return err(`Cannot delete API with status '${item.status}'`, 400);
      }

      console.log(`[handler|${apiName}|${item.api_type}|apiId=${item.api_id ?? 'none'}] DELETE — status=${item.status}`);
      await db.updateStatus(apiName, 'DELETING');

      const provisioner = provisioners[item.api_type];
      try {
        await provisioner.destroy({
          api_id:      item.api_id,
          api_name:    item.api_name,
          environment: item.environment,
          resources:   item.resources ? JSON.parse(item.resources) : {},
        });
      } catch (destroyError) {
        const errDetail = await serializeAwsError(destroyError);
        console.error(`[handler|${apiName}|${item.api_type}|apiId=${item.api_id ?? 'none'}] destroy FAILED — code=${errDetail.code} status=${errDetail.httpStatus}`);
        await db.updateStatus(apiName, 'DELETE_FAILED', {
          error_message: errDetail.message,
          error_code:    errDetail.code    ?? null,
          error_status:  errDetail.httpStatus ? String(errDetail.httpStatus) : null,
          error_req_id:  errDetail.requestId  ?? null,
        });
        console.error('[handler] Destroy failed:', destroyError);
        return err('Destroy failed', 500, errDetail);
      }

      console.log(`[handler|${apiName}|${item.api_type}|apiId=${item.api_id ?? 'none'}] destroy complete — removing DB record`);
      await db.deleteApi(apiName);
      return ok({ message: `API '${apiName}' and all its AWS resources have been deleted` });
    }

    return err('Route not found', 404);

  } catch (e) {
    console.error('[handler] Unhandled error:', e);
    return err('Internal server error', 500, await serializeAwsError(e));
  }
};
