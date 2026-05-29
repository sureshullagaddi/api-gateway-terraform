locals {
  prefix = "${var.project_name}-${var.environment}"
}

# ── SNS Topic for alarm notifications ────────────────────────────────────────
resource "aws_sns_topic" "alarms" {
  name = "${local.prefix}-alarms"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# ── Lambda Alarms ─────────────────────────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${local.prefix}-lambda-errors"
  alarm_description   = "Lambda error rate > 1% for 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 1

  metric_query {
    id          = "error_rate"
    expression  = "errors / invocations * 100"
    label       = "Lambda Error Rate (%)"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/Lambda"
      metric_name = "Errors"
      dimensions  = { FunctionName = var.lambda_function_name }
      period      = 300
      stat        = "Sum"
    }
  }

  metric_query {
    id = "invocations"
    metric {
      namespace   = "AWS/Lambda"
      metric_name = "Invocations"
      dimensions  = { FunctionName = var.lambda_function_name }
      period      = 300
      stat        = "Sum"
    }
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  alarm_name          = "${local.prefix}-lambda-throttles"
  alarm_description   = "Lambda throttles detected"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = var.lambda_function_name }
  period              = 60
  statistic           = "Sum"

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_duration_p95" {
  alarm_name          = "${local.prefix}-lambda-duration-p95"
  alarm_description   = "Lambda P95 duration > 5s"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 5000
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  dimensions          = { FunctionName = var.lambda_function_name }
  period              = 300
  extended_statistic  = "p95"

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

# ── API Gateway Alarms ────────────────────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.prefix}-api-5xx"
  alarm_description   = "API Gateway 5XX error count > 5 in 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 5
  namespace           = "AWS/ApiGateway"
  metric_name         = "5XXError"
  dimensions          = { ApiId = var.api_id }
  period              = 300
  statistic           = "Sum"

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "api_4xx" {
  alarm_name          = "${local.prefix}-api-4xx"
  alarm_description   = "API Gateway 4XX error count > 50 in 5 minutes (potential abuse)"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 50
  namespace           = "AWS/ApiGateway"
  metric_name         = "4XXError"
  dimensions          = { ApiId = var.api_id }
  period              = 300
  statistic           = "Sum"

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = var.tags
}

# ── CloudWatch Dashboard ──────────────────────────────────────────────────────
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${local.prefix}-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Lambda — Invocations & Errors"
          view    = "timeSeries"
          stacked = false
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", var.lambda_function_name, { stat = "Sum", label = "Invocations" }],
            ["AWS/Lambda", "Errors", "FunctionName", var.lambda_function_name, { stat = "Sum", color = "#d62728", label = "Errors" }],
          ]
          period = 300
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Lambda — Duration (ms)"
          view    = "timeSeries"
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", var.lambda_function_name, { stat = "Average", label = "Avg" }],
            ["AWS/Lambda", "Duration", "FunctionName", var.lambda_function_name, { stat = "p95", label = "P95" }],
            ["AWS/Lambda", "Duration", "FunctionName", var.lambda_function_name, { stat = "Maximum", label = "Max", color = "#d62728" }],
          ]
          period = 300
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "API Gateway — Request Count"
          view    = "timeSeries"
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiId", var.api_id, { stat = "Sum", label = "Requests" }],
          ]
          period = 300
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "API Gateway — 4XX / 5XX Errors"
          view    = "timeSeries"
          metrics = [
            ["AWS/ApiGateway", "4XXError", "ApiId", var.api_id, { stat = "Sum", color = "#ff7f0e", label = "4XX" }],
            ["AWS/ApiGateway", "5XXError", "ApiId", var.api_id, { stat = "Sum", color = "#d62728", label = "5XX" }],
          ]
          period = 300
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 12
        height = 6
        properties = {
          title   = "API Gateway — Latency (ms)"
          view    = "timeSeries"
          metrics = [
            ["AWS/ApiGateway", "Latency", "ApiId", var.api_id, { stat = "Average", label = "Avg" }],
            ["AWS/ApiGateway", "Latency", "ApiId", var.api_id, { stat = "p95", label = "P95" }],
          ]
          period = 300
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 12
        width  = 12
        height = 6
        properties = {
          title   = "Lambda — Throttles & Concurrent Executions"
          view    = "timeSeries"
          metrics = [
            ["AWS/Lambda", "Throttles", "FunctionName", var.lambda_function_name, { stat = "Sum", color = "#d62728", label = "Throttles" }],
            ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", var.lambda_function_name, { stat = "Maximum", label = "Concurrent" }],
          ]
          period = 300
          region = var.aws_region
        }
      }
    ]
  })
}
