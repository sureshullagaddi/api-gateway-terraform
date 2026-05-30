locals {
  api_name = "${var.project_name}-${var.environment}-api"

  # Build a map of authorizer IDs so routes can reference them by key.
  # "jwt"    → Cognito JWT authorizer (always created)
  # "lambda" → Custom Lambda authorizer (created only when lambda_authorizer_uri != null)
  authorizer_ids = merge(
    { jwt = aws_apigatewayv2_authorizer.jwt.id },
    var.lambda_authorizer_uri != null
      ? { lambda = aws_apigatewayv2_authorizer.lambda_custom[0].id }
      : {}
  )
}

# ── HTTP API ──────────────────────────────────────────────────────────────────
resource "aws_apigatewayv2_api" "this" {
  name          = local.api_name
  protocol_type = "HTTP"
  description   = "Multi-auth HTTP API for ${var.project_name} (${var.environment})"
  tags          = var.tags
}

# ── Authorizer 1: Cognito JWT ──────────────────────────────────────────────────
# Always provisioned. Routes that need Cognito auth reference key = "jwt".
resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.this.id
  name             = "${local.api_name}-cognito-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${var.user_pool_id}"
    audience = [var.client_id]
  }
}

# ── Authorizer 2: Lambda Custom Authorizer (optional) ─────────────────────────
# Created only when var.lambda_authorizer_uri is set.
# Use this for: your own token format, external IdP, database lookup,
# API-key-in-header validation, or any custom auth logic.
#
# The authorizer Lambda receives the request context + identity sources,
# runs your code, and must return an IAM policy allowing or denying the call.
# Set authorizer_payload_format_version = "2.0" for the simplified response format.
resource "aws_apigatewayv2_authorizer" "lambda_custom" {
  count = var.lambda_authorizer_uri != null ? 1 : 0

  api_id                            = aws_apigatewayv2_api.this.id
  name                              = "${local.api_name}-lambda-authorizer"
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = var.lambda_authorizer_uri
  identity_sources                  = var.lambda_authorizer_identity_sources
  authorizer_payload_format_version = "2.0"

  # Cache the authorizer result for this many seconds (0 = no cache).
  # Set to 300 in prod to avoid calling the authorizer Lambda on every request.
  authorizer_result_ttl_in_seconds  = var.lambda_authorizer_cache_ttl
}

# Permission for API Gateway to invoke the custom authorizer Lambda
resource "aws_lambda_permission" "authorizer_invoke" {
  count = var.lambda_authorizer_uri != null ? 1 : 0

  statement_id  = "AllowAPIGatewayAuthorizerInvoke-${var.environment}"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_authorizer_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/authorizers/*"
}

# ── Lambda Integration (points to the "live" alias) ───────────────────────────
resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.lambda_invoke_arn
  payload_format_version = "2.0"
}

# ── Routes (data-driven — add/change routes without editing this file) ─────────
# Each entry in var.routes creates one API Gateway route.
# authorization_type options:
#   "JWT"     — Cognito JWT token in Authorization header
#   "CUSTOM"  — Lambda authorizer (any custom logic)
#   "AWS_IAM" — SigV4 signed request (AWS service-to-service)
#   "NONE"    — No auth (public endpoint)
#
# authorizer_key: which authorizer to attach — "jwt" or "lambda".
# Leave null for AWS_IAM and NONE routes (they don't need an authorizer resource).
resource "aws_apigatewayv2_route" "routes" {
  for_each = var.routes

  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.key

  authorization_type = each.value.authorization_type
  authorizer_id      = (each.value.authorization_type == "JWT" || each.value.authorization_type == "CUSTOM") ? local.authorizer_ids[each.value.authorizer_key] : null

  target = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# ── Stage with throttling + access logging ────────────────────────────────────
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.throttling_burst_limit
    throttling_rate_limit  = var.throttling_rate_limit
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
  }

  tags = var.tags

  depends_on = [aws_cloudwatch_log_group.api_access]
}

# ── Lambda resource-based policy (allow API GW to invoke the live alias) ──────
resource "aws_lambda_permission" "apigw_invoke" {
  statement_id  = "AllowAPIGatewayInvoke-${var.environment}"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  qualifier     = "live"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
