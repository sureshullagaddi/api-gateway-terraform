# GUI Testing Plan — All Auth Types

> **Scope:** End-to-end and functional testing of the API Gateway Web GUI covering all five authentication types, form validation, API lifecycle (create → view → delete), status transitions, and error handling.

---

## 1. Test Environment Setup

| Item | Value |
|------|-------|
| Frontend URL | `http://localhost:5173` (local dev) or CloudFront URL |
| Backend URL | `http://localhost:3000` (local dev) or Lambda Function URL |
| AWS Region | As configured in `.env` / `window.__CONFIG__` |
| Required env vars | `EXISTING_COGNITO_POOL_ID`, `EXISTING_COGNITO_CLIENT_ID`, `EXISTING_AUTHORIZER_FUNCTION_NAME`, `EXISTING_AUTHORIZER_LAMBDA_ARN`, `EXISTING_LAMBDA_ARN`, `EXISTING_LAMBDA_FUNCTION_NAME` |

### Pre-conditions
- [ ] Backend Lambda (or local server) is running and reachable
- [ ] DynamoDB table exists and is accessible
- [ ] All `EXISTING_*` env vars point to real AWS resources
- [ ] AWS credentials have `apigateway:*`, `lambda:AddPermission`, `lambda:RemovePermission`, `cognito-idp:*`, `execute-api:*` permissions

---

## 2. GUI Common / Shared Tests

These tests apply to ALL auth types.

### 2.1 Form Validation — API Name

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| F-01 | Empty API name | Submit form with blank API Name | ❌ Browser/HTML5 required validation blocks submit |
| F-02 | Too short (< 4 chars) | Enter `abc`, submit | ❌ Pattern validation fails — "Lowercase letters, numbers, hyphens (4-30 chars)" |
| F-03 | Starts with number | Enter `1api`, submit | ❌ Pattern `[a-z][a-z0-9\-]{2,28}[a-z0-9]` rejects |
| F-04 | Uppercase letters | Enter `MyApi`, submit | ❌ Pattern rejects uppercase |
| F-05 | Special characters | Enter `api_test!`, submit | ❌ Only `a-z`, `0-9`, `-` allowed |
| F-06 | Valid name | Enter `payments-v2`, submit | ✅ Passes validation |
| F-07 | 30-char max | Enter 31-char name like `this-api-name-is-way-too-long-x`, submit | ❌ Pattern max length exceeded |
| F-08 | Duplicate API name | Create `test-api`, then create again with same name | ❌ 409 error: "API 'test-api' already exists" |

### 2.2 Form Validation — Common Fields

| # | Test Case | Expected Result |
|---|-----------|-----------------|
| F-09 | No API Type selected | ❌ Required dropdown blocks submit |
| F-10 | No HTTP Method selected | ❌ Required dropdown — default is `GET`, can't be blank |
| F-11 | Route path without `/` prefix | Backend returns 400: "route_path must start with /" |
| F-12 | Invalid environment | Not possible via UI (locked dropdown) |

### 2.3 API Lifecycle — Status Transitions

```
[Create] → CREATING → ACTIVE
                    → FAILED (provisioning error)

[Delete ACTIVE]  → DELETING → (removed from list)
                            → DELETE_FAILED (destroy error)

[Force Clear DELETE_FAILED/FAILED] → (removed from registry)
```

| # | Test Case | Expected Result |
|---|-----------|-----------------|
| L-01 | Create API → card shows CREATING badge | Yellow "CREATING" badge visible immediately after submit |
| L-02 | Create succeeds → card shows ACTIVE badge | Green "ACTIVE" badge, route URL shown |
| L-03 | Delete ACTIVE API | Button triggers confirm → card transitions to DELETING (orange) → disappears |
| L-04 | Delete CREATING API | Delete button disabled (grey/50% opacity) |
| L-05 | Force Clear shown for FAILED/DELETE_FAILED | 🧹 Force Clear button appears only on stuck records |
| L-06 | Force Clear removes record | Card disappears; backend 200 with "force-cleared" message |

### 2.4 API Detail Modal

