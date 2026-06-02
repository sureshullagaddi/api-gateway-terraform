output "gui_url" {
  description = "Web GUI URL — open in browser to manage APIs"
  value       = "http://${aws_s3_bucket_website_configuration.frontend.website_endpoint}"
}

output "backend_api_url" {
  description = "Backend API endpoint (used by the GUI)"
  value       = aws_apigatewayv2_stage.gui.invoke_url
}

output "dynamodb_table" {
  description = "DynamoDB table tracking all provisioned APIs"
  value       = aws_dynamodb_table.api_registry.name
}

output "gui_lambda_name" {
  description = "GUI Lambda function name"
  value       = aws_lambda_function.gui.function_name
}

