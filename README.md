# Cairn

Cairn is a marketplace for workflow APIs that AI agents can discover, pay for, and call.

The idea is simple: if a useful task is trapped behind a long browser workflow, someone can record that workflow, Cairn can expose it as an API, and an agent can use the API later without clicking through the website every time.

Current focus: a Smithery-style marketplace for agent-ready endpoints, prepaid Cairn tokens, Stripe-ready payments, and a contribution flow for new recorded workflows.

## What You Can Do

- Browse verified workflow APIs in a marketplace UI.
- Connect ChatGPT, MCP clients, or other agent runtimes through discovery, OpenAPI, or MCP.
- Pay a few cents per successful call, or buy Cairn tokens once and spend them across marketplace APIs.
- Read an agent-facing README for each API.
- Submit a workflow idea so the tooling team can turn it into a new API.
- Keep the old sandbox targets available for recorder/compiler testing.

## Quickstart

This repo is intentionally dependency-light. It uses Node's built-in HTTP server and test runner.

Create your local environment file:

```bash
cp .env.example .env
```

For a local stub-mode demo, you can leave the Stripe values blank.

```bash
npm start
```

Open:

```text
http://localhost:3000
http://localhost:3000/pricing
```

If port `3000` is already taken, either edit `PORT` in `.env` or run:

```bash
PORT=3005 npm start
```

Run tests:

```bash
npm test
```

## Main Pages

- `/` - marketplace homepage with searchable API listings, wallet controls, API details, install snippets, and contribution form.
- `/pricing` - separate pricing page with token packs and per-API prices.
- `/.well-known/cairn.json` - discovery document for agents.
- `/openapi.json` - OpenAPI document for marketplace tool invocation.

## Vercel Deployment

The app runs locally as a plain Node HTTP server with `npm start`. On Vercel, `api/cairn.js` adapts the same server to a Vercel Function, and `vercel.json` rewrites API-style routes into that function.

Deploy from GitHub after pushing `main`, then set these Vercel environment variables:

```bash
HOST=0.0.0.0
PORT=3000
CAIRN_PUBLIC_URL=https://your-vercel-domain.vercel.app
```

Optional payment variables:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_TOKENS_STARTER=price_...
STRIPE_PRICE_TOKENS_BUILDER=price_...
STRIPE_PRICE_TOKENS_TEAM=price_...
```

The current demo keeps marketplace state in memory. That is fine for a demo, but production should move listings, wallets, ledgers, verification records, and workflow submissions into Postgres because Vercel Function instances can be recreated between invocations.

## Current Seed APIs

| API | Endpoint | Price | Token price |
| --- | --- | ---: | ---: |
| Compare Insurance Prices | `/api/tools/insurance/compare-insurance-prices/invoke` | `$0.03` | `1 token` |
| Search Properties | `/api/tools/real-estate/search-properties/invoke` | `$0.04` | `1 token` |

These are synthetic demo workflows. They represent the shape of future recorded automations, such as price comparison, portal search, quote lookup, availability checks, and other tasks where a public API does not exist.

## Pricing

Cairn supports two payment modes.

Direct per-call payment is best for one-off use. The current seed APIs cost `3-4 cents` per successful call.

Tokens are best for agents and teams. Tokens are stored in a marketplace-wide wallet and can be spent across any API.

Current token packs:

| Pack | Tokens | Price | Approx. cost |
| --- | ---: | ---: | ---: |
| Starter | `250` | `$0.99` | `0.40 cents/token` |
| Builder | `1,500` | `$4.99` | `0.33 cents/token` |
| Team | `7,500` | `$19.99` | `0.27 cents/token` |

The demo wallet account is `demo-user` and starts with `50` test tokens.

## Agent Endpoints

### Discovery

```http
GET /.well-known/cairn.json
GET /api/catalog
GET /api/tools
GET /openapi.json
POST /mcp
```

### Tool Details

```http
GET /api/tools/:namespace/:slug
GET /api/tools/:namespace/:slug/readme.md
GET /api/tools/:namespace/:slug/openapi.json
```

### Tool Payment And Invocation

```http
POST /api/tools/:namespace/:slug/quote
POST /api/tools/:namespace/:slug/checkout
POST /api/tools/:namespace/:slug/invoke
```

### Token Wallet

```http
GET /api/tokens/config
GET /api/tokens/wallet?accountId=demo-user
POST /api/tokens/quote
POST /api/tokens/checkout
```

### Stripe Helpers

```http
GET /api/payments/stripe-config
POST /api/payments/quote
POST /api/payments/checkout
POST /api/payments/usage
POST /api/stripe/webhook
```

## Example Calls

### Demo Mode

Demo mode bypasses payment and is useful for local testing.

```bash
curl -X POST http://localhost:3000/api/tools/insurance/compare-insurance-prices/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "demo": true,
    "input": {
      "coverageType": "auto",
      "zipCode": "78701",
      "driverAge": 35,
      "vehicleYear": 2021
    }
  }'