| # | Test Case | Expected Result |
|---|-----------|-----------------|
| D-01 | Click "Details" on any card | Modal opens with: api_type, status, environment, method+path |
| D-02 | Endpoint URL shown | `route_url` displayed in code block, copyable |
| D-03 | Test hint shown | Blue "How to test" box with auth-specific instructions |
| D-04 | Partner shown for REST | "Partner" row appears only for `rest-usage-plan` type |
| D-05 | Click backdrop to close | Modal closes |
| D-06 | Click ✕ to close | Modal closes |
| D-07 | Timestamps shown | "Created:" and "Updated:" displayed at bottom |

### 2.5 Toast Notifications

| # | Test Case | Expected Result |
|---|-----------|-----------------|
| T-01 | Successful create | Green success toast: "API 'xxx' created successfully" |
| T-02 | Successful delete | Green success toast: "API deleted successfully" |
| T-03 | Validation error from backend | Red error toast with error message |
| T-04 | Network error (backend unreachable) | Red error toast: "Request failed" |
| T-05 | Toast auto-dismisses | Toast disappears after ~4 seconds |

---

## 3. Auth Type 1 — HTTP Public (No Auth)

> **Use case:** Public endpoint — no authentication, anyone can call it.  
> **AWS:** HTTP API v2, `AuthorizationType: NONE`

### 3.1 Create via GUI

| # | Test Case | Input | Expected Result |
|---|-----------|-------|-----------------|
| P-01 | Create public API — minimal | Name: `public-test`, Type: `HTTP Public`, Method: `GET`, Path: `/health`, Env: `dev` | ✅ 201 Created; ACTIVE card; route URL shown |
| P-02 | Create with POST method | Method: `POST`, Path: `/submit` | ✅ Route `POST /submit` created |
| P-03 | Create with nested path | Path: `/payments/status` | ✅ Route `GET /payments/status` works |
| P-04 | No auth description shown | Select "HTTP Public" in dropdown | Hint text: "No authentication — anyone can call this endpoint" |
| P-05 | No extra fields | Select "HTTP Public" | No partner/quota fields appear (REST-only section hidden) |

### 3.2 Endpoint Testing (curl)

```bash
# Get route_url from the Details modal, then:
curl -i https://<api-id>.execute-api.<region>.amazonaws.com/<stage><route>

# ✅ Expected: 200 OK with Lambda response body
# ❌ No 401/403 — this is public
```

| # | Test Case | Expected |
|---|-----------|----------|
| P-06 | Call endpoint with NO headers | ✅ 200 OK |
| P-07 | Call endpoint with random Authorization header | ✅ 200 OK (ignored) |
| P-08 | Call endpoint with wrong method (e.g., DELETE on GET route) | ❌ 405 Method Not Allowed |
| P-09 | Call non-existent path | ❌ 404 Not Found |

### 3.3 Delete

| # | Test Case | Expected |
|---|-----------|----------|
| P-10 | Delete public API | ✅ API GW + log group deleted; card removed |
| P-11 | Call endpoint after delete | ❌ 403 or DNS resolution fails |

---

## 4. Auth Type 2 — HTTP JWT (Cognito Token)

> **Use case:** Customer portal — Cognito-authenticated users.  
> **AWS:** HTTP API v2, JWT Authorizer pointing to existing Cognito User Pool.

### 4.1 Pre-conditions
- [ ] Cognito User Pool ID and Client ID configured in env vars
- [ ] At least one test user exists in the User Pool
- [ ] Test user can obtain an IdToken

### 4.2 Create via GUI

| # | Test Case | Input | Expected Result |
|---|-----------|-------|-----------------|
| J-01 | Create JWT API | Name: `jwt-test`, Type: `HTTP JWT`, Method: `GET`, Path: `/profile` | ✅ 201 Created; ACTIVE |
| J-02 | Auth description shown | Select "HTTP JWT" | Hint: "Cognito IdToken required — reuses existing User Pool" |
| J-03 | Test hint in detail modal | Open Details for JWT API | "Get an IdToken from Cognito and send as: Authorization: Bearer \<IdToken\>" |

### 4.3 Obtain Cognito Token

