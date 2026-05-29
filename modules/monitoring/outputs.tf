output "sns_topic_arn" {
  description = "SNS topic ARN for CloudWatch alarms"
  value       = aws_sns_topic.alarms.arn
}

output "dashboard_name" {
  description = "CloudWatch dashboard name"
  value       = aws_cloudwatch_dashboard.main.dashboard_name
}

output "dashboard_url" {
  description = "Direct link to the CloudWatch dashboard"
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}"
}

