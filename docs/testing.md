# Testing Guide

Run these tests after a successful `terraform apply`. Always get the current URL from Terraform outputs — the API endpoint changes when the API Gateway is recreated.

---

## Step 0 — Get Current Values

```bash
cd /path/to/api-gateway-terraform

API_ENDPOINT=$(terraform -chdir=environments/dev output -raw api_endpoint)
USER_POOL_ID=$(terraform -chdir=environments/dev output -raw cognito_user_pool_id)
CLIENT_ID=$(terraform -chdir=environments/dev output -raw cognito_client_id)
LAMBDA_NAME=$(terraform -chdir=environments/dev output -raw lambda_function_name)
```

Verify:
```bash
echo "API: $API_ENDPOINT"
echo "Pool: $USER_POOL_ID"
echo "Client: $CLIENT_ID"
```

---

## macOS Terminal Tip

> Always paste commands as **single lines**. Multi-line backslash commands cause `dquote>` errors. Press `Ctrl+C` to escape.

---

## Test 1 — Public Route (no auth)

```bash
curl -s -w "\nHTTP: %{http_code}\n" ${API_ENDPOINT}health
```

Expected — **HTTP: 200**:
```json
{
  "message": "Access granted",
  "authMethod": "none",
  "user": {},
  "environment": "dev"
}
```

This proves: Lambda is running, integration is working, API Gateway is reachable.

---

## Test 2 — JWT Auth Route (GET /secure)

### 2a — Create a test user (once only)

```bash
aws cognito-idp admin-create-user --user-pool-id $USER_POOL_ID --username test@example.com --temporary-password Temp1234! --message-action SUPPRESS --region eu-north-1
```

```bash
aws cognito-idp admin-set-user-password --user-pool-id $USER_POOL_ID --username test@example.com --password Perm5678@ --permanent --region eu-north-1
```

### 2b — Get an IdToken

```bash
TOKEN=$(aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id $CLIENT_ID --auth-parameters USERNAME=test@example.com,PASSWORD=Perm5678@ --region eu-north-1 --query AuthenticationResult.IdToken --output text)
echo "Token: ${TOKEN:0:60}..."
```

> ⚠️ Use `IdToken` not `AccessToken` — only `IdToken` contains the `email` claim.

Token is valid for **1 hour**.

### 2c — Call /secure with valid token → 200

```bash
curl -s -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n" ${API_ENDPOINT}secure
```

Expected:
```json
{
  "message": "Access granted",
  "authMethod": "jwt",
  "user": { "sub": "805c995c-...", "email": "test@example.com" },
  "environment": "dev"
}
```

### 2d — Call /secure with no token → 401

```bash
curl -s -w "\nHTTP: %{http_code}\n" ${API_ENDPOINT}secure
```

Expected: `{"message":"Unauthorized"}` `HTTP: 401`

### 2e — Call /secure with fake token → 401

```bash
curl -s -H "Authorization: Bearer fake.token.here" -w "\nHTTP: %{http_code}\n" ${API_ENDPOINT}secure
```

Expected: `{"message":"Unauthorized"}` `HTTP: 401`

---

## Test 3 — Custom Lambda Auth Route (GET /admin)

The `/admin` route uses a Lambda authorizer that validates `X-Api-Key` header.
The default key is `my-secret-key-123` (set via `authorizer_api_key` variable).

### 3a — Correct API key → 200

```bash
curl -s -H "X-Api-Key: my-secret-key-123" -w "\nHTTP: %{http_code}\n" ${API_ENDPOINT}admin
```

Expected:
```json
{
  "message": "Access granted",
  "authMethod": "custom",
  "user": { "authMethod": "api-key", "keyId": "my-secre..." },
  "environment": "dev"
}
```

### 3b — Wrong API key → 403

```bash
curl -s -H "X-Api-Key: wrongkey" -w "\nHTTP: %{http_code}\n" ${API_ENDPOINT}admin
```

Expected: `{"message":"Forbidden"}` `HTTP: 403`

### 3c — No API key → 401

```bash
curl -s -w "\nHTTP: %{http_code}\n" ${API_ENDPOINT}admin
```

Expected: `{"message":"Unauthorized"}` `HTTP: 401`
(API Gateway rejects before calling the authorizer Lambda — identity source missing)