```bash
# Method A — AWS CLI
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=testuser@example.com,PASSWORD=TestPass123! \
  --client-id <EXISTING_COGNITO_CLIENT_ID>
# Copy IdToken from response

# Method B — AWS Console → Cognito → User Pool → App clients → Hosted UI
```

### 4.4 Endpoint Testing

```bash
TOKEN="<IdToken from above>"
ROUTE_URL="<from Details modal>"

# ✅ Valid Cognito IdToken
curl -i -H "Authorization: Bearer $TOKEN" $ROUTE_URL
# Expected: 200 OK

# ❌ No token
curl -i $ROUTE_URL
# Expected: 401 Unauthorized

# ❌ Wrong/expired token
curl -i -H "Authorization: Bearer invalid.token.here" $ROUTE_URL
# Expected: 401 Unauthorized

# ❌ Wrong prefix (not "Bearer")
curl -i -H "Authorization: $TOKEN" $ROUTE_URL
# Expected: 401 Unauthorized

# ❌ Token from a different Cognito pool
curl -i -H "Authorization: Bearer <foreign-token>" $ROUTE_URL
# Expected: 401 Unauthorized
```

| # | Test Case | Expected |
|---|-----------|----------|
| J-04 | Valid Cognito IdToken | ✅ 200 OK |
| J-05 | No Authorization header | ❌ 401 Unauthorized |
| J-06 | Invalid/garbage token | ❌ 401 Unauthorized |
| J-07 | Expired token (wait for exp) | ❌ 401 Unauthorized |
| J-08 | Token from different pool | ❌ 401 Unauthorized |
| J-09 | AccessToken instead of IdToken | ❌ 401 (Audience mismatch) |

### 4.5 Delete

| # | Test Case | Expected |
|---|-----------|----------|
| J-10 | Delete JWT API | ✅ API GW deleted; Cognito pool NOT deleted (shared resource) |
| J-11 | Call endpoint after delete | ❌ 403 or unreachable |

---

## 5. Auth Type 3 — HTTP Custom Key (X-Api-Key Lambda Authorizer)

> **Use case:** B2B partner integration — validates X-Api-Key header via existing Lambda authorizer.  
> **AWS:** HTTP API v2, REQUEST-type Lambda authorizer, `EnableSimpleResponses: true` (returns `{isAuthorized: true/false}`).

### 5.1 Pre-conditions
- [ ] `EXISTING_AUTHORIZER_FUNCTION_NAME` and `EXISTING_AUTHORIZER_LAMBDA_ARN` point to live Lambda
- [ ] Lambda authorizer logic: reads `X-Api-Key` header, returns `{ isAuthorized: true }` for known keys
- [ ] You know at least one valid key the Lambda accepts

### 5.2 Create via GUI

| # | Test Case | Input | Expected Result |
|---|-----------|-------|-----------------|
| K-01 | Create custom-key API | Name: `custom-key-test`, Type: `HTTP Custom Key`, Method: `GET`, Path: `/partner-data` | ✅ 201 Created; ACTIVE |
| K-02 | Auth description shown | Select "HTTP Custom Key" | Hint: "X-Api-Key header validated by the existing Lambda authorizer" |
| K-03 | Test hint in modal | Open Details | "Send header: X-Api-Key: my-secret-key-123" |
| K-04 | Lambda permission created | Check AWS Console → Lambda → Resource Policy | `AllowAuthorizerAPIGW-<name>-<env>` statement present |

### 5.3 Endpoint Testing

```bash
ROUTE_URL="<from Details modal>"
VALID_KEY="my-secret-key-123"   # whatever your Lambda authorizer accepts

# ✅ Valid API key
curl -i -H "X-Api-Key: $VALID_KEY" $ROUTE_URL
# Expected: 200 OK

# ❌ Missing X-Api-Key header
curl -i $ROUTE_URL
# Expected: 401 Unauthorized (Lambda returns isAuthorized: false)

# ❌ Wrong API key
curl -i -H "X-Api-Key: wrong-key-xyz" $ROUTE_URL
# Expected: 403 Forbidden

# ❌ Key in Authorization header instead of X-Api-Key
curl -i -H "Authorization: Bearer $VALID_KEY" $ROUTE_URL
# Expected: 401 (identity source not found)

# ✅ Key caching — call twice rapidly with valid key
curl -i -H "X-Api-Key: $VALID_KEY" $ROUTE_URL  # invoke Lambda
curl -i -H "X-Api-Key: $VALID_KEY" $ROUTE_URL  # should be served from 5-min TTL cache
```

