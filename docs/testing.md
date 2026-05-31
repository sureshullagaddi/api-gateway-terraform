# Testing Guide

Run these tests after a successful `terraform apply`. All values below match the **dev** environment.

---

## Quick Reference — Dev Values

```
API_ENDPOINT = https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/
SECURE_URL   = https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/secure
USER_POOL_ID = eu-north-1_u3Duhelrw
CLIENT_ID    = 59sg1etok9amjiq0vhi6h5bosj
LAMBDA_NAME  = api-demo-dev-lambda
REGION       = eu-north-1
```

---

## Before You Start — Export Variables

```bash
ENV=dev

API_ENDPOINT=$(terraform -chdir=environments/$ENV output -raw api_endpoint)
SECURE_URL=$(terraform -chdir=environments/$ENV output -raw secure_endpoint)
USER_POOL_ID=$(terraform -chdir=environments/$ENV output -raw cognito_user_pool_id)
CLIENT_ID=$(terraform -chdir=environments/$ENV output -raw cognito_client_id)
LAMBDA_NAME=$(terraform -chdir=environments/$ENV output -raw lambda_function_name)
DASHBOARD_URL=$(terraform -chdir=environments/$ENV output -raw dashboard_url)
AWS_REGION=eu-north-1
```

---

## macOS Terminal Tips

> **Avoid `dquote>` errors** — always paste commands as **single lines** with no backslash continuations.
> If you see `dquote>`, press `Ctrl+C` to cancel and paste the command as one line.

---

## Test 1 — Create a Test User (once only)

```bash
aws cognito-idp admin-create-user --user-pool-id eu-north-1_u3Duhelrw --username test@example.com --temporary-password Temp1234! --message-action SUPPRESS --region eu-north-1
```

```bash
aws cognito-idp admin-set-user-password --user-pool-id eu-north-1_u3Duhelrw --username test@example.com --password Perm5678@ --permanent --region eu-north-1
```

---

## Test 2 — Get an Access Token

```bash
TOKEN=$(aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id 59sg1etok9amjiq0vhi6h5bosj --auth-parameters USERNAME=test@example.com,PASSWORD=Perm5678@ --region eu-north-1 --query AuthenticationResult.AccessToken --output text)

echo "Token: ${TOKEN:0:60}..."
```

Token is valid for **1 hour**. Re-run this command when it expires.

---

## Test 3 — API Security Tests

### 3a — Valid token (expect 200)

```bash
curl -s -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n" https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/secure
```

Expected:
```json
{
  "message": "Access granted to secure endpoint",
  "user": { "sub": "...", "email": "test@example.com" },
  "environment": "dev",
  "requestId": "...",
  "timestamp": "2026-05-31T..."
}
HTTP: 200
```

---

### 3b — No token (expect 401)

```bash
curl -s -w "\nHTTP: %{http_code}\n" https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/secure
```

Expected: `{"message":"Unauthorized"}` `HTTP: 401`

---

### 3c — Fake token (expect 401)

```bash
curl -s -H "Authorization: Bearer fake.token.here" -w "\nHTTP: %{http_code}\n" https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/secure
```

Expected: `{"message":"Unauthorized"}` `HTTP: 401`

---

### 3d — Wrong route (expect 404)

```bash
curl -s -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n" https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/does-not-exist
```

Expected: `{"message":"Not Found"}` `HTTP: 404`

---

### 3e — Wrong method (expect 404)

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n" https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/secure
```

Expected: `{"message":"Not Found"}` `HTTP: 404` (only GET /secure is defined)

---

## Test 4 — Infrastructure Checks (AWS CLI)

### Lambda active

```bash
aws lambda get-function --function-name api-demo-dev-lambda --region eu-north-1 --query "Configuration.[FunctionName,State,Runtime,Handler]" --output text
```

Expected: `api-demo-dev-lambda   Active   nodejs18.x   index.handler`

### Live alias exists

```bash
aws lambda get-alias --function-name api-demo-dev-lambda --name live --region eu-north-1 --query "[Name,FunctionVersion]" --output text
```

Expected: `live   4`

### API Gateway JWT authorizer

```bash
API_ID=$(aws apigatewayv2 get-apis --region eu-north-1 --query "Items[?contains(Name,'api-demo-dev')].ApiId" --output text)
aws apigatewayv2 get-authorizers --api-id $API_ID --region eu-north-1 --query "Items[].{Name:Name,Type:AuthorizerType}"
```

Expected: JWT authorizer named `api-demo-dev-api-cognito-jwt`

### CloudWatch alarms (5 expected)

```bash
aws cloudwatch describe-alarms --alarm-name-prefix api-demo-dev --region eu-north-1 --query "MetricAlarms[].{Name:AlarmName,State:StateValue}"
```

Expected: 5 alarms in `OK` or `INSUFFICIENT_DATA` state:
- `api-demo-dev-lambda-errors`
- `api-demo-dev-lambda-throttles`
- `api-demo-dev-lambda-duration-p95`
- `api-demo-dev-api-5xx`
- `api-demo-dev-api-4xx`

---

## Test 5 — Throttling (dev: burst=50, rate=25/s)

```bash
for i in $(seq 1 60); do
  CODE=$(curl -s -H "Authorization: Bearer $TOKEN" -o /dev/null -w "%{http_code}" https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/secure)
  echo "Request $i: $CODE"
