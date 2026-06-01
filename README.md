# API Gateway Terraform

A production-grade, multi-environment AWS API Gateway deployment using Terraform modular design, GitHub Actions CI/CD with OIDC authentication, multi-auth API Gateway (Cognito JWT + Custom Lambda), CloudWatch monitoring, WAF protection, and Lambda blue/green deployments.

---

## Architecture

### 1 — Runtime Request Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User / Client
    participant Cognito as 🔐 AWS Cognito<br/>(Auth Server)
    participant WAF as 🛡️ AWS WAF v2
    participant APIGW as 🚪 API Gateway<br/>(HTTP API)
    participant JWTAuth as 🔑 JWT Authorizer<br/>(Cognito)
    participant LambdaAuth as 🔑 Lambda Authorizer<br/>(Custom)
    participant Lambda as ⚡ Lambda<br/>("live" alias)
    participant CW as 📊 CloudWatch + X-Ray

    Note over User,Cognito: Path A — JWT Auth (GET /secure)
    User->>Cognito: POST InitiateAuth (email + password)
    Cognito-->>User: IdToken (JWT, 1h TTL)
    User->>WAF: GET /secure  Authorization: Bearer jwt
    WAF->>APIGW: Forward (rate limit passed)
    APIGW->>JWTAuth: Validate JWT signature + issuer + audience + expiry
    JWTAuth-->>APIGW: Claims (sub, email)
    APIGW->>Lambda: Invoke with JWT claims in event.requestContext.authorizer.jwt
    Lambda->>CW: Logs + X-Ray trace
    Lambda-->>User: 200 JSON — authMethod jwt

    Note over User,CW: Path B — Custom Lambda Auth (GET /admin)
    User->>WAF: GET /admin  X-Api-Key: my-secret-key-123
    WAF->>APIGW: Forward
    APIGW->>LambdaAuth: Invoke authorizer Lambda with X-Api-Key header
    LambdaAuth-->>APIGW: isAuthorized true (simple response format)
    APIGW->>Lambda: Invoke main Lambda
    Lambda-->>User: 200 JSON — authMethod custom

    Note over User,CW: Path C — Public (GET /health)
    User->>APIGW: GET /health (no auth header needed)
    APIGW->>Lambda: Invoke directly — no authorizer
    Lambda-->>User: 200 JSON — authMethod none
```

---

### 2 — Infrastructure & Module Structure

```mermaid
graph TB
    subgraph GH["GitHub"]
        code["Source Code (Terraform + Lambda)"]
        actions["GitHub Actions\ndeploy_terraform.yml\ndestroy_terraform.yml"]
    end

    subgraph BOOT["AWS Bootstrap (one-time)"]
        s3["S3 Bucket — Terraform State"]
        dynamo["DynamoDB — State Lock"]
        oidc["IAM OIDC Provider"]
        role["IAM Role — github-actions-oidc-role"]
    end

    subgraph MOD["Terraform Modules"]
        stack["modules/stack (composite)"]
        cog["modules/cognito"]
        lam["modules/lambda"]
        apig["modules/api-gateway"]
        mon["modules/monitoring"]
        stack --> cog & lam & apig & mon
    end

    subgraph ENVS["Environments (each isolated)"]
        dev["dev — WAF off, low throttle"]
        sit["sit — WAF on, moderate"]
        stage["stage — prod-identical"]
        prod["prod — full protection"]
    end

    code --> actions
    actions -- "OIDC token (no stored secrets)" --> oidc --> role
    actions -- "terraform init" --> s3
    s3 -. "state lock" .- dynamo
    ENVS -- "module.stack" --> MOD
    actions -- "terraform apply" --> ENVS
```

---

### 3 — CI/CD Pipeline Flow

```mermaid
flowchart TD
    push["git push (any branch)"] --> plan_job

    subgraph plan_job["plan-dev — non-main branches + PRs"]
        fmt["terraform fmt -recursive"] --> init1["terraform init"]
        init1 --> validate["terraform validate"]
        validate --> plan["terraform plan dev"]
        plan --> comment{"PR?"}
        comment -- Yes --> pr_comment["Post plan as PR comment"]
        comment -- No --> done1["Plan visible in Actions log"]
    end

    merge["Merge to main"] --> deploy_job

    subgraph deploy_job["deploy — main branch only, plan + apply"]
        d1["apply dev"] --> d2["apply sit (add to matrix)"]
        d2 --> d3["apply stage (add to matrix)"]
        d3 --> d4["apply prod (add to matrix)"]
        d1 -- "fails?" --> stop["Pipeline stops"]
    end

    manual_deploy["Manual — workflow_dispatch"] --> safety1["Safety Check\nconfirm == environment?"]
    safety1 -- No --> abort1["ABORT"]
    safety1 -- Yes --> deploy_manual["plan + apply\n(apply only if branch = main)"]

    manual_destroy["Manual — workflow_dispatch"] --> safety2["Safety Check\nconfirm == environment?"]
    safety2 -- No --> abort2["ABORT"]
    safety2 -- Yes --> preview["terraform plan -destroy"] --> destroy["terraform destroy"]