| # | Test Case | Expected |
|---|-----------|----------|
| K-05 | Valid X-Api-Key header | ✅ 200 OK |
| K-06 | Missing X-Api-Key header | ❌ 401 Unauthorized |
| K-07 | Invalid/unknown key | ❌ 403 Forbidden |
| K-08 | Key in wrong header | ❌ 401 Unauthorized |
| K-09 | Authorizer cache (TTL=300s) | ✅ 200 OK — no Lambda invocation for repeated valid key |
| K-10 | Authorizer cache after key revoke (within TTL) | ⚠️ May still return 200 (cached) — expected behavior |

### 5.4 Delete

| # | Test Case | Expected |
|---|-----------|----------|
| K-11 | Delete custom-key API | ✅ Lambda permission `AllowAuthorizerAPIGW-*` removed; API GW deleted |
| K-12 | Lambda resource policy after delete | Statement `AllowAuthorizerAPIGW-<name>-<env>` no longer present |

---

## 6. Auth Type 4 — HTTP IAM (AWS SigV4)

> **Use case:** Internal service-to-service — only AWS services/roles with `execute-api:Invoke` permission can call.  
> **AWS:** HTTP API v2, `AuthorizationType: AWS_IAM`, caller must sign with SigV4.

### 6.1 Pre-conditions
- [ ] Test IAM role/user has `execute-api:Invoke` on the API ARN (or `*`)
- [ ] AWS credentials configured locally (for curl signing)
- [ ] Install `awscurl` or use AWS SDK for signing: `pip install awscurl`

### 6.2 Create via GUI

| # | Test Case | Input | Expected Result |
|---|-----------|-------|-----------------|
| I-01 | Create IAM API | Name: `iam-svc-test`, Type: `HTTP IAM`, Method: `POST`, Path: `/internal/sync` | ✅ 201 Created; ACTIVE |
| I-02 | Auth description shown | Select "HTTP IAM" | Hint: "AWS SigV4 signing required — for internal AWS services only" |
| I-03 | Test hint in modal | Open Details | "Sign requests with AWS SDK SignatureV4 (service: execute-api). Caller's IAM role must have execute-api:Invoke permission." |

### 6.3 Endpoint Testing

```bash
ROUTE_URL="<from Details modal>"
REGION="<aws-region>"

# ✅ Signed request using awscurl
awscurl --service execute-api --region $REGION \
  -X GET $ROUTE_URL
# Expected: 200 OK

# ❌ Unsigned request (plain curl)
curl -i $ROUTE_URL
# Expected: 403 Forbidden — {"message":"Missing Authentication Token"}

# ❌ SigV4 with wrong service name
awscurl --service s3 --region $REGION -X GET $ROUTE_URL
# Expected: 403 Forbidden — signature mismatch

# ❌ SigV4 with wrong region
awscurl --service execute-api --region us-west-2 -X GET $ROUTE_URL
# Expected: 403 Forbidden — region mismatch

# ✅ Using AWS SDK (Node.js example)
node -e "
const { SignatureV4 } = require('@aws-sdk/signature-v4');
const { HttpRequest } = require('@aws-sdk/protocol-http');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { Sha256 } = require('@aws-crypto/sha256-js');
const https = require('https');
// ... sign and send request
"
```

| # | Test Case | Expected |
|---|-----------|----------|
| I-04 | Signed request (awscurl / SDK) | ✅ 200 OK |
| I-05 | Unsigned plain curl | ❌ 403 {"message":"Missing Authentication Token"} |
| I-06 | Wrong service in SigV4 (`s3` instead of `execute-api`) | ❌ 403 Forbidden |
| I-07 | Wrong region in SigV4 | ❌ 403 Forbidden |
| I-08 | Expired SigV4 credentials (clock skew > 5 min) | ❌ 403 Forbidden |
| I-09 | IAM role WITHOUT `execute-api:Invoke` | ❌ 403 Forbidden |
| I-10 | IAM role WITH `execute-api:Invoke` on specific API ARN | ✅ 200 OK |

