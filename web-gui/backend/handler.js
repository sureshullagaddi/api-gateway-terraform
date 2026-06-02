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

      // Check for duplicate api_name
      const existing = await db.getApi(body.api_name);
      if (existing) return err(`API '${body.api_name}' already exists. Use DELETE to remove it first.`, 409);

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
            await db.updateStatus(body.api_name, 'CREATING', { api_id: apiId });
          },
        });
      } catch (provisionError) {
        // Mark as failed in DynamoDB
        await db.updateStatus(body.api_name, 'FAILED', { error_message: provisionError.message });
        console.error('[handler] Provisioning failed:', provisionError);
        return err('Provisioning failed', 500, provisionError.message);
      }

      // Update DynamoDB with created resource IDs
      await db.updateStatus(body.api_name, 'ACTIVE', {
        api_id:       result.api_id,
        api_endpoint: result.api_endpoint,
        route_url:    result.route_url,
        resources:    JSON.stringify(result.resources ?? {}),
        test_hint:    result.test_hint ?? null,
        api_key_id:   result.api_key_id ?? null,
        usage_plan_id: result.usage_plan_id ?? null,
      });

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
      return ok({ count: items.length, apis: items });
    }

    // ── GET /apis/{api_name} — get one API ────────────────────────────────────
    if (method === 'GET' && apiName) {
      const item = await db.getApi(apiName);
      if (!item) return err(`API '${apiName}' not found`, 404);
      return ok(item);
    }

    // ── POST /apis/{api_name}/force-clear — remove stuck DELETE_FAILED record ──
    if (method === 'POST' && path.endsWith('/force-clear') && apiName) {
      const item = await db.getApi(apiName);
      if (!item) return err(`API '${apiName}' not found`, 404);
      if (item.status !== 'DELETE_FAILED' && item.status !== 'FAILED') {
        return err(`Force clear only allowed for DELETE_FAILED or FAILED status (current: ${item.status})`, 400);
      }
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
        await db.updateStatus(apiName, 'DELETE_FAILED', { error_message: destroyError.message });
        console.error('[handler] Destroy failed:', destroyError);
        return err('Destroy failed', 500, destroyError.message);
      }

      await db.deleteApi(apiName);
      return ok({ message: `API '${apiName}' and all its AWS resources have been deleted` });
    }

    return err('Route not found', 404);

  } catch (e) {
    console.error('[handler] Unhandled error:', e);
    return err('Internal server error', 500, e.message);
  }
};