done
```

Expected: mostly `200`, some `429` once burst limit exceeded.

---

## Test 6 — CloudWatch Logs

Run Test 3a a few times, then check Lambda logs:

```bash
LOG_STREAM=$(aws logs describe-log-streams --log-group-name /aws/lambda/api-demo-dev-lambda --order-by LastEventTime --descending --max-items 1 --region eu-north-1 --query "logStreams[0].logStreamName" --output text)

aws logs get-log-events --log-group-name /aws/lambda/api-demo-dev-lambda --log-stream-name "$LOG_STREAM" --region eu-north-1 --query "events[].message" --output text
```

Expected: JSON lines showing `Incoming event:` and `Response:` from `index.js`.

---

## Test 7 — X-Ray Traces

```bash
END=$(date +%s)
START=$((END - 300))
aws xray get-trace-summaries --start-time $START --end-time $END --region eu-north-1 --query "TraceSummaries[0].{Id:Id,Duration:Duration,Status:Http.HttpStatus}"
```

Expected: trace entry with `HttpStatus: 200`.

---

## Test 8 — Blue/Green Rollback

### Check current version

```bash
aws lambda get-alias --function-name api-demo-dev-lambda --name live --region eu-north-1 --query FunctionVersion --output text
```

### Roll back to previous version (if version > 1)

```bash
aws lambda update-alias --function-name api-demo-dev-lambda --name live --function-version 3 --region eu-north-1
curl -s -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n" https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/secure
```

### Roll forward

```bash
aws lambda update-alias --function-name api-demo-dev-lambda --name live --function-version 4 --region eu-north-1
```

---

## Test 9 — WAF (sit / stage / prod only)

WAF is **disabled in dev** (`enable_waf = false`). Test against sit, stage, or prod.

After deploying sit:
```bash
SIT_URL=$(terraform -chdir=environments/sit output -raw secure_endpoint)
```

SQL injection (expect 403):
```bash
curl -s -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n" "$SIT_URL?id=1+OR+1=1"
```

XSS (expect 403):
```bash
curl -s -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n" "$SIT_URL?q=scriptalert1script"
```

---

## Test 10 — End-to-End Health Check Script

Run this after all tests:

```bash
echo "========================================"
echo " Health Check — dev"
echo "========================================"

LAMBDA_STATE=$(aws lambda get-function --function-name api-demo-dev-lambda --region eu-north-1 --query "Configuration.State" --output text 2>/dev/null)
[ "$LAMBDA_STATE" = "Active" ] && echo "PASS Lambda Active" || echo "FAIL Lambda state: $LAMBDA_STATE"

ALIAS=$(aws lambda get-alias --function-name api-demo-dev-lambda --name live --region eu-north-1 --query Name --output text 2>/dev/null)
[ "$ALIAS" = "live" ] && echo "PASS live alias exists" || echo "FAIL alias: $ALIAS"

CODE=$(curl -s -o /dev/null -w "%{http_code}" https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/secure)
[ "$CODE" = "401" ] && echo "PASS No token returns 401" || echo "FAIL got $CODE"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/secure)
[ "$CODE" = "200" ] && echo "PASS Valid token returns 200" || echo "FAIL got $CODE"

echo "========================================"
```

---

## Postman Setup

### Step 1 — Get token in Postman

**POST** `https://cognito-idp.eu-north-1.amazonaws.com/`

| Header | Value |
|--------|-------|
| `Content-Type` | `application/x-amz-json-1.1` |
| `X-Amz-Target` | `AmazonCognitoIdentityProviderService.InitiateAuth` |

Body (raw JSON):
```json
{
  "AuthFlow": "USER_PASSWORD_AUTH",
  "ClientId": "59sg1etok9amjiq0vhi6h5bosj",
  "AuthParameters": {
    "USERNAME": "test@example.com",
    "PASSWORD": "Perm5678@"
  }
}
```

Post-response script (Scripts tab) to auto-save token:
```javascript
const token = pm.response.json().AuthenticationResult.AccessToken;
pm.environment.set("token", token);
```

### Step 2 — Call the API

**GET** `https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/secure`

| Header | Value |
|--------|-------|
| `Authorization` | `Bearer {{token}}` |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `401` with valid token | Token expired (1h) | Re-run `initiate-auth` |
| `403` on /secure | WAF blocking (sit/stage/prod) | Set `enable_waf = false`, redeploy |
| `429` immediately | Throttle limit too low | Increase `throttling_burst_limit` in tfvars |
| `500` from Lambda | Lambda code error | Check CloudWatch logs (Test 6) |
| `dquote>` in terminal | Unclosed quote | Press `Ctrl+C`, paste as single line |
| Alarm email not received | SNS not confirmed | Check inbox for AWS SNS confirmation email and click the link |
| X-Ray shows no traces | Sampling | Make 10+ requests and retry |

