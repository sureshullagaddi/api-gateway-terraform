# ============================================================================
# web-gui/infrastructure/main.tf
#
# Self-service API Portal — infrastructure for the web GUI.
#
# Architecture:
#   S3 (static website) → user opens GUI in browser
#   API Gateway (HTTP)  → routes GUI backend requests
#   Lambda              → handles provisioning logic via AWS SDK
#   DynamoDB            → tracks all created APIs (state store)
#
# The GUI Lambda reuses resources from the existing stack:
#   - Existing backend Lambda (api-demo-dev-lambda) as the API handler
#   - Existing Cognito pool for JWT auth type
#   - Existing custom authorizer Lambda for custom-key auth type
#
# Each provisioned API gets:
#   - Its own AWS API Gateway (isolated)
#   - Its own routes/authorizers
#   - A DynamoDB record tracking all created resource IDs
# ============================================================================

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Component   = "web-gui"
  }
}

# ── DynamoDB — tracks all APIs created through the GUI ───────────────────────
resource "aws_dynamodb_table" "api_registry" {
  name         = "${local.name_prefix}-api-registry"
  billing_mode = "PAY_PER_REQUEST" # no provisioned capacity cost
  hash_key     = "api_name"

  attribute {
    name = "api_name"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = local.tags
}

# ── IAM role for the GUI Lambda ───────────────────────────────────────────────
resource "aws_iam_role" "gui_lambda" {
  name = "${local.name_prefix}-gui-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "gui_lambda_basic" {
  role       = aws_iam_role.gui_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "gui_lambda_permissions" {
  name = "${local.name_prefix}-gui-lambda-policy"
  role = aws_iam_role.gui_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # DynamoDB — read/write the API registry
      {
        Sid    = "DynamoDB"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem", "dynamodb:GetItem",
          "dynamodb:DeleteItem", "dynamodb:Scan", "dynamodb:UpdateItem"
        ]
        Resource = aws_dynamodb_table.api_registry.arn
      },
      # API Gateway — manage routes, authorizers, integrations
      {
        Sid      = "APIGateway"
        Effect   = "Allow"
        Action   = ["apigateway:*"]
        Resource = "*"
      },
      # Lambda — add/remove resource-based policies for API GW invocation
      {
        Sid    = "LambdaPermissions"
        Effect = "Allow"
        Action = ["lambda:AddPermission", "lambda:RemovePermission", "lambda:GetPolicy"]
        Resource = [
          "arn:aws:lambda:${var.existing_aws_region}:*:function:${var.existing_lambda_function_name}*",
          "arn:aws:lambda:${var.existing_aws_region}:*:function:${var.existing_authorizer_function_name}*"
        ]
      },
      # CloudWatch Logs — for API Gateway access logging
      {
        Sid      = "CloudWatchLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy"]
        Resource = "arn:aws:logs:*:*:log-group:/aws/apigateway/api-portal-*"
      },
      # IAM — account-level API GW CloudWatch role (for REST API logging)
      {
        Sid      = "APIGatewayAccount"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = "*"
        Condition = {
          StringLike = { "iam:PassedToService" = "apigateway.amazonaws.com" }
        }
      }
    ]
  })
}

