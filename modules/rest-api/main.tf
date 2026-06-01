# ============================================================================
# modules/rest-api/main.tf
#
# REST API (v1) — Per-Partner Rate Limiting with Usage Plans
#
# Real-world scenario (IKANO bank):
#   Partner banks call GET /partner/accounts to retrieve account summaries.
#   Each partner gets their own AWS-managed API key + quota:
#
#     Nordea (premium partner):   10,000 req/day │ 100 req/s rate │ 200 burst
#     SEB    (standard partner):   5,000 req/day │  50 req/s rate │ 100 burst
#
# Why REST API and NOT HTTP API here?
#   HTTP API has no concept of per-client quotas.
#   REST API Usage Plans enforce this natively — AWS tracks every key
#   independently and returns 429 (Too Many Requests) automatically when
#   the quota or throttle is exceeded. Zero Lambda code needed.
#
# Architecture:
#   Nordea system → x-api-key: <nordea-key> → REST API (validates key + plan)
#                                            → Lambda (same backend as HTTP API)
#                                            → returns partner account summary
# ============================================================================
# modules/rest-api/main.tf
#
# REST API (v1) — Per-Partner Rate Limiting with Usage Plans + CloudWatch logging
# ============================================================================

# ── CloudWatch IAM role — required once per AWS account for REST API logging ──
# REST API v1 requires an account-level IAM role before any stage can log.
# HTTP API v2 does NOT need this — that's why logging worked there without setup.
resource "aws_iam_role" "api_gateway_cloudwatch" {
  name = "${var.project_name}-${var.environment}-rest-api-cw-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "apigateway.amazonaws.com" }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "api_gateway_cloudwatch" {
  role       = aws_iam_role.api_gateway_cloudwatch.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

# Register the CloudWatch role at account level — one per AWS region.
# Shared by ALL REST APIs in the account. Safe to apply multiple times.
resource "aws_api_gateway_account" "this" {
  cloudwatch_role_arn = aws_iam_role.api_gateway_cloudwatch.arn
  depends_on          = [aws_iam_role_policy_attachment.api_gateway_cloudwatch]
}

resource "aws_cloudwatch_log_group" "rest_api_access" {
  name              = "/aws/apigateway/${var.project_name}-${var.environment}-partner-rest-api"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_api_gateway_rest_api" "this" {
  name        = "${var.project_name}-${var.environment}-partner-rest-api"
  description = "REST API (v1) — per-partner rate limiting via usage plans (IKANO bank demo)"

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = var.tags
}

# ── /partner resource ─────────────────────────────────────────────────────────
resource "aws_api_gateway_resource" "partner" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "partner"
}

# ── /partner/accounts resource ────────────────────────────────────────────────
resource "aws_api_gateway_resource" "accounts" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.partner.id
  path_part   = "accounts"
}

# ── GET /partner/accounts ─────────────────────────────────────────────────────
# api_key_required = true → REST API checks the x-api-key header automatically.
# If the key is invalid, expired, or over quota → 403 / 429 before Lambda runs.
resource "aws_api_gateway_method" "get_accounts" {
  rest_api_id      = aws_api_gateway_rest_api.this.id
  resource_id      = aws_api_gateway_resource.accounts.id
  http_method      = "GET"
  authorization    = "NONE"
  api_key_required = true # ← the key feature that forces REST API here
}

# ── Lambda proxy integration ───────────────────────────────────────────────────
# AWS_PROXY → REST API passes the full event to Lambda and returns its response.
# Same Lambda function as the HTTP API — one backend, two front-doors.
resource "aws_api_gateway_integration" "get_accounts" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.accounts.id
  http_method             = aws_api_gateway_method.get_accounts.http_method
  integration_http_method = "POST" # Lambda is always invoked via POST internally
  type                    = "AWS_PROXY"
  uri                     = var.lambda_invoke_arn
}

