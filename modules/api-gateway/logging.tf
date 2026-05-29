# CloudWatch log group for API Gateway access logs
resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${var.project_name}-${var.environment}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

