output "api_endpoint" {
  description = "REST API base URL (includes stage name)"
  value       = aws_api_gateway_stage.this.invoke_url
}

output "partner_accounts_url" {
  description = "Full URL for GET /partner/accounts — send x-api-key header to call this"
  value       = "${aws_api_gateway_stage.this.invoke_url}/partner/accounts"
}

output "nordea_api_key" {
  description = "Nordea partner API key — premium plan (10K req/day). Send as x-api-key header."
  value       = aws_api_gateway_api_key.nordea.value
  sensitive   = true
}

output "seb_api_key" {
  description = "SEB partner API key — standard plan (5K req/day). Send as x-api-key header."
  value       = aws_api_gateway_api_key.seb.value
  sensitive   = true
}

output "rest_api_id" {
  description = "REST API ID"
  value       = aws_api_gateway_rest_api.this.id
}

output "nordea_test_command" {
  description = "Steps to test with the Nordea (premium) API key"
  value       = "1. Get key: terraform output -raw rest_api_nordea_key  2. curl -s -H 'x-api-key: <KEY>' ${aws_api_gateway_stage.this.invoke_url}/partner/accounts"
}

output "seb_test_command" {
  description = "Steps to test with the SEB (standard) API key"
  value       = "1. Get key: terraform output -raw rest_api_seb_key  2. curl -s -H 'x-api-key: <KEY>' ${aws_api_gateway_stage.this.invoke_url}/partner/accounts"
}

