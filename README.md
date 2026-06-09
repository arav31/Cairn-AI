# Cairn

Cairn is a marketplace for verified workflow APIs. People record tasks they normally do in a browser, Cairn exposes those tasks as paid endpoints, and agents can discover, pay for, and invoke them.

This repo is intentionally dependency-light so it can run immediately:

```bash
npm start
```

Then open `http://localhost:3000`. Pricing is available at `http://localhost:3000/pricing`.

Run tests with:

```bash
npm test
```

## What Is Implemented

- Smithery-inspired marketplace UI with searchable API listings, health/usage stats, a separate pricing page, install snippets, README blocks, and agent connection endpoints.
- Two starter marketplace APIs:
  - `compareInsurancePrices` at `/api/tools/insurance/compare-insurance-prices/invoke`.
  - `searchProperties` at `/api/tools/real-estate/search-properties/invoke`.
- Agent-facing API catalog at `/api/catalog`, `/api/tools`, `/openapi.json`, `/.well-known/cairn.json`, and `/mcp`.
- Paid invocation flow with quote, checkout, Stripe Checkout Session support, Billing Meter Event support, Stripe Shared Payment Token-ready stubs, and marketplace-wide Cairn token wallets.
- Recording upload stub at `/api/workflows/recordings` for the teammate-owned recorder/compiler tooling.
- Contributor form so anyone can submit a workflow idea for the marketplace.
- Sandbox target systems remain available under `/meridian` and `/civic` for teammate tooling tests, but they are no longer marketplace seed listings.
- Workflow synthesis into typed operation definitions with flow graphs, parameter classes, fresh-token extractors, OpenAPI 3.1 output, and skill manifests.
- Policy-gated skill invocation with audit logs.

## Agent Endpoints

- `GET /.well-known/cairn.json` - platform discovery for agents.
- `GET /api/catalog` - marketplace listings.
- `GET /api/tools` - compact tool list.
- `GET /api/tools/:namespace/:slug` - tool detail.
- `GET /api/tools/:namespace/:slug/readme.md` - agent-facing README for one API.
- `POST /api/tools/:namespace/:slug/quote` - price a call.
- `POST /api/tools/:namespace/:slug/checkout` - create a Stripe Checkout Session when configured, otherwise return a test authorization.
- `POST /api/tools/:namespace/:slug/invoke` - call a paid workflow API with direct payment or `paymentMethod: "tokens"`.
- `GET /api/payments/stripe-config` - required Stripe environment variables.
- `POST /api/payments/usage` - record usage with Stripe Billing Meter Events when configured.
- `GET /api/tokens/config` - available token packs.
- `GET /api/tokens/wallet?accountId=demo-user` - wallet balance and ledger.
- `POST /api/tokens/quote` - price a token pack.
- `POST /api/tokens/checkout` - buy tokens through Stripe Checkout when configured, otherwise grant a test pack.
- `POST /mcp` - minimal JSON-RPC surface for `initialize`, `tools/list`, and `tools/call`.

## Token Payments

Direct payment is useful for one-off calls. Tokens are useful when someone wants a balance that works across every API in the marketplace.

```json
{
  "input": {
    "zipCode": "78701"
  },
  "paymentMethod": "tokens",
  "tokenAccountId": "demo-user"
}
```

Each listing declares a `pricing.tokenCost`. The starter demo wallet begins with 50 test tokens. Current seed APIs cost 1 token per successful call, or 3-4 cents through direct per-call payment.

Current token packs:

```text
Starter: 250 tokens for $0.99
Builder: 1,500 tokens for $4.99
Team: 7,500 tokens for $19.99
```

## Stripe Setup

Set these for real payments:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
CAIRN_PUBLIC_URL=https://your-domain.example
```

Optional per-listing price IDs:

```bash
STRIPE_PRICE_INSURANCE_COMPARE=price_...
STRIPE_PRICE_PROPERTY_SEARCH=price_...
```

Optional usage billing:

```bash
STRIPE_METER_EVENT_NAME=cairn_api_call
```

Optional token pack price IDs:

```bash
STRIPE_PRICE_TOKENS_STARTER=price_...
STRIPE_PRICE_TOKENS_BUILDER=price_...
STRIPE_PRICE_TOKENS_TEAM=price_...
```

## Adapter Boundaries

The pilot uses built-in instrumentation instead of launching Playwright or mitmproxy directly. The code keeps the boundaries explicit:

- `src/cairn/pipeline.js` is where a real Playwright recorder and mitmproxy capture stream would be attached.
- `src/cairn/repair.js` exposes the repair-agent seam for OpenAI Computer Use or Browser Use.
- `src/cairn/executor.js` is the deterministic operation runner.
- `src/cairn/policy.js` is the OPA/Rego replacement point.

## Deployment Direction

- Browser/proxy/execution workers: AWS ECS Fargate.
- Workflow orchestration: AWS Step Functions.
- Queues/events: SQS/EventBridge.
- Artifacts: S3 with KMS.
- Data plane: RDS Postgres.
- Secrets: AWS Secrets Manager.
- Marketplace UI: Vercel.