### 6.4 Delete

| # | Test Case | Expected |
|---|-----------|----------|
| I-11 | Delete IAM API | ✅ API GW + log group deleted |
| I-12 | Call endpoint after delete | ❌ 403 or unreachable |

---

## 7. Auth Type 5 — REST Usage Plan (Per-Partner Quota)

> **Use case:** B2B rate-limited access — per-partner daily quota enforced natively by AWS API Gateway REST v1.  
> **AWS:** REST API v1, usage plan, API key, Lambda proxy integration, stage deployment.

### 7.1 Pre-conditions
- [ ] `EXISTING_LAMBDA_ARN` and `EXISTING_LAMBDA_FUNCTION_NAME` env vars set
- [ ] Lambda has `live` alias pointing to a deployed version
- [ ] IAM role allows `apigateway:*` to create REST APIs

### 7.2 Create via GUI

| # | Test Case | Input | Expected Result |
|---|-----------|-------|-----------------|
| R-01 | Create usage plan API — basic | Name: `partner-hsbc`, Type: `REST Usage Plan`, Method: `GET`, Path: `/data`, Env: `dev`, Partner: `hsbc`, Quota: `1000`, Rate: `10` | ✅ 201 Created; ACTIVE |
| R-02 | REST-specific fields appear | Select "REST Usage Plan" type | 📊 Blue "REST API — Usage Plan Settings" section slides in |
| R-03 | REST fields hidden for other types | Select any non-REST type | Usage plan fields NOT visible |
| R-04 | Default values pre-filled | Select REST type without changing fields | Quota: `5000`, Rate: `50` |
| R-05 | Partner name falls back to 'partner' | Leave Partner Name blank | AWS resource named `...-partner-plan` |
| R-06 | Quota = 0 not allowed | Enter 0 in Quota/Day | ❌ min=1 HTML5 validation blocks |
| R-07 | Partner name in Detail modal | Open Details for REST API | "Partner: hsbc" row shown in modal |
| R-08 | Test hint in modal | Open Details | Instruction to get key from AWS Console API Keys |

### 7.3 Retrieve the API Key

```bash
# Option A — AWS Console
# API Gateway → API Keys → <name>-<env>-<partner>-key → Show

# Option B — AWS CLI
aws apigateway get-api-keys --include-values \
  --query "items[?name=='partner-hsbc-dev-hsbc-key'].value" \
  --output text
```

### 7.4 Endpoint Testing

```bash
ROUTE_URL="<from Details modal>"
API_KEY="<retrieved from AWS Console or CLI>"

# ✅ Valid API key
curl -i -H "x-api-key: $API_KEY" $ROUTE_URL
# Expected: 200 OK

# ❌ No API key
curl -i $ROUTE_URL
# Expected: 403 {"message":"Forbidden"}

# ❌ Wrong API key
curl -i -H "x-api-key: wrong-key" $ROUTE_URL
# Expected: 403 {"message":"Forbidden"}

# ❌ Key in wrong header (X-Api-Key vs x-api-key is case-insensitive, but wrong name fails)
curl -i -H "Authorization: Bearer $API_KEY" $ROUTE_URL
# Expected: 403 Forbidden

# ✅ Correct header casing variations (HTTP headers case-insensitive)
curl -i -H "X-API-KEY: $API_KEY" $ROUTE_URL
# Expected: 200 OK
```

| # | Test Case | Expected |
|---|-----------|----------|
| R-09 | Valid `x-api-key` header | ✅ 200 OK |
| R-10 | Missing `x-api-key` header | ❌ 403 {"message":"Forbidden"} |
| R-11 | Invalid API key value | ❌ 403 {"message":"Forbidden"} |
| R-12 | API key in wrong header | ❌ 403 Forbidden |

### 7.5 Quota / Rate Limit Testing