---

## Test 4 — Full Matrix

Run all routes at once:

```bash
echo "=== /health (public — expect 200) ===" && curl -s -w "HTTP: %{http_code}\n" ${API_ENDPOINT}health
echo "=== /secure valid JWT (expect 200) ===" && curl -s -H "Authorization: Bearer $TOKEN" -w "HTTP: %{http_code}\n" ${API_ENDPOINT}secure
echo "=== /secure no token (expect 401) ===" && curl -s -w "HTTP: %{http_code}\n" ${API_ENDPOINT}secure
echo "=== /admin correct key (expect 200) ===" && curl -s -H "X-Api-Key: my-secret-key-123" -w "HTTP: %{http_code}\n" ${API_ENDPOINT}admin
echo "=== /admin wrong key (expect 403) ===" && curl -s -H "X-Api-Key: wrong" -w "HTTP: %{http_code}\n" ${API_ENDPOINT}admin
echo "=== /admin no key (expect 401) ===" && curl -s -w "HTTP: %{http_code}\n" ${API_ENDPOINT}admin
```

---

## Test 5 — CloudWatch Logs

### Main Lambda logs

```bash
aws logs filter-log-events --log-group-name /aws/lambda/api-demo-dev-lambda --region eu-north-1 --start-time $(($(date +%s) - 300))000 --query "events[*].message" --output text
```

Look for `[HANDLER]` prefixed lines showing auth method, user info, and response.

### Authorizer Lambda logs

```bash
aws logs filter-log-events --log-group-name /aws/lambda/api-demo-dev-lambda-authorizer --region eu-north-1 --start-time $(($(date +%s) - 300))000 --query "events[*].message" --output text
```

Look for `[AUTHORIZER]` prefixed lines showing key validation decisions.

### API Gateway access logs

```bash
aws logs filter-log-events --log-group-name /aws/apigateway/api-demo-dev --region eu-north-1 --start-time $(($(date +%s) - 300))000 --query "events[*].message" --output text
```

---

## Test 6 — Infrastructure Checks (AWS CLI)

### Main Lambda active

```bash
aws lambda get-function --function-name api-demo-dev-lambda --region eu-north-1 --query "Configuration.[FunctionName,State,Runtime,Handler]" --output text
```

Expected: `api-demo-dev-lambda   Active   nodejs18.x   index.handler`

### Authorizer Lambda active

```bash
aws lambda get-function --function-name api-demo-dev-lambda-authorizer --region eu-north-1 --query "Configuration.[FunctionName,State,Runtime,Handler]" --output text
```

Expected: `api-demo-dev-lambda-authorizer   Active   nodejs18.x   authorizer.handler`

### Live alias version

```bash
aws lambda get-alias --function-name api-demo-dev-lambda --name live --region eu-north-1 --query "[Name,FunctionVersion]" --output text
```

### API Gateway routes

```bash
API_ID=$(aws apigatewayv2 get-apis --region eu-north-1 --query "Items[?contains(Name,'api-demo-dev')].ApiId" --output text)
aws apigatewayv2 get-routes --api-id $API_ID --region eu-north-1 --query "Items[*].{Route:RouteKey,Auth:AuthorizationType}"
```

Expected: 3 routes — `GET /secure` (JWT), `GET /admin` (CUSTOM), `GET /health` (NONE)

### Authorizer configuration

```bash
aws apigatewayv2 get-authorizers --api-id $API_ID --region eu-north-1 --query "Items[*].{Name:Name,Type:AuthorizerType,SimpleResponses:EnableSimpleResponses}"
```

Expected: Lambda authorizer with `EnableSimpleResponses: true`

### CloudWatch alarms

```bash
aws cloudwatch describe-alarms --alarm-name-prefix api-demo-dev --region eu-north-1 --query "MetricAlarms[].{Name:AlarmName,State:StateValue}"
```

Expected: 5 alarms in `OK` or `INSUFFICIENT_DATA`:
- `api-demo-dev-lambda-errors`
- `api-demo-dev-lambda-throttles`
- `api-demo-dev-lambda-duration-p95`
- `api-demo-dev-api-5xx`
- `api-demo-dev-api-4xx`

---

## Test 7 — X-Ray Traces

