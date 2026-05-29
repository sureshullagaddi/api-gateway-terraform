output "api_endpoint" {
  description = "Base invoke URL of the deployed HTTP API stage"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "api_id" {
  description = "API Gateway HTTP API ID"
  value       = aws_apigatewayv2_api.this.id
}

output "execution_arn" {
  description = "Execution ARN — used when constructing Lambda source_arn for permissions"
  value       = aws_apigatewayv2_api.this.execution_arn
}

output "waf_arn" {
  description = "WAF WebACL ARN (empty string when enable_waf = false)"
  value       = var.enable_waf ? aws_wafv2_web_acl.api[0].arn : ""
}

output "route_urls" {
  description = "Map of every configured route key → its full invokable URL"
  value = {
    for route_key in keys(var.routes) :
    route_key => "${aws_apigatewayv2_stage.default.invoke_url}${split(" ", route_key)[1]}"
  }
}

output "jwt_authorizer_id" {
  description = "ID of the Cognito JWT authorizer"
  value       = aws_apigatewayv2_authorizer.jwt.id
}

output "lambda_authorizer_id" {
  description = "ID of the Lambda custom authorizer (null when not configured)"
  value       = var.lambda_authorizer_uri != null ? aws_apigatewayv2_authorizer.lambda_custom[0].id : null
}