```bash
ROUTE_URL="<route_url>"
API_KEY="<partner api key>"
QUOTA=10  # set a small quota for testing

# Test quota enforcement — run N+1 requests
for i in $(seq 1 11); do
  echo -n "Request $i: "
  curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: $API_KEY" $ROUTE_URL
  echo
done
# Expected: First 10 → 200, Request 11 → 429 Too Many Requests

# Test rate limit — burst many requests at once
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{http_code}\n" -H "x-api-key: $API_KEY" $ROUTE_URL &
done
wait
# Expected: Some 200s, some 429 Too Many Requests (throttled)
```

| # | Test Case | Expected |
|---|-----------|----------|
| R-13 | Requests within daily quota | ✅ 200 OK |
| R-14 | Requests exceeding daily quota | ❌ 429 Too Many Requests |
| R-15 | Burst exceeding rate limit | ❌ 429 Too Many Requests for excess |
| R-16 | Different partner's key on same API | ❌ 403 Forbidden (key not in this plan) |
| R-17 | Quota resets after midnight UTC | ✅ 200 OK next day |

### 7.6 Delete

| # | Test Case | Expected |
|---|-----------|----------|
| R-18 | Delete usage-plan API | ✅ REST API, API Key, Usage Plan all deleted; Lambda permission removed |
| R-19 | Check AWS Console after delete | API Gateway REST APIs: no entry; API Keys: no entry; Usage Plans: no entry |
| R-20 | Call endpoint after delete | ❌ 403 or DNS fails |

---

## 8. Cross-Auth Type Tests

| # | Test Case | Expected |
|---|-----------|----------|
| X-01 | Create all 5 auth types simultaneously | All 5 cards appear with ACTIVE status |
| X-02 | JWT token against Public endpoint | ✅ 200 OK (auth is NONE — token ignored) |
| X-03 | JWT token against Custom Key endpoint | ❌ 401 (wrong identity source) |
| X-04 | X-Api-Key header against JWT endpoint | ❌ 401 (no Authorization: Bearer header) |
| X-05 | REST API key against HTTP Custom Key API | ❌ 403 (different key store/validator) |
| X-06 | IAM signed request against JWT API | ❌ 401 (no JWT token) |
| X-07 | Same API name across two environments | ✅ Allowed — `payments-dev` and `payments-prod` are different records |
| X-08 | Delete all 5 types in sequence | ✅ All cleaned up; DynamoDB records removed |

---

## 9. Backend API Direct Tests (Postman / curl)

### Base URL: `http://localhost:3000` (or Lambda URL)

### 9.1 POST /apis — Validation Errors

```bash
# Missing api_name
curl -s -X POST localhost:3000/apis \
  -H "Content-Type: application/json" \
  -d '{"api_type":"http-public","http_method":"GET","route_path":"/test","environment":"dev"}' | jq .
# Expected: 400 {"error":"Validation failed","details":["api_name is required"]}

# Invalid api_type
curl -s -X POST localhost:3000/apis \
  -H "Content-Type: application/json" \
  -d '{"api_name":"test-api","api_type":"graphql","http_method":"GET","route_path":"/test","environment":"dev"}' | jq .
# Expected: 400, details includes "api_type must be one of: ..."

# Route path without /
curl -s -X POST localhost:3000/apis \
  -H "Content-Type: application/json" \
  -d '{"api_name":"test-api","api_type":"http-public","http_method":"GET","route_path":"noslash","environment":"dev"}' | jq .
# Expected: 400, "route_path must start with /"

# Invalid environment
curl -s -X POST localhost:3000/apis \
  -H "Content-Type: application/json" \
  -d '{"api_name":"test-api","api_type":"http-public","http_method":"GET","route_path":"/test","environment":"uat"}' | jq .
# Expected: 400, "environment must be one of: dev, sit, stage, prod"
```

### 9.2 GET /apis

```bash
curl -s localhost:3000/apis | jq '{count, api_names: [.apis[].api_name]}'
# Expected: {"count": N, "api_names": [...]}
```

### 9.3 GET /apis/{api_name}

```bash
curl -s localhost:3000/apis/payments | jq .
# Expected: full record with all fields

curl -s localhost:3000/apis/does-not-exist | jq .
# Expected: 404 {"error":"API 'does-not-exist' not found"}
```

### 9.4 DELETE /apis/{api_name}

