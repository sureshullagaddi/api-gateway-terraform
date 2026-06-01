locals {
  function_name = "${var.project_name}-${var.environment}-lambda"
}

# ── CloudWatch log group (pre-create so retention is controlled by Terraform) ──
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

# ── IAM role ──────────────────────────────────────────────────────────────────
resource "aws_iam_role" "lambda" {
  name = "${local.function_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Required for X-Ray active tracing
resource "aws_iam_role_policy_attachment" "xray" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

# ── Custom Authorizer Lambda ───────────────────────────────────────────────────
# Separate function from the main handler — authorizer runs BEFORE main Lambda.
# Packaged from the same lambda/src/ directory but uses authorizer.handler.

resource "aws_cloudwatch_log_group" "authorizer" {
  name              = "/aws/lambda/${local.function_name}-authorizer"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_iam_role" "authorizer" {
  name = "${local.function_name}-authorizer-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "authorizer_basic_execution" {
  role       = aws_iam_role.authorizer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Allow authorizer Lambda to read the partner API key from Secrets Manager
resource "aws_iam_role_policy" "authorizer_secrets" {
  name = "${local.function_name}-authorizer-secrets-policy"
  role = aws_iam_role.authorizer.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = "arn:aws:secretsmanager:*:*:secret:${var.project_name}-${var.environment}/partner-api-key*"
    }]
  })
}

resource "aws_lambda_function" "authorizer" {
  function_name    = "${local.function_name}-authorizer"
  role             = aws_iam_role.authorizer.arn
  runtime          = "nodejs18.x"
  handler          = "authorizer.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  environment {
    variables = {
      ENVIRONMENT        = var.environment
      VALID_API_KEY      = var.authorizer_api_key        # fallback for dev (no Secrets Manager)
      API_KEY_SECRET_ARN = aws_secretsmanager_secret.partner_api_key.arn
    }
  }

  tags = var.tags

  depends_on = [
    aws_iam_role_policy_attachment.authorizer_basic_execution,
    aws_iam_role_policy.authorizer_secrets,
    aws_cloudwatch_log_group.authorizer,
  ]
}

# ── Secrets Manager — Partner API Key ─────────────────────────────────────────
# Stores the API key that partner banks (Nordea, SEB etc.) use to call /admin.
# The authorizer Lambda reads this at runtime (cached 5 min).
# To rotate: update the secret value — Lambda picks it up within 5 minutes.
resource "aws_secretsmanager_secret" "partner_api_key" {
  name                    = "${var.project_name}-${var.environment}/partner-api-key"
  description             = "API key for partner bank B2B access to ${var.project_name} ${var.environment} API"
  recovery_window_in_days = 0 # allow immediate deletion (no 30-day window in dev)
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "partner_api_key" {
  secret_id     = aws_secretsmanager_secret.partner_api_key.id
  secret_string = var.authorizer_api_key
}

# ── Package source → zip automatically on every plan/apply ───────────────────
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.root}/../../lambda/src"
  output_path = "${path.root}/../../lambda/lambda.zip"
}

# ── Lambda function ───────────────────────────────────────────────────────────
resource "aws_lambda_function" "this" {
  function_name    = local.function_name
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs18.x"
  handler          = "index.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  # publish = true creates a new numbered version on every code/config change.
  # This is the foundation for blue/green and canary deployments.
  publish = true

  tracing_config {
    mode = "Active" # X-Ray active tracing
  }

  environment {
    variables = {
      ENVIRONMENT = var.environment
      LOG_LEVEL   = var.environment == "prod" ? "ERROR" : "DEBUG"
    }
  }

  tags = var.tags

  depends_on = [
    aws_iam_role_policy_attachment.basic_execution,
    aws_iam_role_policy_attachment.xray,
    aws_cloudwatch_log_group.lambda,
  ]
}

# ── Blue/Green alias ──────────────────────────────────────────────────────────
# The "live" alias always points to the latest published version.
# API Gateway integrates with this alias — not the raw function ARN.
# To do a canary rollout: update this alias to point to the previous stable
# version and add routing_config to send a % to the new version, then
# shift 100% once validated. AWS CodeDeploy can automate this flow.
resource "aws_lambda_alias" "live" {
  name             = "live"
  function_name    = aws_lambda_function.this.function_name
  function_version = aws_lambda_function.this.version
}
