# Testing Guide — After Workflow Runs

This guide tells you **exactly what to test, how to test it, and what to expect** after a successful `terraform apply` on any environment.

Run these tests in order — each section builds on the previous one.

---

## Before You Start — Grab the Outputs

Every test needs values from Terraform outputs. Fetch them all once and export as shell variables:

```bash
ENV=dev   # change to sit | stage | prod as needed

# Fetch all outputs
API_ENDPOINT=$(terraform -chdir=environments/$ENV output -raw api_endpoint)
SECURE_URL=$(terraform -chdir=environments/$ENV output -raw secure_endpoint)
USER_POOL_ID=$(terraform -chdir=environments/$ENV output -raw cognito_user_pool_id)
CLIENT_ID=$(terraform -chdir=environments/$ENV output -raw cognito_client_id)
LAMBDA_NAME=$(terraform -chdir=environments/$ENV output -raw lambda_function_name)
DASHBOARD_URL=$(terraform -chdir=environments/$ENV output -raw dashboard_url)
AWS_REGION=eu-north-1

echo "API:       $API_ENDPOINT"
echo "Secure:    $SECURE_URL"
echo "Pool:      $USER_POOL_ID"
echo "Client:    $CLIENT_ID"
echo "Lambda:    $LAMBDA_NAME"
echo "Dashboard: $DASHBOARD_URL"
```

---

## Test 1 — Infrastructure Exists

Verify every AWS resource was actually created. These tests don't need an HTTP call.

### 1a — Lambda function and alias

```bash
# Confirm function exists and is active
aws lambda get-function \
  --function-name "$LAMBDA_NAME" \
  --region "$AWS_REGION" \
  --query "Configuration.[FunctionName,State,Runtime,Handler]"
```
✅ Expected: `["api-demo-dev-lambda", "Active", "nodejs18.x", "index.handler"]`

```bash
# Confirm "live" alias exists and points to a published version
aws lambda get-alias \
  --function-name "$LAMBDA_NAME" \
  --name live \
  --region "$AWS_REGION" \
  --query "[Name,FunctionVersion]"
```
✅ Expected: `["live", "1"]`  (version number increments on each deploy)

---

### 1b — API Gateway

```bash
# List APIs and confirm yours is there
aws apigatewayv2 get-apis \
  --region "$AWS_REGION" \
  --query "Items[?contains(Name, 'api-demo-$ENV')].{Name:Name,State:ApiEndpoint,Protocol:ProtocolType}"
```
✅ Expected: one HTTP API entry with your name and endpoint.

```bash
# Confirm the JWT authorizer is attached
API_ID=$(aws apigatewayv2 get-apis \
  --region "$AWS_REGION" \
  --query "Items[?contains(Name, 'api-demo-$ENV')].ApiId" \
  --output text)

aws apigatewayv2 get-authorizers \
  --api-id "$API_ID" \
  --region "$AWS_REGION" \
  --query "Items[].{Name:Name,Type:AuthorizerType}"
```
✅ Expected: `[{"Name": "api-demo-dev-api-cognito-jwt", "Type": "JWT"}]`

```bash
# Confirm routes exist
aws apigatewayv2 get-routes \
  --api-id "$API_ID" \
  --region "$AWS_REGION" \
  --query "Items[].{Key:RouteKey,Auth:AuthorizationType}"
```
✅ Expected: `[{"Key": "GET /secure", "Auth": "JWT"}]` (plus any others you configured)

---

### 1c — Cognito User Pool

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --region "$AWS_REGION" \
  --query "UserPool.{Name:Name,Status:Status,MFA:MfaConfiguration}"
```
✅ Expected: `{"Name": "api-demo-dev-user-pool", "Status": "Active", "MFA": "OFF"}`

---

### 1d — CloudWatch Log Groups

```bash
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/api-demo-$ENV" \
  --region "$AWS_REGION" \
  --query "logGroups[].logGroupName"
```
✅ Expected: `["/aws/lambda/api-demo-dev-lambda"]`

```bash
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/apigateway/api-demo-$ENV" \
  --region "$AWS_REGION" \
  --query "logGroups[].logGroupName"
```
✅ Expected: `["/aws/apigateway/api-demo-dev"]`

---

### 1e — CloudWatch Alarms (5 expected)

```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix "api-demo-$ENV" \
  --region "$AWS_REGION" \
  --query "MetricAlarms[].{Name:AlarmName,State:StateValue}"