```bash
# Delete ACTIVE
curl -s -X DELETE localhost:3000/apis/test-api | jq .
# Expected: 200 {"message":"API 'test-api' ... deleted"}

# Delete non-existent
curl -s -X DELETE localhost:3000/apis/ghost | jq .
# Expected: 404

# Delete CREATING (blocked)
curl -s -X DELETE localhost:3000/apis/an-api-in-creating-state | jq .
# Expected: 400 {"error":"Cannot delete API with status 'CREATING'"}
```

### 9.5 POST /apis/{api_name}/force-clear

```bash
# Force-clear a FAILED record
curl -s -X POST localhost:3000/apis/broken-api/force-clear | jq .
# Expected: 200 {"message":"API 'broken-api' force-cleared from registry..."}

# Force-clear an ACTIVE record (should fail)
curl -s -X POST localhost:3000/apis/live-api/force-clear | jq .
# Expected: 400 {"error":"Force clear only allowed for DELETE_FAILED or FAILED status ..."}
```

---

## 10. UI/UX Tests

| # | Test Case | Expected |
|---|-----------|----------|
| U-01 | Form resets after successful create | All fields return to defaults after API created |
| U-02 | "Creating..." spinner during submit | Button shows spinner + "Creating..." text while loading |
| U-03 | Submit button disabled during load | Cannot double-submit while creating |
| U-04 | API list refreshes after create | New card appears in list without manual page refresh |
| U-05 | API list refreshes after delete | Card disappears without manual page refresh |
| U-06 | REST usage plan fields animate in/out | Blue section fades in when REST type selected, hides for others |
| U-07 | Long route URL truncated in card | Text truncates with `…` on small screens |
| U-08 | Status badge colours correct | ACTIVE=green, CREATING=yellow, FAILED=red, DELETING=orange, DELETE_FAILED=red |
| U-09 | Empty state when no APIs | Meaningful empty state shown in API list |
| U-10 | Responsive layout on mobile (375px) | Form and list are usable on small screens |

---

## 11. Error Recovery Tests

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| E-01 | Provisioning fails mid-way | Simulate by breaking Lambda ARN in env | Status → FAILED; "🧹 Force Clear" button appears |
| E-02 | Force clear FAILED API | Click Force Clear | Record removed; warning that AWS resources may exist |
| E-03 | Delete fails (AWS error) | Simulate by revoking IAM permissions mid-delete | Status → DELETE_FAILED; Force Clear button appears |
| E-04 | Backend unreachable | Stop backend, try to create | Red toast: connection error |
| E-05 | DynamoDB throttle | Simulate high load | 500 error surfaced in toast |
| E-06 | Re-create after force-clear | Force-clear then create same name | ✅ Allowed — record was removed |

---

## 12. Test Execution Checklist

### Quick Smoke Test (15 min)
- [ ] Create one API of each type (all 5)
- [ ] Verify all show ACTIVE in the list
- [ ] Open Details modal for each — confirm test hint shown
- [ ] Call each endpoint with correct credentials → 200
- [ ] Call each endpoint without credentials → 401/403
- [ ] Delete all 5

### Full Regression Test (2–3 hrs)
- [ ] All tests in sections 2–11 above

### Auth-Specific Deep Dive
- [ ] JWT: token expiry, wrong audience, wrong issuer
- [ ] Custom Key: cache TTL behaviour, key revocation
- [ ] REST Usage Plan: quota exhaustion, burst throttle, key lookup
- [ ] IAM: SigV4 with multiple IAM roles (with/without permission)

---

## 13. Test Data Matrix

| Auth Type | API Name (example) | Method | Path | Extra Fields |
|-----------|-------------------|--------|------|-------------|
| http-public | `pub-health-dev` | GET | `/health` | — |
| http-jwt | `jwt-profile-dev` | GET | `/profile` | — |
| http-custom-key | `key-partner-dev` | POST | `/partner/data` | — |
| http-iam | `iam-internal-dev` | POST | `/internal/sync` | — |
| rest-usage-plan | `rest-hsbc-dev` | GET | `/data` | partner=hsbc, quota=100, rate=5 |

---

*Last updated: June 2026 | Covers GUI version with all 5 auth types*