```bash
END=$(date +%s)
START=$((END - 300))
aws xray get-trace-summaries --start-time $START --end-time $END --region eu-north-1 --query "TraceSummaries[0].{Id:Id,Duration:Duration,Status:Http.HttpStatus}"
```

---

## Test 8 — Blue/Green Rollback

```bash
# Check current version
aws lambda get-alias --function-name api-demo-dev-lambda --name live --region eu-north-1 --query FunctionVersion --output text

# Roll back to previous version
aws lambda update-alias --function-name api-demo-dev-lambda --name live --function-version <N-1> --region eu-north-1

# Test rollback worked
curl -s -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n" ${API_ENDPOINT}secure

# Roll forward again
aws lambda update-alias --function-name api-demo-dev-lambda --name live --function-version <N> --region eu-north-1
```

---

## Test 9 — Throttling

```bash
for i in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" ${API_ENDPOINT}secure)
  echo "Request $i: $CODE"
done
```

Expected: mostly `200`, some `429` once burst limit (50 in dev) is exceeded.

---

## Test 10 — WAF (sit/stage/prod only)

WAF is **disabled in dev**. Deploy sit first, then:

```bash
SIT_URL=$(terraform -chdir=environments/sit output -raw api_endpoint)
SIT_TOKEN=$(aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id $(terraform -chdir=environments/sit output -raw cognito_client_id) --auth-parameters USERNAME=test@example.com,PASSWORD=Perm5678@ --region eu-north-1 --query AuthenticationResult.IdToken --output text)

curl -s -H "Authorization: Bearer $SIT_TOKEN" -w "\nHTTP: %{http_code}\n" "${SIT_URL}secure?id=1+OR+1=1"
```

Expected: `HTTP: 403` (WAF blocks SQL injection)

---

## Postman Setup

### Environment variables

| Variable | Value |
|---|---|
| `api_url` | value of `terraform output api_endpoint` |
| `cognito_url` | `https://cognito-idp.eu-north-1.amazonaws.com/` |
| `client_id` | value of `terraform output cognito_client_id` |
| `token` | (auto-filled by test script) |
| `api_key` | `my-secret-key-123` |

### Request 1 — Get IdToken (POST)

**POST** `{{cognito_url}}`

| Header | Value |
|---|---|
| `Content-Type` | `application/x-amz-json-1.1` |
| `X-Amz-Target` | `AWSCognitoIdentityProviderService.InitiateAuth` |

Body:
```json
{
  "AuthFlow": "USER_PASSWORD_AUTH",
  "ClientId": "{{client_id}}",
  "AuthParameters": { "USERNAME": "test@example.com", "PASSWORD": "Perm5678@" }
}
```

Tests tab (auto-saves token):
```javascript
const res = pm.response.json();
pm.environment.set("token", res.AuthenticationResult.IdToken);
```

### Request 2 — GET /secure (JWT)

**GET** `{{api_url}}secure`

| Header | Value |
|---|---|
| `Authorization` | `Bearer {{token}}` |

### Request 3 — GET /admin (Custom auth)

**GET** `{{api_url}}admin`

| Header | Value |
|---|---|
| `X-Api-Key` | `{{api_key}}` |

### Request 4 — GET /health (Public)

**GET** `{{api_url}}health`

No headers needed.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `401` with valid token | Token expired (1h) or using AccessToken | Re-run `initiate-auth`, use `IdToken` not `AccessToken` |
| `403` on /admin with correct key | Wrong API key value | Check `authorizer_api_key` variable in Terraform |
| `500` on /admin | `enable_simple_responses` not set | Verify `enable_simple_responses = true` in Terraform authorizer resource |
| `403` on /secure from WAF | WAF blocking (sit/stage/prod) | Set `enable_waf = false`, redeploy |
| `429` immediately | Throttle limit exceeded | Increase `throttling_burst_limit` in variables |
| `dquote>` in terminal | Unclosed quote from paste | Press `Ctrl+C`, paste as single line |
| `000` HTTP status | Wrong API URL (old endpoint) | Run `terraform output api_endpoint` for current URL |
| No main Lambda logs | Authorizer blocking before Lambda | Check authorizer logs first |
| Alarm email not received | SNS not confirmed | Check inbox for AWS SNS confirmation email |