```
✅ Expected: 5 alarms, all in state `"OK"` or `"INSUFFICIENT_DATA"` (no data yet):
- `api-demo-dev-lambda-errors`
- `api-demo-dev-lambda-throttles`
- `api-demo-dev-lambda-duration-p95`
- `api-demo-dev-api-5xx`
- `api-demo-dev-api-4xx`

---

## Test 2 — Authentication (Cognito)

### 2a — Create a test user

```bash
TEST_EMAIL="tester@example.com"
TEMP_PASSWORD="Temporary1!"
PERM_PASSWORD="Permanent2@"

# Create user
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$TEST_EMAIL" \
  --temporary-password "$TEMP_PASSWORD" \
  --message-action SUPPRESS \
  --region "$AWS_REGION"
```
✅ Expected: `UserStatus: "FORCE_CHANGE_PASSWORD"`

```bash
# Set permanent password (skips the change-password challenge)
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$TEST_EMAIL" \
  --password "$PERM_PASSWORD" \
  --permanent \
  --region "$AWS_REGION"
```
✅ Expected: no output, exit code 0.

---

### 2b — Get an Access Token

```bash
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters USERNAME="$TEST_EMAIL",PASSWORD="$PERM_PASSWORD" \
  --region "$AWS_REGION" \
  --query "AuthenticationResult.AccessToken" \
  --output text)

echo "Token: ${TOKEN:0:50}..."    # first 50 chars only
echo "Token length: ${#TOKEN}"
```
✅ Expected: a long JWT string (usually 900–1200 characters).

```bash
# Decode the token header + payload (no secret needed — JWT is Base64)
echo "$TOKEN" | cut -d. -f1 | base64 -d 2>/dev/null | python3 -m json.tool
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
```
✅ Expected payload contains: `"token_use": "access"`, `"client_id"`, `"username"`, `"exp"` (future timestamp), `"iss"` matching your Cognito pool URL.

---

### 2c — Test token expiry (optional — advance system clock or wait)
Tokens expire in 1 hour (configured in Terraform). You can verify the `exp` claim:
```bash
EXP=$(echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['exp'])")
echo "Token expires at: $(date -r $EXP 2>/dev/null || date -d @$EXP)"
```

---

## Test 3 — API Security (Positive + Negative)

### 3a — ✅ Valid request (should succeed)

```bash
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -w "\n\nHTTP Status: %{http_code}\n" \
  "$SECURE_URL" | python3 -m json.tool
```
✅ Expected HTTP 200:
```json
{
  "message": "Access granted to secure endpoint",
  "user": {
    "sub": "a1b2c3d4-...",
    "email": "tester@example.com"
  },
  "environment": "dev",
  "requestId": "abc123",
  "timestamp": "2026-05-28T10:00:00.000Z"
}
```

---

### 3b — ❌ No token (should be rejected)

```bash
curl -s -w "\nHTTP Status: %{http_code}\n" "$SECURE_URL"
```
✅ Expected HTTP **401**: `{"message":"Unauthorized"}`

---

### 3c — ❌ Wrong / malformed token

```bash
curl -s \
  -H "Authorization: Bearer this.is.not.a.real.token" \
  -w "\nHTTP Status: %{http_code}\n" \
  "$SECURE_URL"
```
✅ Expected HTTP **401**: `{"message":"Unauthorized"}`

---

### 3d — ❌ Correct format but wrong audience (token from a different Cognito app client)

```bash
# Generate a token from the wrong client — use a fake client_id
curl -s \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ3cm9uZyIsImF1ZCI6Indyb25nLWNsaWVudCIsImlzcyI6Imh0dHBzOi8vY29nbml0by1pZHAuZXUtbm9ydGgtMS5hbWF6b25hd3MuY29tL3dyb25nIn0.signature" \
  -w "\nHTTP Status: %{http_code}\n" \
  "$SECURE_URL"
```
✅ Expected HTTP **401**: `{"message":"Unauthorized"}`

---

### 3e — ❌ Wrong HTTP method (route not defined)

```bash
curl -s \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -w "\nHTTP Status: %{http_code}\n" \
  "$SECURE_URL"
```
✅ Expected HTTP **404**: `{"message":"Not Found"}` — because only `GET /secure` is defined.

---

### 3f — ❌ Route that doesn't exist

```bash
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -w "\nHTTP Status: %{http_code}\n" \
  "${API_ENDPOINT}does-not-exist"