```

### Token Payment

```bash
curl -X POST http://localhost:3000/api/tools/insurance/compare-insurance-prices/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "paymentMethod": "tokens",
    "tokenAccountId": "demo-user",
    "input": {
      "coverageType": "auto",
      "zipCode": "78701",
      "driverAge": 35,
      "vehicleYear": 2021
    }
  }'
```

Tokens are checked before invocation and debited only after a successful result.

### Buy Tokens

Without `STRIPE_SECRET_KEY`, this grants a local test pack immediately. With Stripe configured, it creates a Stripe Checkout Session.

```bash
curl -X POST http://localhost:3000/api/tokens/checkout \
  -H "Content-Type: application/json" \
  -d '{
    "packId": "starter",
    "accountId": "demo-user"
  }'
```

### Direct Payment

```bash
curl -X POST http://localhost:3000/api/tools/real-estate/search-properties/quote \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "location": "Austin",
      "maxPrice": 700000,
      "bedrooms": 2
    }
  }'
```

Then call `/checkout`, and pass the returned `payment` object to `/invoke`. Agents can also pass a Stripe Shared Payment Token through `sharedPaymentToken`.

## MCP Usage

Cairn exposes a minimal JSON-RPC MCP surface.

List tools:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "tools",
    "method": "tools/list"
  }'
```

Call a tool with tokens:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "call-1",
    "method": "tools/call",
    "params": {
      "name": "compareInsurancePrices",
      "paymentMethod": "tokens",
      "tokenAccountId": "demo-user",
      "arguments": {
        "coverageType": "auto",
        "zipCode": "78701",
        "driverAge": 35,
        "vehicleYear": 2021
      }
    }
  }'
```

## Submit A Workflow

The homepage has a contribution form for workflow ideas. It posts to:

```http
POST /api/workflows/recordings
```

Example payload:

```json
{
  "title": "Compare flight refund options",
  "targetUrl": "https://example.com/account/trips",
  "goal": "Return refund eligibility, policy notes, and next available action.",
  "artifacts": []
}
```

This is currently an upload stub for the teammate-owned recorder/compiler tooling. The marketplace side is ready to accept the request and return an accepted status.

## Stripe Configuration

The app automatically loads `.env` from the repo root when `npm start` runs. Real `.env` files are ignored by Git; `.env.example` is the committed template.

Set these for real Stripe payments:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
CAIRN_PUBLIC_URL=https://your-domain.example
```

Optional per-listing Stripe Price IDs:

```bash
STRIPE_PRICE_INSURANCE_COMPARE=price_...
STRIPE_PRICE_PROPERTY_SEARCH=price_...
```

Optional token pack Price IDs:

```bash
STRIPE_PRICE_TOKENS_STARTER=price_...
STRIPE_PRICE_TOKENS_BUILDER=price_...
STRIPE_PRICE_TOKENS_TEAM=price_...
```

Optional usage billing:

```bash
STRIPE_METER_EVENT_NAME=cairn_api_call
```

If no Stripe secret key is present, Cairn runs in stub mode:

- API checkout returns a test authorization.
- Token checkout grants a test token pack.
- Usage billing returns a stub response instead of sending a Stripe meter event.

## Environment Variables

Current app variables:

| Name | Required | Used for |
| --- | --- | --- |
| `PORT` | no | Local HTTP port. Defaults to `3000`. |
| `HOST` | no | Bind host. Defaults to `127.0.0.1`; use `0.0.0.0` in containers. |
| `CAIRN_PUBLIC_URL` | production | Public app URL used for Stripe Checkout return URLs. |
| `STRIPE_SECRET_KEY` | production payments | Creates Stripe Checkout Sessions and meter events. Blank means stub mode. |
| `STRIPE_WEBHOOK_SECRET` | production payments | Webhook signature secret. The current webhook route is still a stub. |
| `STRIPE_PRICE_INSURANCE_COMPARE` | optional | Prebuilt Stripe Price for the insurance API. |
| `STRIPE_PRICE_PROPERTY_SEARCH` | optional | Prebuilt Stripe Price for the property API. |
| `STRIPE_METER_EVENT_NAME` | optional | Shared Stripe meter event name for usage billing. |
| `STRIPE_PRICE_TOKENS_STARTER` | optional | Prebuilt Stripe Price for the Starter token pack. |
| `STRIPE_PRICE_TOKENS_BUILDER` | optional | Prebuilt Stripe Price for the Builder token pack. |
| `STRIPE_PRICE_TOKENS_TEAM` | optional | Prebuilt Stripe Price for the Team token pack. |
| `DATABASE_URL` | production database | RDS Postgres connection string. When set, marketplace listings, wallets, token ledger entries, usage events, payments, and invocation logs persist to Postgres. |
| `DATABASE_SSL` | production database | Set to `true` for RDS. Set to `false` only for a trusted local database. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | optional | Set to `true` only when you also provide a trusted CA chain. Defaults to RDS-friendly TLS without strict local CA validation. |
| `DATABASE_POOL_MAX` | optional | Postgres connection pool size. Defaults to `3`, which is safer for serverless deployments. |