```

---

### 4 — AWS Resources Per Environment

```mermaid
graph LR
    subgraph ENV["One Environment (e.g. dev)"]
        subgraph AUTH["Auth"]
            UP["Cognito User Pool"]
            CLIENT["App Client — JWT issuer"]
            UP --- CLIENT
            AUTHFN["Lambda Authorizer fn\napi-demo-dev-lambda-authorizer"]
        end
        subgraph COMPUTE["Compute"]
            ALIAS["Lambda Alias — live"]
            VER["Lambda Version N (published)"]
            ALIAS --> VER
            ROLE["IAM Role — basic-execution + X-Ray"]
            VER --- ROLE
        end
        subgraph API["API Layer"]
            WAF2["WAF WebACL (toggle per env)"]
            GW["API Gateway HTTP API\nthrottle + access logs"]
            JWTAUTH["JWT Authorizer — GET /secure"]
            LAMBDAAUTH["Lambda Authorizer — GET /admin\nenable_simple_responses=true"]
            PUBRT["No Auth — GET /health"]
            WAF2 --> GW
            GW --> JWTAUTH --> ALIAS
            GW --> LAMBDAAUTH --> ALIAS
            GW --> PUBRT --> ALIAS
        end
        subgraph OBS["Observability"]
            LOGGRP["CloudWatch Log Groups\nLambda + Authorizer + API Gateway"]
            ALARMS["5 CloudWatch Alarms"]
            DASH["CloudWatch Dashboard (6 widgets)"]
            SNS["SNS Topic — email alerts"]
            ALARMS --> SNS
        end
        COMPUTE -.->|logs| LOGGRP
        API -.->|access logs| LOGGRP
        LOGGRP -.-> ALARMS --> DASH
    end
```

---

## Repository Structure

```
.
├── .github/
│   └── workflows/
│       ├── deploy_terraform.yml    # plan on branches, apply on main, manual deploy
│       └── destroy_terraform.yml   # manual destroy with safety confirmation
├── environments/
│   ├── dev/                        # WAF off, burst=50, rate=25, logs=14d
│   ├── sit/                        # WAF on, burst=100, rate=50, logs=30d
│   ├── stage/                      # WAF on, burst=500, rate=200, logs=90d
│   └── prod/                       # WAF on, burst=500, rate=200, logs=90d
│       └── (each has: backend.tf, main.tf, outputs.tf, providers.tf, variables.tf, terraform.tfvars.example)
├── modules/
│   ├── stack/                      # Composite module — wires all 4 modules
│   ├── api-gateway/                # HTTP API, JWT + Lambda authorizers, WAF, logging
│   ├── cognito/                    # User pool + app client
│   ├── lambda/                     # Main handler + authorizer fn, IAM, X-Ray, live alias
│   └── monitoring/                 # SNS, 5 alarms, 6-widget dashboard
├── lambda/
│   └── src/
│       ├── index.js                # Main handler — detects JWT / custom / none auth
│       └── authorizer.js           # Custom Lambda authorizer — X-Api-Key validation
├── scripts/
│   └── bootstrap-state.sh          # One-time: S3, DynamoDB, OIDC, IAM role
├── .gitignore
├── README.md
└── docs/
    ├── index.md                    # Docs landing page + quick links
    ├── setup.md                    # Full setup guide from zero
    └── testing.md                  # Complete test guide with curl + Postman
```

---

## Quick Start

> 📖 **Starting from scratch?** Follow **[docs/setup.md](./docs/setup.md)**
> 🧪 **Testing the API?** See **[docs/testing.md](./docs/testing.md)**

```bash
# 1. Bootstrap (one-time)
export AWS_REGION=eu-north-1
export GITHUB_ORG=your-github-username
export GITHUB_REPO=api-gateway-terraform
export BUCKET_NAME=tf-state-$(aws sts get-caller-identity --query Account --output text)
AWS_PAGER="" bash scripts/bootstrap-state.sh

# 2. Add secrets to each GitHub Environment (dev, sit, stage, prod):
#    AWS_ROLE_ARN = arn from bootstrap output
#    ALARM_EMAIL  = your-email@example.com

# 3. Push to feature branch → plan only
git push origin feature/my-branch