# ── Deployment ────────────────────────────────────────────────────────────────
# Trigger redeployment whenever the API structure changes.
resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.partner.id,
      aws_api_gateway_resource.accounts.id,
      aws_api_gateway_method.get_accounts.id,
      aws_api_gateway_integration.get_accounts.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [aws_api_gateway_integration.get_accounts]
}

# ── Stage ─────────────────────────────────────────────────────────────────────
resource "aws_api_gateway_stage" "this" {
  deployment_id = aws_api_gateway_deployment.this.id
  rest_api_id   = aws_api_gateway_rest_api.this.id
  stage_name    = var.environment

  # CloudWatch access logging — requires aws_api_gateway_account to be set first
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.rest_api_access.arn
    format = jsonencode({
      requestId  = "$context.requestId"
      ip         = "$context.identity.sourceIp"
      path       = "$context.path"
      httpMethod = "$context.httpMethod"
      status     = "$context.status"
      apiKeyId   = "$context.identity.apiKeyId"
      responseLength = "$context.responseLength"
      error      = "$context.error.message"
    })
  }

  depends_on = [aws_api_gateway_account.this]

  tags = var.tags
}

# ── Usage Plan: Premium — Nordea ──────────────────────────────────────────────
# 10,000 requests per day. Burst of 200 — handles spike traffic.
# When limit is hit → AWS returns 429 Too Many Requests automatically.
resource "aws_api_gateway_usage_plan" "premium" {
  name        = "${var.project_name}-${var.environment}-partner-premium"
  description = "Premium partner (e.g. Nordea) — 10,000 req/day, 100 req/s"

  api_stages {
    api_id = aws_api_gateway_rest_api.this.id
    stage  = aws_api_gateway_stage.this.stage_name
  }

  quota_settings {
    limit  = 10000
    period = "DAY"
  }

  throttle_settings {
    rate_limit  = 100
    burst_limit = 200
  }

  tags = var.tags
}

# ── Usage Plan: Standard — SEB ────────────────────────────────────────────────
# 5,000 requests per day. Stricter throttle.
resource "aws_api_gateway_usage_plan" "standard" {
  name        = "${var.project_name}-${var.environment}-partner-standard"
  description = "Standard partner (e.g. SEB) — 5,000 req/day, 50 req/s"

  api_stages {
    api_id = aws_api_gateway_rest_api.this.id
    stage  = aws_api_gateway_stage.this.stage_name
  }

  quota_settings {
    limit  = 5000
    period = "DAY"
  }

  throttle_settings {
    rate_limit  = 50
    burst_limit = 100
  }

  tags = var.tags
}

# ── API Keys ──────────────────────────────────────────────────────────────────
# AWS generates secure random values. View them with:
#   terraform output -raw rest_api_nordea_key
#   terraform output -raw rest_api_seb_key
resource "aws_api_gateway_api_key" "nordea" {
  name        = "${var.project_name}-${var.environment}-nordea-partner-key"
  description = "Nordea Bank partner API key — premium plan (10K req/day)"
  enabled     = true
  tags        = var.tags
}

resource "aws_api_gateway_api_key" "seb" {
  name        = "${var.project_name}-${var.environment}-seb-partner-key"
  description = "SEB Bank partner API key — standard plan (5K req/day)"
  enabled     = true
  tags        = var.tags
}

# ── Attach API Keys to Usage Plans ───────────────────────────────────────────
resource "aws_api_gateway_usage_plan_key" "nordea" {
  key_id        = aws_api_gateway_api_key.nordea.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.premium.id
}

resource "aws_api_gateway_usage_plan_key" "seb" {
  key_id        = aws_api_gateway_api_key.seb.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.standard.id
}

# ── Lambda permission ─────────────────────────────────────────────────────────
# Separate permission from the HTTP API — different source_arn, same Lambda.
resource "aws_lambda_permission" "rest_api_invoke" {
  statement_id  = "AllowRESTAPIInvoke-${var.environment}"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  qualifier     = "live"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

