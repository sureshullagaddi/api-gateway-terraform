output "api_endpoint" {
  description = "REST API base URL"
  value       = aws_api_gateway_stage.this.invoke_url
}

output "route_url" {
  description = "Full URL for the provisioned route"
  value       = "${aws_api_gateway_stage.this.invoke_url}${var.route_path}"
}

output "partner_api_key" {
  description = "Partner API key value — send as x-api-key header"
  value       = aws_api_gateway_api_key.this.value
  sensitive   = true
}

output "partner_api_key_id" {
  description = "Partner API key ID — visible in AWS Console"
  value       = aws_api_gateway_api_key.this.id
}

output "usage_plan_name" {
  description = "Usage plan name"
  value       = aws_api_gateway_usage_plan.this.name
}

output "quota_per_day" {
  description = "Daily request quota for this partner"
  value       = var.quota_per_day
}

