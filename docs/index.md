# Documentation

| Guide | Description |
|-------|-------------|
| [setup.md](./setup.md) | Complete setup from zero — AWS account, tools, bootstrap, pipeline |
| [testing.md](./testing.md) | How to test all 3 routes — curl, Postman, infrastructure checks |

---

## Quick Links

- **Deploy:** push to `main` or GitHub Actions → Terraform Deploy (manual)
- **Destroy:** GitHub Actions → Terraform Destroy (manual, requires confirmation)
- **Get current API URL:** `terraform -chdir=environments/dev output api_endpoint`
- **Dashboard:** `terraform -chdir=environments/dev output dashboard_url`

---

## Routes at a Glance

| Route | Auth | Test with |
|---|---|---|
| `GET /secure` | JWT (Cognito) | `Authorization: Bearer <token>` |
| `GET /admin` | Custom Lambda (API key) | `X-Api-Key: my-secret-key-123` |
| `GET /health` | None (public) | No header |

---

## Key Architecture Decisions

| Decision | Why |
|---|---|
| HTTP API (not REST API) | 70% cheaper, native JWT authorizer, lower latency |
| `enable_simple_responses = true` | Required for `{ isAuthorized: true/false }` Lambda authorizer format |
| `publish = true` + `live` alias | Blue/green rollback in seconds without redeployment |
| `archive_file` data source | Auto-zips `lambda/src/` — no manual zip needed |
| `modules/stack/` composite | Single place to wire all modules — environments are thin callers |
| OIDC (no static creds) | No AWS secrets stored in GitHub — short-lived tokens only |