```
✅ Expected HTTP **404**: `{"message":"Not Found"}`

---

## Test 4 — Throttling

API Gateway throttle limits are set in the stage. In dev: burst=50, rate=25 req/s.

### 4a — Rapid-fire requests (manual throttle test)

```bash
# Send 60 requests as fast as possible — some should get throttled
for i in $(seq 1 60); do
  HTTP_CODE=$(curl -s \
    -H "Authorization: Bearer $TOKEN" \
    -o /dev/null \
    -w "%{http_code}" \
    "$SECURE_URL")
  echo "Request $i: $HTTP_CODE"
done
```
✅ Expected: mostly `200`, some `429 Too Many Requests` once burst is exceeded.

---

## Test 5 — Observability

### 5a — Confirm Lambda logs are appearing

After making a few requests (Test 3a), Lambda should have written to CloudWatch:

```bash
# Get the most recent log stream
LOG_STREAM=$(aws logs describe-log-streams \
  --log-group-name "/aws/lambda/$LAMBDA_NAME" \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  --region "$AWS_REGION" \
  --query "logStreams[0].logStreamName" \
  --output text)

echo "Latest log stream: $LOG_STREAM"

# Read the logs
aws logs get-log-events \
  --log-group-name "/aws/lambda/$LAMBDA_NAME" \
  --log-stream-name "$LOG_STREAM" \
  --region "$AWS_REGION" \
  --query "events[].message" \
  --output text
```
✅ Expected: JSON log lines showing `"Incoming event:"` and `"Response:"` from `index.js`.

---

### 5b — Confirm API Gateway access logs are appearing

```bash
LOG_STREAM=$(aws logs describe-log-streams \
  --log-group-name "/aws/apigateway/api-demo-$ENV" \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  --region "$AWS_REGION" \
  --query "logStreams[0].logStreamName" \
  --output text)

aws logs get-log-events \
  --log-group-name "/aws/apigateway/api-demo-$ENV" \
  --log-stream-name "$LOG_STREAM" \
  --region "$AWS_REGION" \
  --query "events[].message" \
  --output text
```
✅ Expected: access log entries for each request made in Test 3.

---

### 5c — Open the CloudWatch Dashboard

```bash
echo "Open this URL in your browser:"
echo "$DASHBOARD_URL"
```
✅ Expected: 6-widget dashboard showing:
- Lambda invocations, errors, duration (Avg / P95 / Max)
- API Gateway request count, 4xx/5xx errors, latency

---

### 5d — Confirm X-Ray traces exist

```bash
# Get traces from the last 5 minutes
END_TIME=$(date +%s)
START_TIME=$((END_TIME - 300))

aws xray get-trace-summaries \
  --start-time $START_TIME \
  --end-time $END_TIME \
  --region "$AWS_REGION" \
  --query "TraceSummaries[0].{Id:Id,Duration:Duration,Status:Http.HttpStatus}"
```
✅ Expected: at least one trace entry with `HttpStatus: 200` matching your test requests.

---

### 5e — Trigger an alarm (optional — to test SNS email)

Force an error in Lambda to trigger the error alarm:

```bash
# Invoke Lambda directly with a malformed event to cause an error
aws lambda invoke \
  --function-name "$LAMBDA_NAME" \
  --qualifier live \
  --payload '{"this_will_not_crash_the_handler": true}' \
  --region "$AWS_REGION" \
  /tmp/lambda_response.json

cat /tmp/lambda_response.json
```

For a real alarm trigger, invoke enough times with errors to breach the threshold, then check your inbox for the SNS email notification.

---

## Test 6 — Blue/Green (Lambda Versioning)

### 6a — Confirm published version exists

```bash
aws lambda list-versions-by-function \
  --function-name "$LAMBDA_NAME" \
  --region "$AWS_REGION" \
  --query "Versions[].{Version:Version,State:State,Modified:LastModified}"
```
✅ Expected: `$LATEST` plus at least one numbered version (e.g. `"1"`).

---

### 6b — Simulate a rollback

```bash
# What version is "live" currently pointing to?
CURRENT=$(aws lambda get-alias \
  --function-name "$LAMBDA_NAME" \
  --name live \
  --region "$AWS_REGION" \
  --query FunctionVersion \
  --output text)

echo "live → v$CURRENT"

# If there is a previous version, point "live" back to it
PREV=$((CURRENT - 1))
if [ "$PREV" -ge 1 ]; then
  aws lambda update-alias \
    --function-name "$LAMBDA_NAME" \
    --name live \
    --function-version "$PREV" \
    --region "$AWS_REGION"
  echo "Rolled back: live → v$PREV"

  # Test the API still works (now on the old version)
  curl -s -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n" "$SECURE_URL"

  # Roll forward again
  aws lambda update-alias \
    --function-name "$LAMBDA_NAME" \
    --name live \
    --function-version "$CURRENT" \
    --region "$AWS_REGION"
  echo "Rolled forward: live → v$CURRENT"