Reserved production variables in `.env.example`:

| Name | Future use |
| --- | --- |
| `AWS_REGION` | AWS SDK region. |
| `RDS_DB_INSTANCE_IDENTIFIER` | RDS instance name for the AWS setup scripts. |
| `RDS_DB_NAME` | Postgres database name. |
| `RDS_MASTER_USERNAME` | Postgres admin user name. |
| `S3_RECORDINGS_BUCKET` | Raw workflow recording artifacts. |
| `S3_TRACES_BUCKET` | Browser/proxy traces. |
| `S3_SCREENSHOTS_BUCKET` | Screenshots and visual artifacts. |
| `KMS_KEY_ARN` | KMS key for encrypted artifacts/secrets. |
| `SQS_RECORDING_QUEUE_URL` | Recording job queue. |
| `SQS_SYNTHESIS_QUEUE_URL` | Compiler job queue. |
| `SQS_VERIFICATION_QUEUE_URL` | Verification job queue. |
| `SQS_INVOCATION_QUEUE_URL` | Runtime invocation queue. |
| `SQS_REPAIR_QUEUE_URL` | Drift repair queue. |
| `EVENTBRIDGE_BUS_NAME` | Run/listing/repair event bus. |
| `SECRETS_PREFIX` | Prefix for AWS Secrets Manager paths. |
| `OPENAI_API_KEY` | Computer-use or repair assistant integration. |
| `BROWSER_USE_API_KEY` | Browser Use repair adapter integration. |

## Database Setup

Cairn runs without a database for local demos, but production should set `DATABASE_URL` to an RDS Postgres database and run:

```bash
npm run db:migrate
```

The migration creates tables for published APIs, skill manifests, marketplace listings, verification records, workflow submissions, token wallets, token ledger entries, usage events, payments, and invocation logs.

Credit behavior:

- `POST /api/tokens/checkout` creates a Stripe Checkout Session when `STRIPE_SECRET_KEY` is set.
- `POST /api/stripe/webhook` verifies `STRIPE_WEBHOOK_SECRET` when configured.
- Stripe `checkout.session.completed` events with `metadata.kind=token_pack` credit the buyer wallet exactly once.
- Successful token-paid API invocations debit the wallet exactly once using the invocation id as the idempotency key.
- Failed, blocked, or unpaid invocations do not spend tokens.

## Project Map

```text
public/index.html          Marketplace UI
public/app.js              Marketplace UI behavior
public/pricing.html        Pricing page
public/pricing.js          Pricing page behavior
public/styles.css          Shared marketplace styling

api/cairn.js               Vercel Function adapter for the Node server
vercel.json                Vercel rewrites and function config
src/server.js              HTTP server, routes, static pages, MCP surface
src/cairn/marketplace.js   Seed listings, OpenAPI, checkout, usage billing
src/cairn/tokens.js        Token packs, wallets, ledger, token checkout
src/cairn/pipeline.js      Recording/synthesis/verification state and invocation
src/cairn/executor.js      Deterministic workflow execution
src/cairn/policy.js        Skill permissions and invocation logs
src/cairn/synthesizer.js   Recording-to-operation compiler demo
src/cairn/repair.js        Drift classification and repair proposal demo
src/data/seed.js           Synthetic CRM, civic, insurance, and property data

tests/*.test.js            Node test runner coverage
```

## Sandbox Targets

These are still available for recorder/compiler testing, but they are not shown as marketplace seed listings.

- `/meridian` - modern JSON REST style CRM sandbox.
- `/civic` - legacy server-rendered records portal with CSRF and ViewState-style hidden state.

Demo repair endpoints remain available:

```http
POST /api/demo/record
POST /api/demo/reverify
POST /api/demo/repair
POST /api/demo/drift-civic
POST /api/demo/reset-drift
```

## Tests

```bash
npm test
```

The current tests cover:

- Marketplace bootstrap and OpenAPI generation.
- Token wallet purchase and spend flow.
- Payment authorization gates.
- Policy allow/block decisions.
- Civic fresh-token lifting and repair.
- Meridian dependency graph synthesis.

## Deployment Direction

The intended production split is:

- Marketplace UI: Vercel.
- Browser/proxy/execution workers: AWS ECS Fargate.
- Workflow orchestration: AWS Step Functions.
- Queues/events: SQS or EventBridge.
- Artifacts: S3 with KMS.
- Data plane: RDS Postgres.
- Secrets: AWS Secrets Manager.

For the current demo, everything runs in-memory inside one Node process.

## Current Limitations

- The marketplace uses synthetic seed APIs, not live third-party websites.
- Wallets, listings, invocation logs, and ledgers are in-memory for the demo.
- Stripe webhooks are acknowledged but not signature-verified yet.
- Token checkout in stub mode grants tokens immediately.
- The recorder/compiler tooling is represented by boundaries and stubs; teammates can wire real capture artifacts into those seams.