# ── CloudWatch log group for GUI Lambda ───────────────────────────────────────
resource "aws_cloudwatch_log_group" "gui_lambda" {
  name              = "/aws/lambda/${local.name_prefix}-gui-lambda"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

# ── Package the GUI Lambda ────────────────────────────────────────────────────
data "archive_file" "gui_lambda" {
  type        = "zip"
  source_dir  = "${path.root}/../backend"
  output_path = "${path.root}/../backend.zip"
}

# ── GUI Lambda function ───────────────────────────────────────────────────────
resource "aws_lambda_function" "gui" {
  function_name    = "${local.name_prefix}-gui-lambda"
  role             = aws_iam_role.gui_lambda.arn
  runtime          = "nodejs18.x"
  handler          = "handler.handler"
  filename         = data.archive_file.gui_lambda.output_path
  source_code_hash = data.archive_file.gui_lambda.output_base64sha256
  architectures    = ["arm64"]
  timeout          = 60 # provisioning can take up to 60s

  environment {
    variables = {
      DYNAMODB_TABLE                    = aws_dynamodb_table.api_registry.name
      AWS_ACCOUNT_REGION                = var.existing_aws_region
      EXISTING_LAMBDA_ARN               = var.existing_lambda_arn
      EXISTING_LAMBDA_FUNCTION_NAME     = var.existing_lambda_function_name
      EXISTING_COGNITO_POOL_ID          = var.existing_cognito_pool_id
      EXISTING_COGNITO_CLIENT_ID        = var.existing_cognito_client_id
      EXISTING_AUTHORIZER_LAMBDA_ARN    = var.existing_authorizer_lambda_arn
      EXISTING_AUTHORIZER_FUNCTION_NAME = var.existing_authorizer_function_name
      CORS_ALLOWED_ORIGIN               = var.cors_allowed_origin
    }
  }

  tags       = local.tags
  depends_on = [aws_cloudwatch_log_group.gui_lambda]
}

# ── API Gateway for the GUI backend ───────────────────────────────────────────
resource "aws_apigatewayv2_api" "gui" {
  name          = "${local.name_prefix}-gui-api"
  protocol_type = "HTTP"
  description   = "API Portal backend — handles GUI provisioning requests"

  cors_configuration {
    allow_origins = [var.cors_allowed_origin]
    allow_methods = ["GET", "POST", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 300
  }

  tags = local.tags
}

resource "aws_apigatewayv2_integration" "gui" {
  api_id                 = aws_apigatewayv2_api.gui.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.gui.invoke_arn
  payload_format_version = "2.0"
}

# Routes — GUI backend endpoints
resource "aws_apigatewayv2_route" "provision" {
  api_id    = aws_apigatewayv2_api.gui.id
  route_key = "POST /apis"
  target    = "integrations/${aws_apigatewayv2_integration.gui.id}"
}

resource "aws_apigatewayv2_route" "list" {
  api_id    = aws_apigatewayv2_api.gui.id
  route_key = "GET /apis"
  target    = "integrations/${aws_apigatewayv2_integration.gui.id}"
}

resource "aws_apigatewayv2_route" "get_one" {
  api_id    = aws_apigatewayv2_api.gui.id
  route_key = "GET /apis/{api_name}"
  target    = "integrations/${aws_apigatewayv2_integration.gui.id}"
}

resource "aws_apigatewayv2_route" "destroy" {
  api_id    = aws_apigatewayv2_api.gui.id
  route_key = "DELETE /apis/{api_name}"
  target    = "integrations/${aws_apigatewayv2_integration.gui.id}"
}

resource "aws_apigatewayv2_route" "force_clear" {
  api_id    = aws_apigatewayv2_api.gui.id
  route_key = "POST /apis/{api_name}/force-clear"
  target    = "integrations/${aws_apigatewayv2_integration.gui.id}"
}

resource "aws_apigatewayv2_stage" "gui" {
  api_id      = aws_apigatewayv2_api.gui.id
  name        = "$default"
  auto_deploy = true
  tags        = local.tags
}

resource "aws_lambda_permission" "gui_apigw" {
  statement_id  = "AllowGUIAPIGWInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.gui.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.gui.execution_arn}/*/*"
}

# ── S3 — static website hosting ───────────────────────────────────────────────
resource "aws_s3_bucket" "frontend" {
  bucket = "${local.name_prefix}-frontend-${data.aws_caller_identity.current.account_id}"
  tags   = local.tags
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket_website_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  index_document { suffix = "index.html" }
  error_document { key = "index.html" }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket     = aws_s3_bucket.frontend.id
  depends_on = [aws_s3_bucket_public_access_block.frontend]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
    }]
  })
}

# Upload React build output to S3
# Run: cd web-gui/frontend && npm install && npm run build  BEFORE terraform apply
locals {
  frontend_dist = "${path.root}/../frontend/dist"
  mime_types = {
    ".html" = "text/html"
    ".js"   = "application/javascript"
    ".css"  = "text/css"
    ".json" = "application/json"
    ".ico"  = "image/x-icon"
    ".svg"  = "image/svg+xml"
    ".png"  = "image/png"
  }
}

# Upload all built React files from dist/
resource "aws_s3_object" "react_build" {
  for_each = fileset(local.frontend_dist, "**/*")

  bucket       = aws_s3_bucket.frontend.id
  key          = each.value
  source       = "${local.frontend_dist}/${each.value}"
  content_type = lookup(local.mime_types, regex("\\.[^.]+$", each.value), "application/octet-stream")
  etag         = filemd5("${local.frontend_dist}/${each.value}")
}

# Upload config.js — runtime injection of API endpoint (no rebuild needed)
resource "aws_s3_object" "config_js" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "config.js"
  content_type = "application/javascript"
  content      = "window.__CONFIG__ = { apiEndpoint: '${aws_apigatewayv2_stage.gui.invoke_url}' };"
  etag         = md5(aws_apigatewayv2_stage.gui.invoke_url)
}