fi
```
✅ Expected: API responds 200 on both the old and new version — instant rollback with zero downtime.

---

## Test 7 — WAF (sit / stage / prod only)

WAF is disabled in `dev` (`enable_waf = false`). Run these tests against `sit`, `stage`, or `prod`.

```bash
ENV=sit
SECURE_URL=$(terraform -chdir=environments/$ENV output -raw secure_endpoint)
```

### 7a — Rate limiting

```bash
# Send 120 rapid requests — WAF blocks after the configured limit (1000/5min in sit)
# For faster results, test with a lower limit in tfvars during testing
BLOCKED=0
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN" \
    "$SECURE_URL")
  [ "$CODE" == "403" ] && BLOCKED=$((BLOCKED+1))
  echo "Request $i: $CODE"
done
echo "Blocked by WAF: $BLOCKED"
```
✅ Expected: 200s until rate limit exceeded, then 403s from WAF.

### 7b — SQL injection (blocked by AWS Managed CRS)

```bash
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -w "\nHTTP Status: %{http_code}\n" \
  "${SECURE_URL}?id=1'+OR+'1'='1"
```
✅ Expected: HTTP **403** — WAF blocks the SQLi attempt before it reaches API Gateway.

### 7c — XSS attempt (blocked by AWS Managed CRS)

```bash
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -w "\nHTTP Status: %{http_code}\n" \
  "${SECURE_URL}?q=<script>alert(1)</script>"
```
✅ Expected: HTTP **403** — WAF blocks the XSS payload.

---

## Test 8 — End-to-End Summary Checklist

Run this after all tests to confirm the overall health:

```bash
echo "========================================"
echo " End-to-End Health Check — $ENV"
echo "========================================"

check() {
  local label="$1"
  local result="$2"
  local expected="$3"
  if echo "$result" | grep -q "$expected"; then
    echo "✅ $label"
  else
    echo "❌ $label (got: $result)"
  fi
}

# 1. Lambda active
LAMBDA_STATE=$(aws lambda get-function --function-name "$LAMBDA_NAME" --region "$AWS_REGION" --query "Configuration.State" --output text 2>/dev/null)
check "Lambda is Active" "$LAMBDA_STATE" "Active"

# 2. live alias exists
ALIAS=$(aws lambda get-alias --function-name "$LAMBDA_NAME" --name live --region "$AWS_REGION" --query Name --output text 2>/dev/null)
check "live alias exists" "$ALIAS" "live"

# 3. no token → 401
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SECURE_URL")
check "No token → 401" "$CODE" "401"

# 4. valid token → 200
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$SECURE_URL")
check "Valid token → 200" "$CODE" "200"

# 5. Cognito pool exists
POOL=$(aws cognito-idp describe-user-pool --user-pool-id "$USER_POOL_ID" --region "$AWS_REGION" --query "UserPool.Status" --output text 2>/dev/null)
check "Cognito pool Active" "$POOL" "Active"

# 6. CloudWatch log group for Lambda
LG=$(aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/$LAMBDA_NAME" --region "$AWS_REGION" --query "logGroups[0].logGroupName" --output text 2>/dev/null)
check "Lambda log group exists" "$LG" "/aws/lambda/$LAMBDA_NAME"

echo "========================================"
```

---

## Troubleshooting Test Failures

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `curl` returns **403** on `/secure` | WAF is enabled (sit/stage/prod) and blocking your IP | Disable WAF temporarily: set `enable_waf = false` and redeploy |
| `curl` returns **401** even with a valid token | Token expired (1h TTL) or wrong `client_id` | Re-run Test 2b to get a fresh token |
| `curl` returns **500** | Lambda code error | Check CloudWatch logs (Test 5a) |
| `curl` returns **429** on first request | Throttle limits too low | Increase `throttling_burst_limit` in `terraform.tfvars` |
| Lambda log group is empty | Lambda was never invoked | Run Test 3a first, then re-check logs |
| X-Ray shows no traces | X-Ray sampling rate dropped them | Make 10+ requests and retry |
| Alarm email never arrived | SNS subscription not confirmed | Check your inbox for the AWS SNS confirmation email and click the link |
| `list-versions-by-function` only shows `$LATEST` | `publish = true` didn't trigger | Some config change must happen — redeploy after changing an env variable |

