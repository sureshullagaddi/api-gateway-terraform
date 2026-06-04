'use strict';

const {
  ApiGatewayV2Client,
  CreateApiCommand,
  CreateIntegrationCommand,
  CreateRouteCommand,
  CreateStageCommand,
  CreateDeploymentCommand,
  CreateAuthorizerCommand,
  DeleteApiCommand,
} = require('@aws-sdk/client-apigatewayv2');

const {
  LambdaClient,
  AddPermissionCommand,
  RemovePermissionCommand,
} = require('@aws-sdk/client-lambda');

const {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  PutRetentionPolicyCommand,
  DeleteLogGroupCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');

const REGION = process.env.AWS_ACCOUNT_REGION || process.env.AWS_REGION;

// ── Build the correct Lambda integration URI for HTTP API v2 ─────────────────
// API GW v2 CreateIntegration requires the API GW invoke ARN format:
//   arn:aws:apigateway:{region}:lambda:path/2015-03-31/functions/{lambda-arn}/invocations
//
// EXISTING_LAMBDA_ARN can arrive in three formats — all normalised here:
//
//  A) Plain Lambda ARN, unqualified:
//       arn:aws:lambda:eu-north-1:ACCT:function:my-fn
//     → wrap into invoke ARN as-is
//
//  B) Plain Lambda ARN WITH qualifier (e.g. :live, :1):
//       arn:aws:lambda:eu-north-1:ACCT:function:my-fn:live
//     → strip qualifier, wrap into invoke ARN
//
//  C) Already in API GW invoke ARN format (from generate-tfvars.sh):
//       arn:aws:apigateway:eu-north-1:lambda:path/.../functions/arn:aws:lambda:...:live/invocations
//     → extract the embedded Lambda ARN, strip its qualifier, rebuild invoke ARN
//
// Result is always the clean unqualified invoke ARN used by CreateIntegrationCommand.
function buildIntegrationUri(lambdaArn) {
  if (!lambdaArn) return lambdaArn;

  let baseLambdaArn = lambdaArn;

  if (lambdaArn.startsWith('arn:aws:apigateway:')) {
    // Case C — extract the embedded Lambda ARN from the invoke-ARN wrapper
    const m = lambdaArn.match(
      /^arn:aws:apigateway:[^:]+:lambda:path\/2015-03-31\/functions\/(.+)\/invocations$/
    );
    if (m) {
      baseLambdaArn = m[1]; // e.g. arn:aws:lambda:eu-north-1:ACCT:function:NAME[:qualifier]
    } else {
      // Unknown API GW format — return as-is and let AWS give a clear error
      console.warn('[base] buildIntegrationUri: unrecognised invoke-ARN format, passing through');
      return lambdaArn;
    }
  }

  // Cases A, B, and extracted Case C — strip qualifier if present
  const parts = baseLambdaArn.split(':');
  // Standard Lambda ARN: arn:aws:lambda:region:account:function:name         (7 parts)
  // Qualified Lambda ARN: arn:aws:lambda:region:account:function:name:alias  (8 parts)
  const cleanArn = parts.length === 8 ? parts.slice(0, 7).join(':') : baseLambdaArn;

  // Warn on region mismatch — cross-region Lambda integration returns 400
  const arnRegion = parts[3];
  if (arnRegion && arnRegion !== REGION) {
    console.warn(
      `[base] buildIntegrationUri: Lambda ARN region '${arnRegion}' ` +
      `differs from configured REGION '${REGION}' — cross-region integrations return 400`
    );
  }

  const uri = `arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${cleanArn}/invocations`;
  console.log(`[base] buildIntegrationUri: ${lambdaArn.substring(0, 60)}... → ${uri}`);
  return uri;
}

// ── Extract qualifier/alias from a Lambda ARN (if present) ───────────────────
// Standard ARN (7 parts): arn:aws:lambda:{region}:{account}:function:{name}
// With qualifier (8 parts): arn:aws:lambda:{region}:{account}:function:{name}:{alias|version}
// Returns the qualifier string, or undefined if the ARN is unqualified.
function extractLambdaQualifier(lambdaArn) {
  if (!lambdaArn) return undefined;
  const parts = lambdaArn.split(':');
  // parts: ['arn','aws','lambda',region,account,'function',name,?qualifier]
  return parts.length === 8 ? parts[7] : undefined;
}

const apigw  = new ApiGatewayV2Client({ region: REGION });
const lambda = new LambdaClient({ region: REGION });
const logs   = new CloudWatchLogsClient({ region: REGION });
const sts    = new STSClient({ region: REGION });

// ── Raw HTTP response interceptor — logs the actual body before SDK parses it ─
// Catches the "Unknown: UnknownError bodyRaw=null" case where API GW returns
// a 400 with a body the SDK can't deserialize (no __type field).
apigw.middlewareStack.add(
  (next, context) => async (args) => {
    const result = await next(args);
    return result;
  },
  { step: 'initialize', name: 'debugMiddleware', priority: 'low' }
);

// Use deserialize step to capture raw response before SDK consumes it
apigw.middlewareStack.add(
  (next, context) => async (args) => {
    try {
      return await next(args);
    } catch (e) {
      // Re-read the response body from the error's $response if available
      if (e.$response) {
        try {
          const body = e.$response.body;
          let rawText = null;
          if (body && typeof body.transformToString === 'function') {
            rawText = await body.transformToString('utf8');
          } else if (body && typeof body.text === 'function') {
            rawText = await body.text();
          } else if (typeof body === 'string') {
            rawText = body;
          } else if (Buffer.isBuffer(body)) {
            rawText = body.toString('utf8');
          }
          console.error(`[apigw-middleware] raw HTTP ${e.$metadata?.httpStatusCode} response body for ${context.commandName}:`, rawText ?? '(empty/null)');
          console.error(`[apigw-middleware] request input for ${context.commandName}:`, JSON.stringify(args.input ?? {}, null, 2));
          // Attach so serializeAwsError can use it
          if (rawText && !e.bodyRaw) e.bodyRaw = rawText;
        } catch (readErr) {
          console.error('[apigw-middleware] could not read error body:', readErr?.message);
        }
      }
      throw e;
    }
  },
  { step: 'deserialize', name: 'rawErrorLogger', priority: 'low' }
);

// Cache account ID — fetched once per Lambda container lifetime
let _accountId = null;
async function getAccountId() {
  if (!_accountId) {
    const res = await sts.send(new GetCallerIdentityCommand({}));
    _accountId = res.Account;
  }
  return _accountId;
}

/**
 * Creates the base HTTP API + Lambda integration + stage.
 * Used by all HTTP API provisioners.
 * Returns: { apiId, integrationId, apiEndpoint }
 */
async function createHttpApiBase(apiName, environment, description, { onApiCreated } = {}) {
  // Consistent log prefix — apiId is filled in after step 1
  const tag = () => `[base|${apiName}-${environment}|apiId=${_apiId ?? 'pending'}]`;

  let _apiId = null;
  console.log(`${tag()} createHttpApiBase start | region=${REGION} | lambdaArn=${process.env.EXISTING_LAMBDA_ARN} | lambdaFn=${process.env.EXISTING_LAMBDA_FUNCTION_NAME}`);

  // 1. Create the HTTP API
  console.log(`${tag()} step 1 — CreateApi`);
  const api = await apigw.send(new CreateApiCommand({
    Name:         `${apiName}-${environment}-api`,
    ProtocolType: 'HTTP',
    Description:  description,
  }));
  _apiId = api.ApiId;
  console.log(`${tag()} step 1 done — endpoint=${api.ApiEndpoint}`);

  // ✅ Save api_id to DynamoDB immediately — so delete works even if later steps fail
  if (onApiCreated) await onApiCreated(api.ApiId);

  // 2. Create Lambda integration — points to EXISTING backend Lambda
  const integrationUri = buildIntegrationUri(process.env.EXISTING_LAMBDA_ARN);
  console.log(`${tag()} step 2 — CreateIntegration | integrationUri=${integrationUri}`);
  const integration = await apigw.send(new CreateIntegrationCommand({
    ApiId:                api.ApiId,
    IntegrationType:      'AWS_PROXY',
    IntegrationUri:       integrationUri,
    PayloadFormatVersion: '2.0',
  }));
  console.log(`${tag()} step 2 done — integrationId=${integration.IntegrationId}`);

  // 3. Create $default stage with auto-deploy
  // NOTE: Stage is intentionally created BEFORE authorizer/route so the API endpoint
  // is available, but AutoDeploy is set to FALSE here to avoid an internal AWS
  // deployment lock that causes CreateAuthorizerCommand to return HTTP 400.
  // Each provisioner must call createDefaultStage(apiId) AFTER adding its routes.
  console.log(`${tag()} step 3 — CreateStage (AutoDeploy=false, deploy triggered after routes)`);
  await apigw.send(new CreateStageCommand({
    ApiId:      api.ApiId,
    StageName:  '$default',
    AutoDeploy: false,
  }));
  console.log(`${tag()} step 3 done`);

  // 4. Create CloudWatch log group
  const logGroupName = `/aws/apigateway/${apiName}-${environment}-api`;
  console.log(`${tag()} step 4 — CreateLogGroup ${logGroupName}`);
  try {
    await logs.send(new CreateLogGroupCommand({ logGroupName }));
  } catch (e) {
    if (e.name !== 'ResourceAlreadyExistsException') throw e;
    console.log(`${tag()} step 4 — log group already exists, skipping`);
  }
  // PutRetentionPolicy is cosmetic — warn but never fail provisioning
  try {
    await logs.send(new PutRetentionPolicyCommand({ logGroupName, retentionInDays: 14 }));
  } catch (e) {
    console.warn(`${tag()} step 4 — could not set log retention (non-fatal): ${e.name} — ${e.message}`);
  }
  console.log(`${tag()} step 4 done`);

  // 5. Allow API Gateway to invoke the existing Lambda
  //    Integration URI now uses the UNQUALIFIED ARN (qualifier stripped in buildIntegrationUri).
  //    Permission is added WITHOUT a qualifier so it covers all versions/aliases.
  //    If you need to restrict to a specific alias (e.g. :live), set EXISTING_LAMBDA_ARN
  //    to the unqualified ARN AND add a separate permission for that alias explicitly.
  const accountId = await getAccountId();
  const sourceArn = `arn:aws:execute-api:${REGION}:${accountId}:${api.ApiId}/*/*`;
  console.log(`${tag()} step 5 — AddPermission | fn=${process.env.EXISTING_LAMBDA_FUNCTION_NAME} qualifier=none (unqualified) sourceArn=${sourceArn}`);
  try {
    await lambda.send(new AddPermissionCommand({
      FunctionName: process.env.EXISTING_LAMBDA_FUNCTION_NAME,
      StatementId:  `AllowAPIGW-${apiName}-${environment}`,
      Action:       'lambda:InvokeFunction',
      Principal:    'apigateway.amazonaws.com',
      SourceArn:    sourceArn,
      // No Qualifier — permission applies to all versions/aliases.
      // Integration URI points to unqualified ARN, so API GW invokes $LATEST
      // (or the alias configured on the function's auto-routing policy).
    }));
  } catch (e) {
    if (e.name === 'ResourceConflictException') {
      console.log(`${tag()} step 5 — Lambda permission already exists, skipping`);
    } else {
      throw e;
    }
  }
  console.log(`${tag()} step 5 done — createHttpApiBase complete`);

  return {
    apiId:           api.ApiId,
    integrationId:   integration.IntegrationId,
    apiEndpoint:     api.ApiEndpoint,
    logGroupName,
  };
}

/**
 * Deletes an HTTP API and cleans up Lambda permission + log group.
 */
async function deleteHttpApiBase(apiId, apiName, environment) {
  const tag = `[base|${apiName}-${environment}|apiId=${apiId ?? 'unknown'}]`;

  // Remove Lambda permission — no qualifier (matches how it was created: unqualified)
  console.log(`${tag} step 1 — RemovePermission | fn=${process.env.EXISTING_LAMBDA_FUNCTION_NAME} qualifier=none`);
  try {
    await lambda.send(new RemovePermissionCommand({
      FunctionName: process.env.EXISTING_LAMBDA_FUNCTION_NAME,
      StatementId:  `AllowAPIGW-${apiName}-${environment}`,
      // No Qualifier — must match the StatementId that was created without qualifier
    }));
    console.log(`${tag} step 1 done`);
  } catch (e) {
    console.warn(`${tag} step 1 — could not remove Lambda permission (non-fatal): ${e.name} — ${e.message}`);
  }

  // Delete the API (cascades — deletes routes, integrations, authorizers)
  console.log(`${tag} step 2 — DeleteApi | apiId=${apiId ?? 'none'}`);
  if (!apiId) {
    console.warn(`${tag} step 2 — no apiId (provisioning failed before API was created), skipping`);
  } else {
    try {
      await apigw.send(new DeleteApiCommand({ ApiId: apiId }));
      console.log(`${tag} step 2 done`);
    } catch (e) {
      // NotFoundException means already deleted — safe to continue
      if (e.name !== 'NotFoundException') {
        throw e;
      }
      console.warn(`${tag} step 2 — API not found, already deleted`);
    }
  }

  // Delete log group
  const logGroupName = `/aws/apigateway/${apiName}-${environment}-api`;
  console.log(`${tag} step 3 — DeleteLogGroup ${logGroupName}`);
  try {
    await logs.send(new DeleteLogGroupCommand({ logGroupName }));
    console.log(`${tag} step 3 done`);
  } catch (e) {
    console.warn(`${tag} step 3 — could not delete log group (non-fatal): ${e.name} — ${e.message}`);
  }

  console.log(`${tag} deleteHttpApiBase complete`);
}

/**
 * Enables AutoDeploy on the $default stage and triggers an immediate deployment.
 * Call this AFTER all routes and authorizers have been created to avoid the
 * API Gateway internal deployment lock that causes CreateAuthorizerCommand to
 * return HTTP 400 with empty body.
 */
async function enableAutoDeployAndDeploy(apiId, logTag) {
  console.log(`${logTag} enableAutoDeployAndDeploy — updating stage AutoDeploy=true then deploying`);

  // 1. Switch the stage to AutoDeploy=true now that routes/authorizers are set
  await apigw.send(new CreateStageCommand({
    ApiId:      apiId,
    StageName:  '$default',
    AutoDeploy: true,
  }));

  // 2. Trigger an explicit deployment so the routes/authorizers go live immediately
  const deployment = await apigw.send(new CreateDeploymentCommand({
    ApiId:     apiId,
    StageName: '$default',
  }));
  console.log(`${logTag} enableAutoDeployAndDeploy done — deploymentId=${deployment.DeploymentId}`);
}

module.exports = {
  apigw, lambda, logs,
  getAccountId,
  buildIntegrationUri,
  createHttpApiBase,
  enableAutoDeployAndDeploy,
  deleteHttpApiBase,
  CreateRouteCommand,
  CreateAuthorizerCommand,
  AddPermissionCommand,
  RemovePermissionCommand,
};