# 4. Merge to main → plan + apply
git push origin main
```

---

## Routes & Auth Types

| Route | Auth Type | Client sends | Validated by |
|---|---|---|---|
| `GET /secure` | **JWT** (Cognito) | `Authorization: Bearer <IdToken>` | API Gateway (signature + issuer + expiry) |
| `GET /admin` | **Custom Lambda** | `X-Api-Key: my-secret-key-123` | `authorizer.js` Lambda function |
| `GET /health` | **None** (public) | Nothing | — |

---

## CI/CD Workflows

### deploy_terraform.yml

| Trigger | Job | What runs |
|---------|-----|-----------|
| Push to any branch | `plan-dev` | fmt + init + validate + plan (dev only) |
| PR to main | `plan-dev` | same + posts plan as PR comment |
| Push to main | `deploy` | plan + **apply** (dev only — expand matrix when ready) |
| Manual (`workflow_dispatch`) | `confirm-input` → `deploy-manual` | safety check → plan + **apply** (only if main) |

### destroy_terraform.yml

Manual only. Select environment + type name to confirm → `terraform destroy`.

### Expanding to all environments

```yaml
# In deploy_terraform.yml, change:
environment: [dev]
# to:
environment: [dev, sit, stage, prod]
```

---

## Lambda Response Format

All 3 routes use the same main Lambda. It detects which auth was used from the event:

```json
// GET /secure with valid JWT
{
  "message": "Access granted",
  "authMethod": "jwt",
  "user": { "sub": "805c995c-...", "email": "user@example.com" },
  "environment": "dev",
  "requestId": "...",
  "timestamp": "2026-06-01T14:11:41.106Z"
}

// GET /admin with correct X-Api-Key
{
  "message": "Access granted",
  "authMethod": "custom",
  "user": { "authMethod": "api-key", "keyId": "my-secre..." },
  "environment": "dev"
}

// GET /health (no auth)
{
  "message": "Access granted",
  "authMethod": "none",
  "user": {},
  "environment": "dev"
}
```

---

## Terraform Outputs

Get current values after deploy:
```bash
terraform -chdir=environments/dev output
```

| Output | Description |
|--------|-------------|
| `api_endpoint` | Base URL of the HTTP API |
| `secure_endpoint` | Full URL for `GET /secure` |
| `cognito_user_pool_id` | Cognito pool ID |
| `cognito_client_id` | App client ID for token requests |
| `lambda_function_name` | Main Lambda function name |
| `lambda_version` | Currently deployed version |
| `dashboard_url` | CloudWatch dashboard URL |
| `sns_topic_arn` | SNS topic for alarm emails |
| `waf_arn` | WAF WebACL ARN (empty in dev) |

---

## Environment Differences

| Setting | dev | sit | stage | prod |
|---------|-----|-----|-------|------|
| WAF | Off | On | On | On |
| Throttle burst | 50 | 100 | 500 | 500 |
| Throttle rate | 25/s | 50/s | 200/s | 200/s |
| WAF rate limit | 500/5min | 1000/5min | 2000/5min | 2000/5min |
| Log retention | 14 days | 30 days | 90 days | 90 days |

---

## Production Features

| Feature | Implementation |
|---------|----------------|
| **JWT Auth** | API Gateway native JWT authorizer — validates Cognito `IdToken` (signature, issuer, audience, expiry) |
| **Custom Lambda Auth** | Lambda authorizer with `enable_simple_responses = true` — validates `X-Api-Key` header |
| **Multi-auth routes** | JWT, CUSTOM, AWS_IAM, NONE — configured per route via Terraform variable |
| **WAF** | Rate limiting + AWS managed rules (sit/stage/prod) |
| **API Throttling** | Burst + rate limits per environment |
| **X-Ray** | Active tracing on main Lambda |
| **Blue/Green** | `publish = true` + `live` alias — instant rollback |
| **CloudWatch** | 5 alarms, 6-widget dashboard, JSON access logs |
| **SNS Alerts** | Email on alarm state change |
| **Remote State** | S3 + DynamoDB lock |
| **OIDC** | No static AWS credentials — short-lived token exchange |
| **Auto-zip** | `archive_file` zips `lambda/src/` automatically |

---

## Blue/Green Rollback

```bash
aws lambda update-alias --function-name api-demo-dev-lambda --name live --function-version <previous-version> --region eu-north-1
```

---

## Cost Estimate (dev environment)

| Service | Free tier |
|---------|-----------|
| Lambda (2 functions) | 1M req/month free |
| API Gateway | 1M HTTP calls/month free |
| Cognito | 50K MAU free |
| CloudWatch | 5 GB logs free |
| DynamoDB | 25 GB free |
| S3 | 5 GB free |
| WAF | **$5/month** — disabled in dev |

**Estimated dev cost: ~$0/month** within free tier.
