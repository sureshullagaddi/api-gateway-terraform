# ============================================================================
# modules/rest-api-single/main.tf
#
# Lightweight REST API (v1) — single partner, fully dynamic.
# Designed to be called by the API Factory workflow with any partner config.
#
# Unlike modules/rest-api (which hardcodes Nordea + SEB), this module
# accepts the partner name and quota as variables — one partner per deploy.
# Create multiple isolated stacks (different state keys) for multiple partners.
# ============================================================================

# ── CloudWatch IAM role (account-level, required for REST API logging) ────────
resource "aws_iam_role" "api_gateway_cloudwatch" {
  name = "${var.api_name}-${var.environment}-rest-cw-role"

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

resource "aws_api_gateway_account" "this" {
  cloudwatch_role_arn = aws_iam_role.api_gateway_cloudwatch.arn
  depends_on          = [aws_iam_role_policy_attachment.api_gateway_cloudwatch]
}

# ── REST API ──────────────────────────────────────────────────────────────────
resource "aws_api_gateway_rest_api" "this" {
  name        = "${var.api_name}-${var.environment}-rest-api"
  description = "REST API — ${var.partner_name} partner, ${var.quota_per_day} req/day quota"

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = var.tags
}

# ── Dynamic route resources ───────────────────────────────────────────────────
# Splits var.route_path ("/payments/summary") into parent + child path parts.
# e.g. route_path = "/transfers" → one resource at /transfers
locals {
  # Strip leading slash and split on "/"
  path_parts  = split("/", trimprefix(var.route_path, "/"))
  parent_part = local.path_parts[0]
  child_part  = length(local.path_parts) > 1 ? local.path_parts[1] : null
}

resource "aws_api_gateway_resource" "parent" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = local.parent_part
}

resource "aws_api_gateway_resource" "child" {
  count       = local.child_part != null ? 1 : 0
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.parent.id
  path_part   = local.child_part
}

locals {
  target_resource_id = local.child_part != null ? aws_api_gateway_resource.child[0].id : aws_api_gateway_resource.parent.id
}

# ── Method — API key required ─────────────────────────────────────────────────
resource "aws_api_gateway_method" "this" {
  rest_api_id      = aws_api_gateway_rest_api.this.id
  resource_id      = local.target_resource_id
  http_method      = var.http_method
  authorization    = "NONE"
  api_key_required = true
}

# ── Lambda proxy integration ──────────────────────────────────────────────────
resource "aws_api_gateway_integration" "this" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = local.target_resource_id
  http_method             = aws_api_gateway_method.this.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_invoke_arn
}

# ── Deployment ────────────────────────────────────────────────────────────────
resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.parent.id,
      aws_api_gateway_method.this.id,
      aws_api_gateway_integration.this.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [aws_api_gateway_integration.this]
}

# ── Stage ─────────────────────────────────────────────────────────────────────
resource "aws_api_gateway_stage" "this" {
  deployment_id = aws_api_gateway_deployment.this.id
  rest_api_id   = aws_api_gateway_rest_api.this.id
  stage_name    = var.environment
  depends_on    = [aws_api_gateway_account.this]
  tags          = var.tags
}

# ── Usage Plan ────────────────────────────────────────────────────────────────
resource "aws_api_gateway_usage_plan" "this" {
  name        = "${var.api_name}-${var.environment}-${var.partner_name}-plan"
  description = "${var.partner_name} — ${var.quota_per_day} req/day, ${var.rate_limit_per_second} req/s"

  api_stages {
    api_id = aws_api_gateway_rest_api.this.id
    stage  = aws_api_gateway_stage.this.stage_name
  }

  quota_settings {
    limit  = var.quota_per_day
    period = "DAY"
  }

  throttle_settings {
    rate_limit  = var.rate_limit_per_second
    burst_limit = var.rate_limit_per_second * 2
  }

  tags = var.tags
}

# ── API Key ───────────────────────────────────────────────────────────────────
resource "aws_api_gateway_api_key" "this" {
  name        = "${var.api_name}-${var.environment}-${var.partner_name}-key"
  description = "${var.partner_name} API key — ${var.quota_per_day} req/day"
  enabled     = true
  tags        = var.tags
}

resource "aws_api_gateway_usage_plan_key" "this" {
  key_id        = aws_api_gateway_api_key.this.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.this.id
}

# ── Lambda permission ─────────────────────────────────────────────────────────
resource "aws_lambda_permission" "this" {
  statement_id  = "AllowRESTAPIFactoryInvoke-${var.api_name}-${var.environment}"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  qualifier     = "live"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

