# All outputs delegate to the stack module.
# To add a new output, add it to modules/stack/outputs.tf first,
# then add the corresponding delegation line below.

output "api_endpoint"         { value = module.stack.api_endpoint;         description = "HTTP API base URL" }
output "secure_endpoint"      { value = module.stack.secure_endpoint;      description = "JWT-protected GET /secure URL" }
output "cognito_user_pool_id" { value = module.stack.cognito_user_pool_id; description = "Cognito User Pool ID" }
output "cognito_client_id"    { value = module.stack.cognito_client_id;    description = "Cognito App Client ID" }
output "lambda_function_name" { value = module.stack.lambda_function_name; description = "Lambda function name" }
output "lambda_version"       { value = module.stack.lambda_version;       description = "Published Lambda version" }
output "dashboard_url"        { value = module.stack.dashboard_url;        description = "CloudWatch dashboard URL" }
output "waf_arn"              { value = module.stack.waf_arn;              description = "WAF WebACL ARN" }
output "sns_topic_arn"        { value = module.stack.sns_topic_arn;        description = "CloudWatch alarms SNS topic ARN" }
